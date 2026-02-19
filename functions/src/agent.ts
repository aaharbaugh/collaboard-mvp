import * as admin from 'firebase-admin';
import OpenAI from 'openai';
import { Langfuse } from 'langfuse';
import * as agentTools from './agentTools.js';

// Initialize Admin SDK once per cold start
if (!admin.apps.length) {
  admin.initializeApp();
}

// Lazily initialized to avoid crashing during Firebase deploy analysis (env vars not set at load time)
let _openai: OpenAI | null = null;
let _langfuse: Langfuse | null = null;

function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

function getLangfuse(): Langfuse {
  if (!_langfuse) {
    _langfuse = new Langfuse({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY ?? '',
      secretKey: process.env.LANGFUSE_SECRET_KEY ?? '',
      baseUrl: process.env.LANGFUSE_HOST,
    });
  }
  return _langfuse;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentCommandRequest {
  boardId: string;
  command: string;
  userId: string;
  userName: string;
  /** When set, only these objects (and their connections) are sent as context. */
  selectedIds?: string[];
  /** When set (and no selection), only objects in visible viewport are sent. */
  viewport?: { x: number; y: number; scale: number };
}

// ---------------------------------------------------------------------------
// Retry helper (retry once on any error)
// ---------------------------------------------------------------------------

async function callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    return await fn();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function estimateRequiredIterations(command: string): number {
  const isComplex = /flowchart|flow chart|diagram|mind.?map|org.?chart|kanban|swot|mind map/i.test(command);
  return isComplex ? 5 : 3;
}

function detectPattern(command: string): string {
  if (/swot/i.test(command)) return 'swot';
  if (/kanban/i.test(command)) return 'kanban';
  if (/flowchart|flow chart/i.test(command)) return 'flowchart';
  if (/mind.?map/i.test(command)) return 'mindmap';
  if (/org.?chart|organization chart/i.test(command)) return 'orgchart';
  if (/comparison|compare|pros?.and.?cons?|pro.?con/i.test(command)) return 'comparison';
  return 'freeform';
}

function checkOverlaps(cache: agentTools.ObjectCache): number {
  const objects = Array.from(cache.values());
  let overlaps = 0;
  for (let i = 0; i < objects.length; i++) {
    for (let j = i + 1; j < objects.length; j++) {
      const a = objects[i];
      const b = objects[j];
      if (a.x < b.x + b.width && a.x + a.width > b.x &&
          a.y < b.y + b.height && a.y + a.height > b.y) {
        overlaps++;
      }
    }
  }
  return overlaps;
}

// ---------------------------------------------------------------------------
// Exported business logic (also testable without the callable wrapper)
// ---------------------------------------------------------------------------

export async function runAgentCommand(
  params: AgentCommandRequest
): Promise<{ success: boolean; message: string }> {
  const { boardId, command, userId, userName, selectedIds, viewport } = params;

  // Validate board exists
  const boardSnap = await admin.database().ref(`boards/${boardId}`).once('value');
  if (!boardSnap.exists()) {
    throw new Error('Board not found');
  }

  // Get compressed board context (selection, viewport, or full)
  const boardState = await agentTools.getBoardContext(boardId, {
    selectedIds: selectedIds?.length ? selectedIds : undefined,
    viewport: viewport ?? undefined,
  });

  // Populate object cache from initial board state
  const objectCache: agentTools.ObjectCache = new Map();
  for (const [id, obj] of Object.entries(boardState.objects)) {
    if (obj && typeof obj === 'object') {
      const o = obj as Record<string, unknown>;
      objectCache.set(id, {
        x: Number(o['x'] ?? 0),
        y: Number(o['y'] ?? 0),
        width: Number(o['width'] ?? 160),
        height: Number(o['height'] ?? 120),
      });
    }
  }

  const maxIterations = estimateRequiredIterations(command);
  const estimatedPattern = detectPattern(command);

  // LangFuse observability
  const trace = getLangfuse().trace({
    name: 'agent-command',
    userId,
    metadata: { boardId, userName },
  });
  trace.update({
    input: {
      boardId,
      command,
      userId,
      userName,
      ...(selectedIds?.length && { selectedIds }),
      ...(viewport && { viewport }),
    },
    metadata: {
      estimatedPattern,
      objectCount: Object.keys(boardState.objects).length,
      connectionCount: Object.keys(boardState.connections).length,
      maxIterations,
    },
  });

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt(boardState, { viewport: viewport ?? undefined, selectedIds: selectedIds?.length ? selectedIds : undefined }) },
    { role: 'user', content: command },
  ];

  let totalToolCalls = 0;
  let iterationsUsed = 0;

  try {
    for (let iter = 0; iter < maxIterations; iter++) {
      iterationsUsed = iter + 1;

      const generation = trace.generation({
        name: `openai-iter-${iter}`,
        model: 'gpt-4o-mini',
        input: { messages },
      });

      let response: OpenAI.ChatCompletion;
      try {
        response = await callWithRetry(() =>
          getOpenAI().chat.completions.create({
            model: 'gpt-4o-mini',
            messages,
            tools: getToolDefinitions(),
            tool_choice: 'auto',
          })
        );
      } catch (err: unknown) {
        generation.end({ output: { error: String(err) } });
        throw err;
      }

      generation.end({
        output: response.choices[0].message,
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0,
        },
      });

      const choice = response.choices[0];
      messages.push(choice.message as OpenAI.ChatCompletionMessageParam);

      if (choice.finish_reason !== 'tool_calls') break;

      const toolCalls = choice.message.tool_calls ?? [];
      totalToolCalls += toolCalls.length;

      // Dispatch all tool calls in parallel
      const toolResults = await Promise.all(
        toolCalls.map(async (tc) => {
          const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          const spanStart = Date.now();
          const span = trace.span?.({ name: `tool:${tc.function.name}` });
          let result: unknown;
          try {
            result = await dispatchTool(tc.function.name, args, boardId, userId, objectCache);
          } catch (err: unknown) {
            result = { error: String(err) };
          }
          span?.end({ output: result, metadata: { durationMs: Date.now() - spanStart } });
          return {
            role: 'tool' as const,
            tool_call_id: tc.id,
            content: JSON.stringify(result ?? null),
          };
        })
      );

      messages.push(...toolResults);
    }

    // Log quality scores
    const overlapCount = checkOverlaps(objectCache);
    trace.score?.({ name: 'overlap_count', value: overlapCount });
    trace.score?.({ name: 'iterations_used', value: iterationsUsed });
    trace.score?.({ name: 'tool_calls_total', value: totalToolCalls });

    const result = { success: true, message: `Executed ${totalToolCalls} operations` };
    trace.update({ output: { success: true, message: result.message, totalToolCalls } });
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    trace.update({ output: { success: false, error: message } });
    throw err;
  } finally {
    await getLangfuse().flushAsync();
  }
}

// ---------------------------------------------------------------------------
// Firebase Callable export
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Tool dispatcher
// ---------------------------------------------------------------------------

async function dispatchTool(
  toolName: string,
  args: Record<string, unknown>,
  boardId: string,
  userId: string,
  cache: agentTools.ObjectCache
): Promise<unknown> {
  switch (toolName) {
    case 'createStickyNote': {
      const x = args['x'] as number;
      const y = args['y'] as number;
      const id = await agentTools.createStickyNote(
        boardId, args['text'] as string, x, y, args['color'] as string, userId
      );
      cache.set(id, { x, y, width: 160, height: 120 });
      return id;
    }
    case 'createShape': {
      const x = args['x'] as number;
      const y = args['y'] as number;
      const w = args['width'] as number;
      const h = args['height'] as number;
      const id = await agentTools.createShape(
        boardId, args['type'] as agentTools.ShapeType, x, y, w, h, args['color'] as string, userId
      );
      cache.set(id, { x, y, width: w, height: h });
      return id;
    }
    case 'createFrame': {
      const x = args['x'] as number;
      const y = args['y'] as number;
      const w = args['width'] as number;
      const h = args['height'] as number;
      const id = await agentTools.createFrame(
        boardId, args['title'] as string, x, y, w, h, userId
      );
      cache.set(id, { x, y, width: w, height: h });
      return id;
    }
    case 'createBatch':
      return agentTools.createBatch(
        boardId,
        args['operations'] as agentTools.BatchCreateOp[],
        userId,
        cache
      );
    case 'connectBatch':
      return agentTools.connectBatch(
        boardId,
        args['connections'] as agentTools.BatchConnectOp[],
        userId,
        cache
      );
    case 'createConnector':
      return agentTools.createConnector(
        boardId,
        args['fromId'] as string,
        args['toId'] as string,
        (args['options'] as agentTools.ConnectorOptions) ?? {},
        userId
      );
    case 'createMultiPointConnector':
      return agentTools.createMultiPointConnector(
        boardId,
        args['objectIds'] as string[],
        (args['options'] as agentTools.MultiPointOptions) ?? {},
        userId
      );
    case 'connectInSequence':
      return agentTools.connectInSequence(
        boardId,
        args['objectIds'] as string[],
        (args['options'] as agentTools.SequenceOptions) ?? {},
        userId
      );
    case 'moveObject':
      return agentTools.moveObject(
        boardId,
        args['objectId'] as string,
        args['x'] as number,
        args['y'] as number
      );
    case 'resizeObject':
      return agentTools.resizeObject(
        boardId,
        args['objectId'] as string,
        args['width'] as number,
        args['height'] as number
      );
    case 'updateText':
      return agentTools.updateText(
        boardId,
        args['objectId'] as string,
        args['newText'] as string
      );
    case 'changeColor':
      return agentTools.changeColor(
        boardId,
        args['objectId'] as string,
        args['color'] as string
      );
    case 'deleteObjects':
      return agentTools.deleteObjects(
        boardId,
        args['objectIds'] as string[]
      );
    case 'getBoardState':
      return agentTools.getBoardState(boardId);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildSpatialBoardStateText(
  boardState: { objects: Record<string, unknown>; connections: Record<string, unknown> }
): string {
  const objValues = Object.values(boardState.objects) as Array<Record<string, unknown>>;
  const connValues = Object.values(boardState.connections) as Array<Record<string, unknown>>;

  const objectLines = objValues.map((o) => {
    const text = o['text'] ? `"${String(o['text']).slice(0, 40)}" ` : '';
    const id = String(o['id'] ?? '');
    const x = Math.round(Number(o['x'] ?? 0));
    const y = Math.round(Number(o['y'] ?? 0));
    const w = Math.round(Number(o['width'] ?? 160));
    const h = Math.round(Number(o['height'] ?? 120));
    const color = o['color'] ? ` ${String(o['color'])}` : '';
    const type = String(o['type'] ?? 'unknown');
    return `  [${type} ${text}id=${id} @ (${x},${y}) ${w}x${h}${color}]`;
  });

  const connLines = connValues.map((c) => {
    const from = String(c['fromId'] ?? '');
    const to = String(c['toId'] ?? '');
    const fromA = c['fromAnchor'] ? ` (${String(c['fromAnchor'])}` : '';
    const toA = c['toAnchor'] ? `→${String(c['toAnchor'])})` : '';
    return `  ${from} → ${to}${fromA}${toA}`;
  });

  // Compute bounding box of existing objects
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const o of objValues) {
    const x = Number(o['x'] ?? 0);
    const y = Number(o['y'] ?? 0);
    const w = Number(o['width'] ?? 160);
    const h = Number(o['height'] ?? 120);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }

  const occupiedLine = objValues.length > 0
    ? `Occupied region: x ${Math.round(minX)}–${Math.round(maxX)}, y ${Math.round(minY)}–${Math.round(maxY)}\nFree region for new content: x > ${Math.round(maxX + 100)} or y > ${Math.round(maxY + 100)}`
    : 'Board is empty. Start placing near (100, 100).';

  return [
    `Objects (${objValues.length}):`,
    ...objectLines,
    `Connections (${connValues.length}):`,
    ...connLines,
    occupiedLine,
  ].join('\n');
}

function buildSystemPrompt(
  boardState: { objects: Record<string, unknown>; connections: Record<string, unknown> },
  options?: { viewport?: { x: number; y: number; scale: number }; selectedIds?: string[] }
): string {
  const stateBlock = buildSpatialBoardStateText(boardState);
  const objCount = Object.keys(boardState.objects).length;
  const connCount = Object.keys(boardState.connections).length;

  // Compute viewport center for default placement guidance
  let viewportSection = '';
  if (options?.viewport) {
    const { x, y, scale } = options.viewport;
    const CANVAS_W = 1200;
    const CANVAS_H = 800;
    const left = Math.round(-x / scale);
    const top = Math.round(-y / scale);
    const right = Math.round(left + CANVAS_W / scale);
    const bottom = Math.round(top + CANVAS_H / scale);
    const cx = Math.round(left + (right - left) / 2);
    const cy = Math.round(top + (bottom - top) / 2);
    viewportSection = `
=== CURRENT VIEW ===
Viewport center: (${cx}, ${cy}) | Visible area: x ${left}–${right}, y ${top}–${bottom}
Place ALL new objects inside the visible area unless the user specifies coordinates.
Default anchor for new content: (${Math.round(cx - 80)}, ${Math.round(cy - 60)}).`;
  }

  // Selection context
  let selectionSection = '';
  if (options?.selectedIds?.length) {
    selectionSection = `
=== SELECTED OBJECTS ===
${options.selectedIds.join(', ')}
Operations like "delete", "move", "change color" apply to these IDs unless told otherwise.`;
  }

  return `You are the AI agent for CollabBoard, a real-time collaborative whiteboard.
Respond ONLY with tool calls — never plain text (except one short confirmation when finished).

=== BOARD STATE ===
${stateBlock}
(${objCount} objects, ${connCount} connections)
${viewportSection}${selectionSection}

=== COORDINATE SYSTEM ===
Origin: top-left. X increases right, Y increases down. Units: pixels.
Canvas: (0,0)–(2000,2000). Sticky: 160x120. Shape default: 150x100.
Minimum gap between objects: 60 px on all sides.

=== SPATIAL PLANNING — compute ALL coordinates before any tool calls ===
1. Identify layout pattern: grid, flowchart, tree, cluster, kanban, comparison.
2. Anchor at the viewport center (shown above) unless objects already exist nearby.
   If the board has content, place new content to the right or below (>=100 px margin).
3. Compute every (x,y) using:
     x = anchor_x + col * (object_width + gap_x)   [gap_x ~= 80]
     y = anchor_y + row * (object_height + gap_y)   [gap_y ~= 80]
4. Frame bounds when enclosing objects:
     frame_x = min(child_x) - 40,  frame_y = min(child_y) - 50  [title area]
     frame_w = max(child_x+child_w) - frame_x + 40
     frame_h = max(child_y+child_h) - frame_y + 40

=== LAYOUT RECIPES ===
SWOT — anchor at viewport center:
  Frame (cx-300, cy-280) 700x600
  Strengths (cx-240, cy-200) 200x150 #d4e4bc  | Opportunities (cx+20, cy-200) 200x150 #f5e6ab
  Weaknesses (cx-240, cy+30) 200x150 #e8c5c5 | Threats       (cx+20, cy+30) 200x150 #e8d4c5

Flowchart horizontal — steps at (cx-2*280+i*280, cy) 200x120 each; connectInSequence.
Flowchart vertical   — steps at (cx, cy-2*200+i*200) 200x120 each; connectInSequence.
Mind map — center (cx, cy); branches at radius 300, angles 0,60,120,180,240,300 deg.
Kanban (3 cols) — frames at (cx-450,cy-220),(cx-100,cy-220),(cx+250,cy-220) each 300x500.
Comparison (2 cols) — headers at (cx-200, cy-200) and (cx+100, cy-200); items spaced 170 below.

=== LINE DRAWINGS & FREE-FORM PATHS ===
To draw shapes, illustrations, or strokes (faces, arrows, decorative art):
- Use createConnector with options.points containing 20-100 waypoints
- ALWAYS set pointsRelative:true when using 5+ points:
    points[0] = absolute {x,y} start
    points[1..N] = relative {dx,dy} steps (~10-20px each for smooth curves)
- Each createConnector = one continuous stroke; use multiple connectors for complex drawings
- If no objects exist near the drawing area, create small (20x20) anchor shapes as endpoints
- Step size guide: 10-15px for smooth curves, 20-30px for angular/geometric paths

Example — ellipse at center (500,300), rx=80, ry=50 using 24 steps:
  points[0]={x:580,y:300} then 23 relative steps tracing the ellipse
  (each step: dx=cos(i*15°)*80-cos((i-1)*15°)*80, dy=sin(i*15°)*50-sin((i-1)*15°)*50)

Example — a face outline (~36 pts), left eye (~12 pts), right eye (~12 pts), mouth (~10 pts):
  4 separate createConnector calls, each with its own detailed points array

=== COLORS ===
Use ONLY these hex values: ${agentTools.BOARD_PALETTE_HEX.join(' ')}
Semantic: #d4e4bc=green(positive/strengths), #e8c5c5=rose(negative/weaknesses),
          #c5d5e8=blue(neutral), #f5e6ab=yellow(highlight/opportunities),
          #e8d4c5=peach(warning/threats), #d4c5e8=lavender, #c5e8d4=mint, #e0e0d0=grey.

=== WORKFLOW ===
1. PLAN: pick layout, compute all (x,y) coordinates, choose colors.
2. CREATE: use createBatch for multiple objects (returns [{tempId, actualId}]).
3. CONNECT: use connectBatch for multiple connections, connectInSequence for chains.
4. ADJUST: moveObject or resizeObject only if needed.
5. FINISH: one short confirmation message (no tool calls).

=== CRITICAL RULES ===
- DEFAULT OBJECT TYPE: use createStickyNote (not createShape) for any text-based content.
  Only use createShape for geometric/diagram shapes (boxes in flowcharts, circles, etc.).
- FRAMES: only create a frame when the user explicitly asks for a container or frame.
  Never auto-wrap content in frames.
- PLACEMENT: always place new objects within the visible viewport area shown above.
- DELETE: use deleteObjects with the object IDs to remove things. When user says "delete
  the selection" or "remove these", use the Selected Objects IDs listed above.
- Do NOT call getBoardState unless you need data not shown in the board state above.
- Do NOT create objects one at a time when createBatch is available.
- createBatch returns actualIds — use those (not tempIds) for all connections.
- connectInSequence(objectIds): connects A->B->C->D; prefer over multiple createConnector.
- Target 2-3 tool-call rounds total.`;
}

// ---------------------------------------------------------------------------
// Tool definitions (OpenAI schema)
// ---------------------------------------------------------------------------

function getToolDefinitions(): OpenAI.Chat.ChatCompletionTool[] {
  return [
    {
      type: 'function',
      function: {
        name: 'createBatch',
        description: 'Create multiple objects in one call. Returns [{tempId, actualId}]. Use actualIds for connections.',
        parameters: {
          type: 'object',
          properties: {
            operations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  tempId: { type: 'string', description: 'Your reference label (e.g. "s1", "frame1")' },
                  action: { type: 'string', enum: ['createStickyNote', 'createShape', 'createFrame'] },
                  params: {
                    type: 'object',
                    description: 'createStickyNote: {text,x,y,color}. createShape: {type,x,y,width,height,color}. createFrame: {title,x,y,width,height}.',
                  },
                },
                required: ['tempId', 'action', 'params'],
              },
            },
          },
          required: ['operations'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connectBatch',
        description: 'Create multiple connectors in one call. Reads objects once — much faster than multiple createConnector calls.',
        parameters: {
          type: 'object',
          properties: {
            connections: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  fromId: { type: 'string' },
                  toId: { type: 'string' },
                  options: {
                    type: 'object',
                    properties: {
                      fromAnchor: { type: 'string', enum: ['top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] },
                      toAnchor: { type: 'string', enum: ['top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] },
                      color: { type: 'string' },
                    },
                  },
                },
                required: ['fromId', 'toId'],
              },
            },
          },
          required: ['connections'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'deleteObjects',
        description: 'Delete one or more objects and all their connections. Use this when the user says "delete", "remove", or "clear". For "delete selection", pass the selected object IDs.',
        parameters: {
          type: 'object',
          properties: {
            objectIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'IDs of objects to delete',
            },
          },
          required: ['objectIds'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connectInSequence',
        description: 'Connect objects in a chain A->B->C->D. Pass ALL IDs in order. Prefer over multiple createConnector calls for sequences.',
        parameters: {
          type: 'object',
          properties: {
            objectIds: { type: 'array', items: { type: 'string' } },
            options: {
              type: 'object',
              properties: {
                color: { type: 'string' },
                direction: { type: 'string', enum: ['forward', 'bidirectional'] },
              },
            },
          },
          required: ['objectIds'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'createStickyNote',
        description: 'Create a sticky note (160x120). Returns its ID.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            x: { type: 'number' },
            y: { type: 'number' },
            color: { type: 'string', description: 'Board palette hex or name (yellow, pink, blue, green, etc.)' },
          },
          required: ['text', 'x', 'y', 'color'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'createShape',
        description: 'Create a shape. Returns its ID.',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['rectangle', 'circle', 'star'] },
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
            color: { type: 'string' },
          },
          required: ['type', 'x', 'y', 'width', 'height', 'color'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'createFrame',
        description: 'Create a labeled frame/container. Returns its ID.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
          },
          required: ['title', 'x', 'y', 'width', 'height'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'createConnector',
        description: 'Connect two objects with a line/arrow. For line drawings and illustrations, pack options.points with 20-100 {x,y} waypoints to trace detailed paths (faces, shapes, curves). Returns connection ID.',
        parameters: {
          type: 'object',
          properties: {
            fromId: { type: 'string' },
            toId: { type: 'string' },
            options: {
              type: 'object',
              properties: {
                fromAnchor: {
                  type: 'string',
                  enum: ['top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'star-0', 'star-1', 'star-2', 'star-3', 'star-4'],
                },
                toAnchor: {
                  type: 'string',
                  enum: ['top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'star-0', 'star-1', 'star-2', 'star-3', 'star-4'],
                },
                color: { type: 'string' },
                points: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { x: { type: 'number' }, y: { type: 'number' } },
                    required: ['x', 'y'],
                  },
                  description: 'Waypoints tracing the path. For simple bends: 1-3 points. For line drawings/illustrations: 20-100 points spaced 10-20px apart. Always pair with pointsRelative:true when using many points.',
                },
                pointsRelative: {
                  type: 'boolean',
                  description: 'When true: points[0] is absolute {x,y}, all subsequent points are relative {dx,dy} offsets from the previous point. ALWAYS use this when providing 5+ waypoints — it keeps output compact and lets you think in small steps.',
                },
              },
            },
          },
          required: ['fromId', 'toId'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'createMultiPointConnector',
        description: 'Connect multiple objects with optional curved lines. Returns array of connection IDs.',
        parameters: {
          type: 'object',
          properties: {
            objectIds: { type: 'array', items: { type: 'string' } },
            options: {
              type: 'object',
              properties: {
                color: { type: 'string' },
                curved: { type: 'boolean' },
              },
            },
          },
          required: ['objectIds'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'moveObject',
        description: 'Move an object to (x, y).',
        parameters: {
          type: 'object',
          properties: {
            objectId: { type: 'string' },
            x: { type: 'number' },
            y: { type: 'number' },
          },
          required: ['objectId', 'x', 'y'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'resizeObject',
        description: 'Resize an object.',
        parameters: {
          type: 'object',
          properties: {
            objectId: { type: 'string' },
            width: { type: 'number' },
            height: { type: 'number' },
          },
          required: ['objectId', 'width', 'height'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'updateText',
        description: 'Update text content of an object.',
        parameters: {
          type: 'object',
          properties: {
            objectId: { type: 'string' },
            newText: { type: 'string' },
          },
          required: ['objectId', 'newText'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'changeColor',
        description: 'Change the color of an object.',
        parameters: {
          type: 'object',
          properties: {
            objectId: { type: 'string' },
            color: { type: 'string' },
          },
          required: ['objectId', 'color'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'getBoardState',
        description: 'Get full board state. Only call if you need data not in the board state above.',
        parameters: { type: 'object', properties: {} },
      },
    },
  ];
}
