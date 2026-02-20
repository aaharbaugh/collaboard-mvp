import * as admin from 'firebase-admin';
import OpenAI from 'openai';
import { Client, RunTree } from 'langsmith';
import * as agentTools from './agentTools.js';
import { executeTemplate } from './templateEngine.js';

// Initialize Admin SDK once per cold start
if (!admin.apps.length) {
  admin.initializeApp();
}

// Lazily initialized to avoid crashing during Firebase deploy analysis (env vars not set at load time)
let _openai: OpenAI | null = null;
let _groq: OpenAI | null = null;
let _langsmith: Client | null = null;

function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

/** Groq: OpenAI-compatible drop-in (~275 tok/s). Used for template content extraction. */
function getGroqClient(): OpenAI | null {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  if (!_groq) _groq = new OpenAI({ apiKey: key, baseURL: 'https://api.groq.com/openai/v1' });
  return _groq;
}

/** Returns Groq (llama-3.3-70b-versatile) if configured, else OpenAI (gpt-4o-mini). */
function getPreferredClient(): { client: OpenAI; model: string } {
  const groq = getGroqClient();
  if (groq) return { client: groq, model: 'llama-3.3-70b-versatile' };
  return { client: getOpenAI(), model: 'gpt-4o' };
}

/** Returns null if LANGSMITH_API_KEY is missing or a placeholder — tracing is optional. */
function getLangsmith(): Client | null {
  const key = process.env.LANGSMITH_API_KEY;
  if (!key || key.startsWith('your-')) return null;
  if (!_langsmith) _langsmith = new Client({ apiKey: key });
  return _langsmith;
}

/** Fire-and-forget wrapper: tracing errors are swallowed so they can never crash the agent. */
function withTrace(fn: () => Promise<unknown>): Promise<void> {
  return fn().then(() => undefined).catch(() => undefined);
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
  /** When set (and no selection), only objects in visible viewport are sent.
   *  width/height are the actual canvas pixel dimensions for accurate placement guidance. */
  viewport?: { x: number; y: number; scale: number; width?: number; height?: number };
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
  // executePlan handles creation+connections in 1 call; allow 1 extra for post-processing
  const needsPostProcessing = /frame|group|layer|background|kanban|swot/i.test(command);
  return needsPostProcessing ? 3 : 2;
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

  // LangSmith observability — optional (no-op if LANGSMITH_API_KEY is not set)
  const langsmith = getLangsmith();
  let rootRun: RunTree | null = null;
  if (langsmith) {
    rootRun = new RunTree({
      name: 'agent-command',
      run_type: 'chain',
      inputs: {
        boardId, command, userId, userName,
        ...(selectedIds?.length && { selectedIds }),
        ...(viewport && { viewport }),
      },
      client: langsmith,
      project_name: process.env.LANGSMITH_PROJECT ?? 'collabboard',
      metadata: {
        estimatedPattern,
        objectCount: Object.keys(boardState.objects).length,
        connectionCount: Object.keys(boardState.connections).length,
        maxIterations,
      },
      tags: [estimatedPattern],
    });
    await withTrace(() => rootRun!.postRun());
  }

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt(boardState, { viewport: viewport ?? undefined, selectedIds: selectedIds?.length ? selectedIds : undefined }) },
    { role: 'user', content: command },
  ];

  let totalToolCalls = 0;
  let iterationsUsed = 0;

  try {
    // -----------------------------------------------------------------------
    // Fast path: template engine for recognized layout patterns
    // -----------------------------------------------------------------------
    if (estimatedPattern !== 'freeform') {
      const { client: tmplClient, model: tmplModel } = getPreferredClient();
      const templateResult = await executeTemplate(
        estimatedPattern,
        command,
        { boardId, userId, viewport: viewport ?? undefined, cache: objectCache },
        tmplClient,
        tmplModel,
      );
      if (templateResult) {
        if (rootRun && langsmith) {
          await withTrace(() => langsmith!.createFeedback(rootRun!.id, 'template_used', { score: 1 }));
          await withTrace(async () => {
            await rootRun!.end({ success: true, message: templateResult.message, templatePattern: estimatedPattern });
            await rootRun!.patchRun();
          });
        }
        return { success: true, message: templateResult.message };
      }
      // Template returned null (unsupported pattern or error) → fall through to agentic loop
    }

    // -----------------------------------------------------------------------
    // Agentic loop (freeform or template fallback)
    // -----------------------------------------------------------------------
    for (let iter = 0; iter < maxIterations; iter++) {
      iterationsUsed = iter + 1;

      await agentTools.writeAgentStatus(boardId, { phase: 'thinking', iteration: iter + 1, maxIterations });

      // LangSmith: child run for this LLM iteration
      const llmRun = rootRun?.createChild({
        name: `openai-iter-${iter}`,
        run_type: 'llm',
        inputs: { messages },
        extra: { invocation_params: { model: 'gpt-4o' } },
      }) ?? null;
      if (llmRun) await withTrace(() => llmRun!.postRun());

      let response: OpenAI.ChatCompletion;
      try {
        response = await callWithRetry(() =>
          getOpenAI().chat.completions.create({
            model: 'gpt-4o',
            messages,
            tools: getToolDefinitions(),
            tool_choice: 'auto',
          })
        );
      } catch (err: unknown) {
        if (llmRun) await withTrace(async () => { await llmRun!.end(undefined, String(err)); await llmRun!.patchRun(); });
        throw err;
      }

      if (llmRun) {
        await withTrace(async () => {
          await llmRun!.end({
            output: response.choices[0].message,
            usage: {
              prompt_tokens: response.usage?.prompt_tokens ?? 0,
              completion_tokens: response.usage?.completion_tokens ?? 0,
              total_tokens: response.usage?.total_tokens ?? 0,
            },
          });
          await llmRun!.patchRun();
        });
      }

      const choice = response.choices[0];
      messages.push(choice.message as OpenAI.ChatCompletionMessageParam);

      if (choice.finish_reason !== 'tool_calls') break;

      const toolCalls = choice.message.tool_calls ?? [];
      totalToolCalls += toolCalls.length;

      await agentTools.writeAgentStatus(boardId, {
        phase: 'calling_tools',
        tools: toolCalls.map((t) => t.function.name),
      });

      // Dispatch all tool calls in parallel
      const toolResults = await Promise.all(
        toolCalls.map(async (tc) => {
          const spanStart = Date.now();
          let result: unknown;
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          } catch {
            result = { error: `Invalid JSON in arguments for ${tc.function.name}` };
          }
          const toolRun = rootRun?.createChild({
            name: `tool:${tc.function.name}`,
            run_type: 'tool',
            inputs: args,
          }) ?? null;
          if (toolRun) await withTrace(() => toolRun!.postRun());
          if (!result) {
            try {
              result = await dispatchTool(tc.function.name, args, boardId, userId, objectCache);
            } catch (err: unknown) {
              result = { error: String(err) };
            }
          }
          if (toolRun) {
            await withTrace(async () => {
              await toolRun!.end({ result, durationMs: Date.now() - spanStart });
              await toolRun!.patchRun();
            });
          }
          return {
            role: 'tool' as const,
            tool_call_id: tc.id,
            content: JSON.stringify(result ?? null),
          };
        })
      );

      messages.push(...toolResults);
    }

    // Log quality scores as LangSmith feedback
    const overlapCount = checkOverlaps(objectCache);
    if (rootRun && langsmith) {
      await withTrace(() => Promise.all([
        langsmith!.createFeedback(rootRun!.id, 'overlap_count', { score: overlapCount }),
        langsmith!.createFeedback(rootRun!.id, 'iterations_used', { score: iterationsUsed }),
        langsmith!.createFeedback(rootRun!.id, 'tool_calls_total', { score: totalToolCalls }),
      ]));
    }

    const result = { success: true, message: `Executed ${totalToolCalls} operations` };
    if (rootRun) {
      await withTrace(async () => {
        await rootRun!.end({ success: true, message: result.message, totalToolCalls });
        await rootRun!.patchRun();
      });
    }
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (rootRun) {
      await withTrace(async () => {
        await rootRun!.end(undefined, message);
        await rootRun!.patchRun();
      });
    }
    throw err;
  } finally {
    await agentTools.clearAgentStatus(boardId);
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
    case 'createText': {
      const x = args['x'] as number;
      const y = args['y'] as number;
      const w = (args['width'] as number) ?? 240;
      const h = (args['height'] as number) ?? 60;
      const id = await agentTools.createText(
        boardId, args['text'] as string, x, y, w, h, (args['color'] as string) ?? '#1a1a1a', userId
      );
      cache.set(id, { x, y, width: w, height: h });
      return id;
    }
    case 'addToFrame':
      return agentTools.addToFrame(
        boardId,
        args['objectIds'] as string[],
        args['frameId'] as string
      );
    case 'setLayer':
      return agentTools.setLayer(
        boardId,
        args['objectId'] as string,
        args['sentToBack'] as boolean
      );
    case 'rotateObject':
      return agentTools.rotateObject(
        boardId,
        args['objectId'] as string,
        args['rotation'] as number
      );
    case 'executePlan':
      return agentTools.executePlan(
        boardId,
        (args['objects'] ?? []) as agentTools.BatchCreateOp[],
        (args['connections'] ?? []) as agentTools.PlanConnection[],
        userId,
        cache
      );
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
    case 'moveBatch':
      return agentTools.moveBatch(
        boardId,
        args['moves'] as Array<{ id: string; x: number; y: number }>
      );
    case 'fitFrameToContents':
      return agentTools.fitFrameToContents(
        boardId,
        args['frameId'] as string,
        (args['padding'] as number | undefined) ?? 40
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
  options?: { viewport?: { x: number; y: number; scale: number; width?: number; height?: number }; selectedIds?: string[] }
): string {
  const stateBlock = buildSpatialBoardStateText(boardState);
  const objCount = Object.keys(boardState.objects).length;
  const connCount = Object.keys(boardState.connections).length;

  // Compute viewport center for default placement guidance
  let viewportSection = '';
  if (options?.viewport) {
    const { x, y, scale } = options.viewport;
    // Use actual canvas dimensions when available; fall back to common defaults
    const CANVAS_W = options.viewport.width ?? 1200;
    const CANVAS_H = options.viewport.height ?? 800;
    const left = Math.round(-x / scale);
    const top = Math.round(-y / scale);
    const right = Math.round(left + CANVAS_W / scale);
    const bottom = Math.round(top + CANVAS_H / scale);
    const cx = Math.round(left + (right - left) / 2);
    const cy = Math.round(top + (bottom - top) / 2);
    viewportSection = `
=== CURRENT VIEW ===
Viewport center: (${cx}, ${cy}) | Visible area: x ${left}–${right}, y ${top}–${bottom}
Canvas pixel size: ${CANVAS_W}×${CANVAS_H} at scale ${scale.toFixed(2)}
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

  return `You are the AI agent for CollabBoard. Respond ONLY with tool calls (one short confirmation when done).

=== BOARD STATE ===
${stateBlock}
(${objCount} objects, ${connCount} connections)
${viewportSection}${selectionSection}

=== PRIMITIVES ===
stickyNote 160×120 colored card — use for all text content/ideas
text       transparent heading/label — H1=240×60 H2=200×50 H3=180×44, color=#1a1a1a
rectangle/circle/star — geometric shapes for flowchart nodes, diagrams
frame      labeled container — create first, then addToFrame children

=== COORDINATES ===
Origin top-left, X→right, Y→down, pixels. Min gap: 60px.
x = anchor_x + col*(w+80)  |  y = anchor_y + row*(h+80)
Frame bounds: x=min(child_x)-40, y=min(child_y)-50, w/h=span+80

=== LAYOUTS (cx,cy = viewport center) ===
Flowchart H: nodes at (cx-N*140+i*280, cy) 200×120, connectInSequence
Flowchart V: nodes at (cx, cy-N*100+i*200) 200×120, connectInSequence
SWOT: Frame(cx-300,cy-280,700,600) | S(cx-240,cy-200,green) W(cx-240,cy+30,rose) O(cx+20,cy-200,yellow) T(cx+20,cy+30,peach) each 200×150
Kanban 3-col: frames at (cx-450,cy-200),(cx-100,cy-200),(cx+250,cy-200) each 300×500
Mind map: center node + branches at radius 300, angles 0,60,120,180,240,300°

=== LAYERS ===
setLayer(id, sentToBack=true) = behind arrows | addToFrame(ids, frameId) = group children

=== COLORS ===
Backgrounds: ${agentTools.BOARD_PALETTE_HEX.join(' ')}
green=positive  rose=negative  blue=neutral  yellow=highlight  peach=warning  mint/lavender/grey=accent

=== WORKFLOW ===
Round 1: executePlan({objects, connections})
  • ALL creation in one call. objects:[] is valid for connection-only commands.
  • Each object MUST have: tempId, action, AND params:{x,y,...} — params is REQUIRED.
    createStickyNote params: {text, x, y, color}
    createShape params:      {type:"rectangle"|"circle"|"star", x, y, width, height, color}
    createFrame params:      {title, x, y, width, height}
    createText params:       {text, x, y, width, height, color}
  • connections[]: fromId/toId = tempId or existing Firebase ID from board state above.
  • Returns {idMap:{tempId→actualId}, connectionIds}
Round 2 — REQUIRED when frames were created: call addToFrame(childIds, frameId) for EVERY
  frame created. Use idMap values (actual IDs) not tempIds. Also use Round 2 for:
  moveBatch / fitFrameToContents / setLayer / rotateObject / deleteObjects
Round 3: one short text confirmation, no tool calls.

=== RULES ===
• executePlan is the ONLY way to create objects — no other creation tools exist.
• FRAMES: every frame MUST have addToFrame called in Round 2 with its child object IDs.
  Failure to call addToFrame = children will not move with the frame.
• Place ALL new objects inside the visible viewport area shown above.
• EXACT COORDS: If user says "at position X, Y" or "at X, Y", use those exact numbers verbatim as x and y params. Do NOT adjust for viewport.
• SHAPE DEFAULTS: rectangle = width:200, height:120. circle = width:120, height:120.
• BATCH MOVE: ALWAYS use moveBatch([{id,x,y},...]) instead of multiple moveObject calls.
  One moveBatch call handles all moves atomically — never loop moveObject one-by-one.
• ARRANGE IN GRID: Sort objects by x then y. Compute cols=ceil(sqrt(N)), rows=ceil(N/cols).
  cellW=obj.width+gap, cellH=obj.height+gap. Anchor at min(x), min(y) of selection.
  Call moveBatch with all computed positions in one call.
• SPACE EVENLY: Sort by axis (horizontal → by x, vertical → by y). Distribute positions
  between first and last object position. Call moveBatch with all positions.
• FIT FRAME: Use fitFrameToContents(frameId) when user asks to "resize frame to fit contents".
• DELETE: deleteObjects(objectIds). "Delete selection" = use Selected Object IDs above.
• Do NOT call getBoardState unless critical data is missing from the board state above.
• Target 1 tool-call round. 2 maximum when frames or batch moves are involved.`;
}

// ---------------------------------------------------------------------------
// Tool definitions (OpenAI schema)
// ---------------------------------------------------------------------------

function getToolDefinitions(): OpenAI.Chat.ChatCompletionTool[] {
  const anchorEnum = ['top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
  return [
    {
      type: 'function',
      function: {
        name: 'executePlan',
        description: 'THE ONLY creation tool. Creates objects AND connections in one Firebase write. Use tempId strings ("s1","f1") in objects[]; reference same strings in connections[]. Returns {idMap:{tempId→actualId}, connectionIds}.',
        parameters: {
          type: 'object',
          properties: {
            objects: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  tempId: { type: 'string' },
                  action: { type: 'string', enum: ['createStickyNote', 'createShape', 'createFrame', 'createText'] },
                  params: {
                    type: 'object',
                    description: 'REQUIRED. Must include x and y. createStickyNote:{text,x,y,color} createShape:{type:"rectangle"|"circle"|"star",x,y,width,height,color} createFrame:{title,x,y,width,height} createText:{text,x,y,width,height,color}',
                    properties: {
                      x:      { type: 'number', description: 'X position (required)' },
                      y:      { type: 'number', description: 'Y position (required)' },
                      text:   { type: 'string' },
                      title:  { type: 'string' },
                      type:   { type: 'string', enum: ['rectangle', 'circle', 'star'] },
                      width:  { type: 'number' },
                      height: { type: 'number' },
                      color:  { type: 'string' },
                    },
                    required: ['x', 'y'],
                  },
                },
                required: ['tempId', 'action', 'params'],
              },
            },
            connections: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  fromId: { type: 'string', description: 'tempId or existing Firebase ID' },
                  toId:   { type: 'string', description: 'tempId or existing Firebase ID' },
                  options: {
                    type: 'object',
                    properties: {
                      color:      { type: 'string' },
                      fromAnchor: { type: 'string', enum: anchorEnum },
                      toAnchor:   { type: 'string', enum: anchorEnum },
                    },
                  },
                },
                required: ['fromId', 'toId'],
              },
            },
          },
          required: ['objects', 'connections'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'connectBatch',
        description: 'Connect existing objects in bulk. One Firebase write. Do NOT use for objects just created in executePlan — put connections directly in executePlan.',
        parameters: {
          type: 'object',
          properties: {
            connections: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  fromId: { type: 'string' },
                  toId:   { type: 'string' },
                  options: {
                    type: 'object',
                    properties: {
                      fromAnchor: { type: 'string', enum: anchorEnum },
                      toAnchor:   { type: 'string', enum: anchorEnum },
                      color:      { type: 'string' },
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
        name: 'connectInSequence',
        description: 'Connect existing objects in a chain A→B→C→D. For connecting EXISTING objects only.',
        parameters: {
          type: 'object',
          properties: {
            objectIds: { type: 'array', items: { type: 'string' } },
            options: {
              type: 'object',
              properties: {
                color:     { type: 'string' },
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
        name: 'addToFrame',
        description: 'Group objects into a frame as children (they move with the frame).',
        parameters: {
          type: 'object',
          properties: {
            objectIds: { type: 'array', items: { type: 'string' } },
            frameId:   { type: 'string' },
          },
          required: ['objectIds', 'frameId'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'setLayer',
        description: 'sentToBack=true → behind arrows (background shapes). sentToBack=false → front.',
        parameters: {
          type: 'object',
          properties: {
            objectId:   { type: 'string' },
            sentToBack: { type: 'boolean' },
          },
          required: ['objectId', 'sentToBack'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'rotateObject',
        description: 'Rotate an object (degrees 0–360).',
        parameters: {
          type: 'object',
          properties: {
            objectId: { type: 'string' },
            rotation: { type: 'number' },
          },
          required: ['objectId', 'rotation'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'moveBatch',
        description: 'Move multiple existing objects in one atomic write. ALWAYS prefer this over multiple moveObject calls. Use for arrange/grid/space/align commands.',
        parameters: {
          type: 'object',
          properties: {
            moves: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Firebase object ID' },
                  x:  { type: 'number' },
                  y:  { type: 'number' },
                },
                required: ['id', 'x', 'y'],
              },
            },
          },
          required: ['moves'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'fitFrameToContents',
        description: 'Resize a frame to tightly wrap all its children. Use for "resize frame to fit" commands.',
        parameters: {
          type: 'object',
          properties: {
            frameId: { type: 'string' },
            padding: { type: 'number', description: 'Extra px on each side (default 40)' },
          },
          required: ['frameId'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'moveObject',
        description: 'Move a single existing object to (x, y). For moving multiple objects use moveBatch.',
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
        description: 'Resize an existing object.',
        parameters: {
          type: 'object',
          properties: {
            objectId: { type: 'string' },
            width:  { type: 'number' },
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
        description: 'Update text content of an existing object.',
        parameters: {
          type: 'object',
          properties: {
            objectId: { type: 'string' },
            newText:  { type: 'string' },
          },
          required: ['objectId', 'newText'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'changeColor',
        description: 'Change color of an existing object.',
        parameters: {
          type: 'object',
          properties: {
            objectId: { type: 'string' },
            color:    { type: 'string' },
          },
          required: ['objectId', 'color'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'deleteObjects',
        description: 'Delete objects and their connections. "Delete selection" → use Selected Object IDs from board state.',
        parameters: {
          type: 'object',
          properties: {
            objectIds: { type: 'array', items: { type: 'string' } },
          },
          required: ['objectIds'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'getBoardState',
        description: 'Get full board state. Only if critical data is missing from board state above.',
        parameters: { type: 'object', properties: {} },
      },
    },
  ];
}
