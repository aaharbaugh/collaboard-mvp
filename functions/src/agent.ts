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

interface CommandTracker {
  createdObjectIds: string[];
  createdConnectionIds: string[];
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
  // executePlan handles creation+connections in 1 call; allow extra rounds for post-processing
  if (/within|inside|arrange.*in/i.test(command)) return 3; // may need resize + moveBatch + addToFrame
  const needsPostProcessing = /frame|group|layer|background|kanban|swot/i.test(command);
  return needsPostProcessing ? 3 : 2;
}

// "create 50 stars", "make twenty blue circles", "add five sticky notes"
const BULK_CREATE_RE =
  /\b(\d+|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\s+(?:(?:yellow|green|blue|rose|red|lavender|mint|peach|grey|gray|purple|orange|pink|white)\s+)?(?:star|circle|rectangle|square|sticky.?note|note|card)s?\b/i;

// "stars in X pattern", "circles in a diamond" — shape + named layout, no count/verb required
const SHAPE_LAYOUT_RE =
  /\b(?:star|circle|rectangle|square|sticky.?note|note|card)s?\b.{0,80}\b(x[ -]?pattern|x[ -]?shape|cross|plus|diamond|rhombus|triangle|pyramid|circle|ring|radial)\b/i;

// shape + UNKNOWN layout word → ask for clarification
// Checked BEFORE BULK_CREATE_RE so "50 stars in heart pattern" triggers a question, not a grid
const UNKNOWN_LAYOUT_RE =
  /\b(?:star|circle|rectangle|square|sticky.?note|note|card)s?\b.{0,80}\b(?!(?:x[ -]?pattern|x[ -]?shape|cross|plus|diamond|rhombus|triangle|pyramid|circle|ring|radial|grid|row|column|horizontal|vertical)\b)\w{3,}\s+(?:pattern|layout|arrangement|formation)\b/i;

// Matches: "arrange them within the blue rectangle", "put these inside the frame", etc.
const ARRANGE_WITHIN_RE =
  /\b(arrange|put|place|pack|organize|fit|group|distribute|move)\b.{0,60}\b(within|inside|over|on|into|onto|in)\b/i;

function detectPattern(command: string, selectedIds?: string[]): string {
  if (/swot/i.test(command)) return 'swot';
  if (/kanban/i.test(command)) return 'kanban';
  if (/flowchart|flow chart/i.test(command)) return 'flowchart';
  if (/mind.?map/i.test(command)) return 'mindmap';
  if (/org.?chart|organization chart/i.test(command)) return 'orgchart';
  if (/comparison|compare|pros?.and.?cons?|pro.?con/i.test(command)) return 'comparison';
  // arrange_within only makes sense when objects are selected
  if (selectedIds && selectedIds.length >= 2 && ARRANGE_WITHIN_RE.test(command)) return 'arrange_within';
  // Check UNKNOWN_LAYOUT_RE before BULK_CREATE_RE so "50 stars in heart pattern" → ask, not grid
  if (UNKNOWN_LAYOUT_RE.test(command)) return 'unknown_layout';
  if (SHAPE_LAYOUT_RE.test(command)) return 'bulk_create'; // shape + named known layout
  if (BULK_CREATE_RE.test(command)) return 'bulk_create';  // explicit count
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
// Undo tracking helpers
// ---------------------------------------------------------------------------

const OBJECT_CREATE_TOOLS = new Set([
  'createStickyNote', 'createShape', 'createFrame', 'createText',
]);
const CONN_CREATE_TOOLS = new Set(['createConnector']);

function collectCreatedIds(toolName: string, result: unknown, tracker: CommandTracker): void {
  if (result == null) return;
  if (typeof result === 'string') {
    if (OBJECT_CREATE_TOOLS.has(toolName)) tracker.createdObjectIds.push(result);
    if (CONN_CREATE_TOOLS.has(toolName))   tracker.createdConnectionIds.push(result);
    return;
  }
  if (Array.isArray(result)) {
    if (['connectBatch', 'connectInSequence', 'createMultiPointConnector'].includes(toolName)) {
      tracker.createdConnectionIds.push(...(result as string[]));
    }
    if (toolName === 'createBatch') {
      (result as Array<{ id: string }>).forEach((item) => {
        if (item?.id) tracker.createdObjectIds.push(item.id);
      });
    }
    return;
  }
  if (typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (toolName === 'executePlan') {
      if (r['idMap'] && typeof r['idMap'] === 'object') {
        tracker.createdObjectIds.push(...Object.values(r['idMap'] as Record<string, string>));
      }
      if (Array.isArray(r['connectionIds'])) {
        tracker.createdConnectionIds.push(...(r['connectionIds'] as string[]));
      }
    }
    if (['createQuadrant', 'createColumnLayout'].includes(toolName)) {
      if (typeof r['frameId'] === 'string') tracker.createdObjectIds.push(r['frameId']);
      if (Array.isArray(r['objectIds']))     tracker.createdObjectIds.push(...(r['objectIds'] as string[]));
    }
    if (toolName === 'createDiagram') {
      if (Array.isArray(r['nodeIds']))        tracker.createdObjectIds.push(...(r['nodeIds'] as string[]));
      if (Array.isArray(r['connectionIds']))  tracker.createdConnectionIds.push(...(r['connectionIds'] as string[]));
    }
    if (toolName === 'createMany' && Array.isArray(r['objectIds'])) {
      tracker.createdObjectIds.push(...(r['objectIds'] as string[]));
    }
  }
}

// ---------------------------------------------------------------------------
// Exported business logic (also testable without the callable wrapper)
// ---------------------------------------------------------------------------

export async function runAgentCommand(
  params: AgentCommandRequest
): Promise<{ success: boolean; message: string; options?: string[]; undoInfo?: CommandTracker }> {
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
  const estimatedPattern = detectPattern(command, selectedIds?.length ? selectedIds : undefined);

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
  const tracker: CommandTracker = { createdObjectIds: [], createdConnectionIds: [] };

  try {
    // -----------------------------------------------------------------------
    // Fast path: template engine for recognized layout patterns
    // -----------------------------------------------------------------------
    if (estimatedPattern !== 'freeform') {
      const { client: tmplClient, model: tmplModel } = getPreferredClient();
      const templateResult = await executeTemplate(
        estimatedPattern,
        command,
        { boardId, userId, viewport: viewport ?? undefined, cache: objectCache, selectedIds: selectedIds?.length ? selectedIds : undefined },
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
        return {
          success: templateResult.success,
          message: templateResult.message,
          options: templateResult.options,
          undoInfo: templateResult.undoInfo,
        };
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
              collectCreatedIds(tc.function.name, result, tracker);
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

    const undoInfo =
      tracker.createdObjectIds.length > 0 || tracker.createdConnectionIds.length > 0
        ? tracker
        : undefined;
    const result = { success: true, message: `Executed ${totalToolCalls} operations`, undoInfo };
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
    case 'createQuadrant':
      return agentTools.createQuadrant(
        boardId,
        args as unknown as agentTools.CreateQuadrantArgs,
        userId
      );
    case 'createColumnLayout':
      return agentTools.createColumnLayout(
        boardId,
        args as unknown as agentTools.CreateColumnLayoutArgs,
        userId
      );
    case 'createDiagram':
      return agentTools.createDiagram(
        boardId,
        args as unknown as agentTools.CreateDiagramArgs,
        userId
      );
    case 'createMany':
      return agentTools.createMany(
        boardId,
        args as unknown as agentTools.CreateManyArgs,
        userId,
        cache
      );
    case 'arrangeWithin':
      return agentTools.arrangeWithin(
        boardId,
        args as unknown as agentTools.ArrangeWithinArgs,
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
  boardState: { objects: Record<string, unknown>; connections: Record<string, unknown> },
  /** When provided, positions are shown as signed offsets from this point (reduces digit count on large canvases). */
  origin?: { x: number; y: number }
): string {
  // Snap to nearest N to reduce digit noise
  const snap10 = (v: number) => Math.round(v / 10) * 10;
  const snap5  = (v: number) => Math.round(v / 5) * 5;
  // Format a position component as a signed relative offset string
  const relStr = (v: number, ref: number) => { const r = snap10(v - ref); return r >= 0 ? `+${r}` : `${r}`; };

  const objValues = Object.values(boardState.objects) as Array<Record<string, unknown>>;
  const connValues = Object.values(boardState.connections) as Array<Record<string, unknown>>;

  // Group objects that share the same type+color+dimensions — keeps context small for bulk selections
  type ObjGroup = {
    type: string; color: string; w: number; h: number;
    members: Array<{ id: string; x: number; y: number; text?: string }>;
  };
  const groupKey = (o: Record<string, unknown>) =>
    `${String(o['type']??'')}|${String(o['color']??'')}|${snap5(Number(o['width']??160))}|${snap5(Number(o['height']??120))}`;

  const groups = new Map<string, ObjGroup>();
  for (const o of objValues) {
    const key = groupKey(o);
    if (!groups.has(key)) {
      groups.set(key, {
        type: String(o['type'] ?? 'unknown'),
        color: o['color'] ? String(o['color']) : '',
        w: snap5(Number(o['width'] ?? 160)),
        h: snap5(Number(o['height'] ?? 120)),
        members: [],
      });
    }
    groups.get(key)!.members.push({
      id: String(o['id'] ?? ''),
      x: Number(o['x'] ?? 0),
      y: Number(o['y'] ?? 0),
      text: o['text'] ? String(o['text']).slice(0, 40) : undefined,
    });
  }

  const objectLines: string[] = [];
  for (const g of groups.values()) {
    if (g.members.length >= 4 && !g.members[0].text) {
      // Summarise the group: bounding box + id list
      let gMinX = Infinity, gMinY = Infinity, gMaxX = -Infinity, gMaxY = -Infinity;
      for (const m of g.members) {
        gMinX = Math.min(gMinX, m.x); gMinY = Math.min(gMinY, m.y);
        gMaxX = Math.max(gMaxX, m.x + g.w); gMaxY = Math.max(gMaxY, m.y + g.h);
      }
      const boxStr = origin
        ? `bbox(${relStr(gMinX,origin.x)},${relStr(gMinY,origin.y)})→(${relStr(gMaxX,origin.x)},${relStr(gMaxY,origin.y)})`
        : `bbox(${snap10(gMinX)},${snap10(gMinY)})→(${snap10(gMaxX)},${snap10(gMaxY)})`;
      const colorStr = g.color ? ` ${g.color}` : '';
      const ids = g.members.map(m => m.id).join(',');
      objectLines.push(`  [${g.members.length}x ${g.type} ${g.w}x${g.h}${colorStr} ${boxStr} ids=${ids}]`);
    } else {
      // Show each member individually
      for (const m of g.members) {
        const text = m.text ? `"${m.text}" ` : '';
        const colorStr = g.color ? ` ${g.color}` : '';
        const posStr = origin
          ? `(${relStr(m.x, origin.x)},${relStr(m.y, origin.y)})`
          : `(${snap10(m.x)},${snap10(m.y)})`;
        objectLines.push(`  [${g.type} ${text}id=${m.id} @ ${posStr} ${g.w}x${g.h}${colorStr}]`);
      }
    }
  }

  const connLines = connValues.map((c) => {
    const from = String(c['fromId'] ?? '');
    const to = String(c['toId'] ?? '');
    const fromA = c['fromAnchor'] ? ` (${String(c['fromAnchor'])}` : '';
    const toA = c['toAnchor'] ? `→${String(c['toAnchor'])})` : '';
    return `  ${from} → ${to}${fromA}${toA}`;
  });

  // Bounding box of existing objects
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

  let occupiedLine: string;
  if (objValues.length > 0) {
    if (origin) {
      occupiedLine = `Occupied (rel): x ${relStr(minX, origin.x)}–${relStr(maxX, origin.x)}, y ${relStr(minY, origin.y)}–${relStr(maxY, origin.y)}`;
    } else {
      occupiedLine = `Occupied: x ${snap10(minX)}–${snap10(maxX)}, y ${snap10(minY)}–${snap10(maxY)}\nFree: x>${snap10(maxX + 100)} or y>${snap10(maxY + 100)}`;
    }
  } else {
    occupiedLine = origin
      ? 'Board is empty. Place at (0, 0) relative = viewport center.'
      : 'Board is empty. Start placing near (100, 100).';
  }

  const header = origin
    ? `Objects (${objValues.length}) — positions are ±offsets from viewport center:`
    : `Objects (${objValues.length}):`;

  return [
    header,
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
  const objCount = Object.keys(boardState.objects).length;
  const connCount = Object.keys(boardState.connections).length;

  // Compute viewport center — used for compact relative display AND absolute placement guidance
  let viewportSection = '';
  let stateOrigin: { x: number; y: number } | undefined;
  if (options?.viewport) {
    const { x, y, scale } = options.viewport;
    const CANVAS_W = options.viewport.width ?? 1200;
    const CANVAS_H = options.viewport.height ?? 800;
    const left = Math.round(-x / scale);
    const top  = Math.round(-y / scale);
    const right  = Math.round(left + CANVAS_W / scale);
    const bottom = Math.round(top  + CANVAS_H / scale);
    const cx = Math.round(left + (right - left) / 2);
    const cy = Math.round(top  + (bottom - top)  / 2);
    stateOrigin = { x: cx, y: cy };
    viewportSection = `
=== CURRENT VIEW ===
Viewport center (ABSOLUTE): (${cx}, ${cy}) | Visible: x ${left}–${right}, y ${top}–${bottom}
Board state positions are ±offsets from this center. Tool call coords MUST be absolute:
  abs_x = ${cx} + rel_x  |  abs_y = ${cy} + rel_y
Default anchor for new content: (${Math.round(cx - 80)}, ${Math.round(cy - 60)}).`;
  }

  const stateBlock = buildSpatialBoardStateText(boardState, stateOrigin);

  // Selection context
  let selectionSection = '';
  if (options?.selectedIds?.length) {
    selectionSection = `
=== SELECTED OBJECTS ===
${options.selectedIds.join(', ')}
Operations like "delete", "move", "change color" apply to these IDs unless told otherwise.`;
  }

  return `You are the AI agent for CollabBoard. Respond ONLY with tool calls (one short confirmation when done).

=== BEHAVIOR ===
NEVER ask clarifying questions. ALWAYS act immediately using sensible defaults:
• NEVER refuse. Flags, logos, maps, symbols — build everything from rectangles, circles, and stars.
  Flag = stripes (rectangles) + canton (rectangle) + stars (createMany). Build it, don't describe it.
• Keep final confirmation to ONE short sentence (e.g. "Done — created US flag with 13 stripes and 50 stars.").
• Color not specified → yellow for sticky notes, blue for shapes
• Layout not specified → grid
• Size not specified → use type defaults (stickyNote 160×120, star/circle 100×100, rectangle 200×120)
• Count not specified → 1 (unless context implies more)
• Position not specified → viewport center
If user says "create 50 stars" with no other details, call createMany immediately with grid layout and default color.

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

=== COMPOUND TOOLS (prefer these — ONE call instead of 7+) ===
• SWOT / 2×2 matrix → createQuadrant({ title, quadrantLabels: { topLeft, topRight, bottomLeft, bottomRight }, items: { topLeft: [...], ... }, anchorX: cx, anchorY: cy })
• Kanban / retro / journey map → createColumnLayout({ title, columns: [{ title, items: [...] }, ...], anchorX: cx, anchorY: cy })
• Flowchart / sequence diagram → createDiagram({ nodes: [{ label }, ...], edges: [{ from: 0, to: 1 }, ...], layout: "horizontal"|"vertical", anchorX: cx, anchorY: cy })
• 5+ identical objects → createMany({ objectType, count, layout:"grid"|"row"|"column"|"circle", anchorX, anchorY, color, gap })
  Server computes ALL coordinates — do NOT pass x/y per item. Add containerId to pack inside an existing object.
• Arrange existing objects INTO a container → arrangeWithin({ objectIds:[...], containerId, layout:"grid", resizeToFit:true })
  Server reads real dimensions, packs tightly, resizes container. One call replaces moveBatch+resizeObject.
All create frame + content + frameId + fit in one atomic write. Use viewport center for anchorX/anchorY when given.

=== LAYOUTS (when NOT using compound tools; cx,cy = viewport center) ===
Flowchart H: nodes at (cx-N*140+i*280, cy) 200×120, connectInSequence
Flowchart V: nodes at (cx, cy-N*100+i*200) 200×120, connectInSequence
SWOT: use createQuadrant. Kanban: use createColumnLayout. Flowchart: use createDiagram.
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
• PREFER compound tools for templates: createQuadrant (SWOT/matrix), createColumnLayout (kanban/retro), createDiagram (flowchart). One call = one round-trip.
• BULK CREATION: When creating 5+ copies of the same object type, ALWAYS use createMany — never list 50 objects in executePlan. The LLM must NOT compute coordinates for bulk objects; the server does it.
• ARRANGE INTO CONTAINER: When user says "arrange [selection] within/inside [X]", use arrangeWithin({objectIds:[...non-container IDs...], containerId:"...", layout:"grid", resizeToFit:true}). Do NOT use moveBatch with manual coordinates for this case.
• For freeform creation use executePlan (objects + connections in one call).
• FRAMES: when using executePlan, every frame MUST have addToFrame called in Round 2 with its child object IDs. Compound tools set frameId automatically.
  Failure to call addToFrame = children will not move with the frame.
• Place ALL new objects inside the visible viewport area shown above.
• COORDINATES: All x/y in tool calls are ABSOLUTE world coords. Board state shows relative
  offsets (±N) — convert before using: abs_x = viewport_cx + rel_x, abs_y = viewport_cy + rel_y.
• EXACT COORDS: If user says "at position X, Y" or "at X, Y", use those exact numbers verbatim as x and y params. Do NOT adjust for viewport.
• SHAPE DEFAULTS: rectangle = width:200, height:120. circle = width:120, height:120.
• BATCH MOVE: ALWAYS use moveBatch([{id,x,y},...]) instead of multiple moveObject calls.
  One moveBatch call handles all moves atomically — never loop moveObject one-by-one.
• ARRANGE IN GRID: Sort objects by x then y. Compute cols=ceil(sqrt(N)), rows=ceil(N/cols).
  cellW=obj.width+gap, cellH=obj.height+gap. Anchor at min(x), min(y) of selection.
  Call moveBatch with all computed positions in one call.
• SPACE EVENLY: Sort by axis (horizontal → by x, vertical → by y). Distribute positions
  between first and last object position. Call moveBatch with all positions.
• ARRANGE WITHIN CONTAINER: When user says "arrange [items] within/inside [X]":
  1. IDENTIFY CONTAINER: the object the user named/described (e.g. "the blue sticky note",
     "the frame"). Read its id, x_c, y_c, w_c, h_c from board state.
  2. ITEMS = all other selected objects (NOT the container itself).
  3. Use gap=8px. avg_item_w and avg_item_h from item dimensions (or type defaults).
     cols = max(1, floor((w_c - 40) / (avg_item_w + gap)))
     rows = ceil(N / cols)
     needed_h = rows * (avg_item_h + gap) + 40
  4. If needed_h > h_c OR cols * (avg_item_w + gap) + 40 > w_c:
     → Call resizeObject(containerId, max(w_c, cols*(avg_item_w+gap)+40), needed_h) FIRST
       to make the container large enough to hold all items.
  5. Place items row-by-row starting from top-left interior (x_c+20, y_c+20):
     item_x = x_c + 20 + col_i * (avg_item_w + gap)
     item_y = y_c + 20 + row_i * (avg_item_h + gap)
  6. Call moveBatch with ALL computed positions in one call.
  7. If container is a frame, also call addToFrame(itemIds, containerId).
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
        name: 'createQuadrant',
        description: 'ONE CALL: Create a full quadrant/matrix diagram (e.g. SWOT). Creates frame, axis lines, axis labels, quadrant titles, and sticky notes per quadrant; assigns all to frame and fits frame. Use instead of 7+ separate create/addToFrame calls.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Frame title (e.g. "SWOT Analysis")' },
            xAxisLabel: { type: 'string', description: 'Optional, e.g. "Low ← → High"' },
            yAxisLabel: { type: 'string', description: 'Optional, e.g. "Low ← → High"' },
            quadrantLabels: {
              type: 'object',
              properties: {
                topLeft: { type: 'string' },
                topRight: { type: 'string' },
                bottomLeft: { type: 'string' },
                bottomRight: { type: 'string' },
              },
              description: 'Section titles per quadrant (e.g. Strengths, Weaknesses, Opportunities, Threats)',
            },
            items: {
              type: 'object',
              properties: {
                topLeft: { type: 'array', items: { type: 'string' } },
                topRight: { type: 'array', items: { type: 'string' } },
                bottomLeft: { type: 'array', items: { type: 'string' } },
                bottomRight: { type: 'array', items: { type: 'string' } },
              },
              description: 'Sticky note text per quadrant',
            },
            anchorX: { type: 'number', description: 'Placement X (e.g. viewport center). Omit to auto-place.' },
            anchorY: { type: 'number', description: 'Placement Y. Omit to auto-place.' },
          },
          required: ['title'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'createColumnLayout',
        description: 'ONE CALL: Create kanban/retro/journey map. Frame + column headers + sticky notes per column; frameId set and frame fitted. Use instead of 5+ separate calls.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Frame title' },
            columns: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Column header' },
                  items: { type: 'array', items: { type: 'string' }, description: 'Sticky note text' },
                },
                required: ['title', 'items'],
              },
            },
            anchorX: { type: 'number' },
            anchorY: { type: 'number' },
          },
          required: ['title', 'columns'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'createDiagram',
        description: 'ONE CALL: Create flowchart/sequence. Nodes (sticky notes) + connectors in one write. Layout horizontal or vertical by node index.',
        parameters: {
          type: 'object',
          properties: {
            nodes: {
              type: 'array',
              items: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] },
              description: 'Node labels; order = position',
            },
            edges: {
              type: 'array',
              items: {
                type: 'object',
                properties: { from: { type: 'number' }, to: { type: 'number' } },
                required: ['from', 'to'],
                description: 'Indices into nodes (0-based)',
              },
            },
            layout: { type: 'string', enum: ['horizontal', 'vertical'] },
            anchorX: { type: 'number' },
            anchorY: { type: 'number' },
          },
          required: ['nodes', 'edges'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'createMany',
        description: 'Create N identical objects in ONE server-side call. The server computes ALL positions — you only specify count, layout type, and anchor. Use this instead of executePlan whenever creating 5+ copies of the same shape. Also accepts containerId to pack items inside an existing object (resizes container if needed).',
        parameters: {
          type: 'object',
          properties: {
            objectType:  { type: 'string', enum: ['stickyNote', 'rectangle', 'circle', 'star'], description: 'Type of object to create' },
            count:       { type: 'number', description: 'Number of objects (1–200)' },
            layout:      { type: 'string', enum: ['grid', 'row', 'column', 'circle'], description: 'How to arrange the objects' },
            anchorX:     { type: 'number', description: 'Top-left x of layout (absolute). Ignored when containerId is set.' },
            anchorY:     { type: 'number', description: 'Top-left y of layout (absolute). Ignored when containerId is set.' },
            itemWidth:   { type: 'number', description: 'Width of each item (px). Defaults: stickyNote=160, shapes=100.' },
            itemHeight:  { type: 'number', description: 'Height of each item (px). Defaults: stickyNote=120, circle=100, other=80.' },
            gap:         { type: 'number', description: 'Gap between items in px (default 10).' },
            color:       { type: 'string', description: 'Color name or hex for all items.' },
            text:        { type: 'string', description: 'Text label for stickyNote objects (same on all copies).' },
            containerId: { type: 'string', description: 'If set, pack all items inside this container; server resizes container if needed.' },
          },
          required: ['objectType', 'count', 'layout'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'arrangeWithin',
        description: 'Move EXISTING selected objects into a tight grid inside a container. Server reads actual dimensions, computes all positions, and resizes the container if needed. Use instead of moveBatch + resizeObject when packing objects into a container.',
        parameters: {
          type: 'object',
          properties: {
            objectIds:    { type: 'array', items: { type: 'string' }, description: 'Firebase IDs of objects to arrange (do NOT include containerId).' },
            containerId:  { type: 'string', description: 'Firebase ID of the container (frame, sticky note, or shape).' },
            layout:       { type: 'string', enum: ['grid', 'row', 'column'], description: 'Layout within container (default grid).' },
            gap:          { type: 'number', description: 'Gap between items in px (default 8).' },
            resizeToFit:  { type: 'boolean', description: 'Resize container if items don\'t fit (default true).' },
            addToFrame:   { type: 'boolean', description: 'Set frameId on items so they belong to the frame (default false).' },
          },
          required: ['objectIds', 'containerId'],
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
