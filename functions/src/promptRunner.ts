import * as admin from 'firebase-admin';
import OpenAI from 'openai';
import { Client, RunTree } from 'langsmith';
import { API_EXECUTORS } from './apiRegistry.js';

// Initialize Admin SDK once per cold start
if (!admin.apps.length) {
  admin.initializeApp();
}

// Lazily initialized
let _openai: OpenAI | null = null;
let _groq: OpenAI | null = null;
let _langsmith: Client | null = null;

function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

function getGroqClient(): OpenAI | null {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  if (!_groq) _groq = new OpenAI({ apiKey: key, baseURL: 'https://api.groq.com/openai/v1' });
  return _groq;
}

function getPreferredClient(): { client: OpenAI; model: string } {
  const groq = getGroqClient();
  if (groq) return { client: groq, model: 'llama-3.3-70b-versatile' };
  return { client: getOpenAI(), model: 'gpt-4o-mini' };
}

function getLangsmith(): Client | null {
  const key = process.env.LANGSMITH_API_KEY;
  if (!key || key.startsWith('your-')) return null;
  if (!_langsmith) _langsmith = new Client({ apiKey: key });
  return _langsmith;
}

/** Fire-and-forget wrapper: tracing errors never crash the prompt runner. */
function withTrace(fn: () => Promise<unknown>): Promise<void> {
  return fn().then(() => undefined).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PillRef {
  id: string;
  label: string;
  node: number;
  direction: 'in' | 'out';
  outputMode?: 'update' | 'append' | 'create';
  maxChars?: number;
  parseMode?: 'list' | 'whole';
  apiGroup?: string;
}

interface Wire {
  id: string;
  fromObjectId: string;
  fromNode: number;
  toObjectId: string;
  toNode: number;
  outputMode?: 'update' | 'append' | 'create';
}

interface BoardObject {
  id: string;
  type?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color?: string;
  text?: string;
  promptTemplate?: string;
  pills?: PillRef[];
  promptOutput?: string;
  createdBy?: string;
  apiConfig?: { apiId: string };
}

const STICKY_COLORS = ['#e6d070', '#a8c888', '#98b8d8', '#d8b898', '#c8a8d8', '#d8a8a8'];
const STICKY_WIDTH = 160;
const STICKY_HEIGHT = 120;
const FRAME_PAD = 20;
const INNER_GAP = 8;

export interface RunPromptRequest {
  boardId: string;
  objectId: string;
  userId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse an LLM response that has labeled [section] headers into a map. */
export function parseSections(text: string, labels: string[]): Map<string, string> {
  const result = new Map<string, string>();
  if (labels.length === 0) return result;

  // Build regex that matches [label]: at start of line (case-insensitive)
  const escaped = labels.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`^\\[(${escaped.join('|')})\\]:\\s*`, 'im');

  // Split text by section headers
  const parts = text.split(pattern);
  // parts: [preamble, label1, content1, label2, content2, ...]
  for (let i = 1; i < parts.length - 1; i += 2) {
    const label = parts[i].toLowerCase();
    const content = (parts[i + 1] ?? '').trim();
    // Match to original label (case-insensitive)
    const original = labels.find((l) => l.toLowerCase() === label);
    if (original) result.set(original, content);
  }

  // If parsing failed (LLM didn't follow format), put whole text in first label
  if (result.size === 0) {
    result.set(labels[0], text.trim());
  }

  return result;
}

/** Split a combined multi-item LLM response into per-item blocks. */
export function parseItemBlocks(text: string, numItems: number): string[] {
  // Try splitting on "--- Item N ---" markers
  const blocks: string[] = [];
  const itemPattern = /^---\s*Item\s+\d+\s*---\s*$/gim;
  const parts = text.split(itemPattern);
  // First element is preamble (usually empty), rest are item blocks
  const itemParts = parts.slice(1);
  if (itemParts.length >= numItems) {
    for (let i = 0; i < numItems; i++) {
      blocks.push((itemParts[i] ?? '').trim());
    }
    return blocks;
  }

  // Fallback: try splitting on numbered headers like "1." or "Item 1:"
  const numberedPattern = /^(?:Item\s+)?\d+[.):]\s*/gim;
  const numParts = text.split(numberedPattern).slice(1);
  if (numParts.length >= numItems) {
    for (let i = 0; i < numItems; i++) {
      blocks.push((numParts[i] ?? '').trim());
    }
    return blocks;
  }

  // Last resort: treat entire text as single block replicated
  for (let i = 0; i < numItems; i++) {
    blocks.push(text.trim());
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Collision-aware placement helper
// ---------------------------------------------------------------------------

export function findFreePosition(
  x: number,
  startY: number,
  width: number,
  height: number,
  existingObjects: BoardObject[],
  gap: number = INNER_GAP,
  maxAttempts: number = 20,
): { x: number; y: number } {
  let y = startY;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const overlaps = existingObjects.some((obj) => {
      const ox = obj.x ?? 0;
      const oy = obj.y ?? 0;
      const ow = obj.width ?? 0;
      const oh = obj.height ?? 0;
      return x < ox + ow && x + width > ox && y < oy + oh && y + height > oy;
    });
    if (!overlaps) return { x, y };
    y += height + gap;
  }
  return { x, y };
}

// ---------------------------------------------------------------------------
// Status update helper
// ---------------------------------------------------------------------------

export async function updateRunStatus(
  db: admin.database.Database,
  boardId: string,
  objectId: string,
  status: 'running' | 'success' | 'error',
  error?: string,
): Promise<void> {
  const update: Record<string, unknown> = {
    lastRunStatus: status,
    lastRunAt: Date.now(),
    lastRunError: status === 'error' ? (error ?? null) : null,
  };
  await db.ref(`boards/${boardId}/objects/${objectId}`).update(update);
}

// ---------------------------------------------------------------------------
// Output routing helper
// ---------------------------------------------------------------------------

export async function routeOutputToTarget(
  db: admin.database.Database,
  boardId: string,
  targetId: string,
  content: string,
  mode: 'update' | 'append' | 'create',
  opts: {
    sourceObjectId: string;
    runStamp: string;
    wireIdSlug: string;
    userId: string;
    now: number;
    stickyIndex: number;
    noteIdPrefix?: string;
    color?: string;
    allObjects?: BoardObject[];
    label?: string;
    fanOutSource?: string;
  },
): Promise<{ stickyCreated: boolean; newObject?: BoardObject }> {
  if (mode === 'update') {
    await db.ref(`boards/${boardId}/objects/${targetId}`).update({ promptOutput: content });
    return { stickyCreated: false };
  }

  if (mode === 'append') {
    const targetRef = db.ref(`boards/${boardId}/objects/${targetId}/promptOutput`);
    await targetRef.transaction((current: string | null) => {
      if (current) return `${current}\n\n${content}`;
      return content;
    });
    return { stickyCreated: false };
  }

  // mode === 'create'
  const targetSnap = await db.ref(`boards/${boardId}/objects/${targetId}`).get();
  const target = targetSnap.val() as BoardObject | null;
  if (!target) return { stickyCreated: false };

  const allObjs = opts.allObjects ?? [];
  const startY = (target.y ?? 0) + (target.height ?? STICKY_HEIGHT) + INNER_GAP;
  const pos = findFreePosition(target.x ?? 0, startY, STICKY_WIDTH, STICKY_HEIGHT, allObjs);
  const prefix = opts.noteIdPrefix ?? 'result';
  const noteId = `${prefix}-${opts.sourceObjectId}-${opts.runStamp}-${opts.wireIdSlug}`;
  const newObj: Record<string, unknown> = {
    id: noteId,
    type: 'stickyNote',
    x: pos.x,
    y: pos.y,
    width: STICKY_WIDTH,
    height: STICKY_HEIGHT,
    color: opts.color ?? '#98b8d8',
    text: opts.label ?? '',
    promptOutput: content,
    createdBy: opts.userId,
    createdAt: opts.now + opts.stickyIndex + 1,
  };
  if (opts.fanOutSource) newObj.fanOutSource = opts.fanOutSource;
  await db.ref(`boards/${boardId}/objects/${noteId}`).set(newObj);
  return { stickyCreated: true, newObject: newObj as unknown as BoardObject };
}

// ---------------------------------------------------------------------------
// Template resolution helper
// ---------------------------------------------------------------------------

export function resolveTemplate(
  template: string,
  pills: PillRef[],
  inputValues: Map<string, string>,
  overrides?: Map<string, string>,
): string {
  let resolved = template;
  for (const pill of pills) {
    if (pill.apiGroup) continue;
    const token = `{${pill.label}}`;
    if (pill.direction === 'in') {
      const value = overrides?.get(pill.id) ?? inputValues.get(pill.id) ?? '';
      resolved = resolved.split(token).join(value);
    } else {
      resolved = resolved.split(token).join(`[${pill.label}]`);
    }
  }
  resolved = resolved.replace(/\[API:[^\]]+\]/g, '');
  return resolved.replace(/  +/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function runPromptNode(req: RunPromptRequest): Promise<{ success: boolean; output?: string; error?: string }> {
  const db = admin.database();
  const { boardId, objectId } = req;

  // LangSmith observability — deferred until we know this is an LLM run (not API)
  const langsmith = getLangsmith();
  let rootRun: RunTree | null = null;

  // 1. Read the object
  const objSnap = await db.ref(`boards/${boardId}/objects/${objectId}`).get();
  if (!objSnap.exists()) {
    return { success: false, error: 'Object not found' };
  }
  const obj = objSnap.val() as BoardObject;
  const pills: PillRef[] = obj.pills ?? [];
  const template = obj.promptTemplate ?? obj.text ?? '';

  if (!template && !obj.apiConfig?.apiId) {
    return { success: false, error: 'No prompt template' };
  }

  // Mark as running
  await updateRunStatus(db, boardId, objectId, 'running');

  try {
    // 2. Read wires
    const wiresSnap = await db.ref(`boards/${boardId}/wires`).get();
    const wires: Record<string, Wire> = wiresSnap.val() ?? {};

    // 3. Categorize pills
    const inPills = pills.filter((p) => p.direction === 'in');
    const outPills = pills.filter((p) => p.direction === 'out');

    // 4. Resolve input pill values from wired sources
    // Strategy: first try exact node match, then fall back to any unmatched incoming wire.
    // Multiple sources converging on one input are combined into a single value (not fan-out).
    const incomingWires = Object.values(wires).filter((w) => w.toObjectId === objectId);
    const usedIncomingWireIds = new Set<string>();
    const inputValues: Map<string, string> = new Map();
    // Track which pills got their value from a SINGLE source (eligible for fan-out)
    const singleSourcePills = new Set<string>();

    // Helper: read source text from a wire's origin object
    const readSource = async (wire: Wire): Promise<string> => {
      const snap = await db.ref(`boards/${boardId}/objects/${wire.fromObjectId}`).get();
      if (!snap.exists()) return '';
      const src = snap.val() as BoardObject;
      return src.promptOutput ?? src.text ?? '';
    };

    for (const pill of inPills) {
      const pillNode = Number(pill.node);
      const matchingWires = incomingWires.filter((w) => Number(w.toNode) === pillNode);
      const sourceTexts: string[] = [];
      for (const wire of matchingWires) {
        usedIncomingWireIds.add(wire.id);
        const t = await readSource(wire);
        if (t) sourceTexts.push(t);
      }
      if (sourceTexts.length === 1) singleSourcePills.add(pill.id);
      // Multiple sources: join with ", " so they read as a list, not as fan-out lines
      inputValues.set(pill.id, sourceTexts.length > 1 ? sourceTexts.join(', ') : (sourceTexts[0] ?? ''));
    }

    // Fallback: if any input pill got nothing, grab unmatched incoming wires.
    // Skip wires from frames — frames are output containers, not input sources.
    for (const pill of inPills) {
      if (inputValues.get(pill.id)) continue;
      const unmatched = incomingWires.filter((w) => !usedIncomingWireIds.has(w.id));
      const sourceTexts: string[] = [];
      for (const wire of unmatched) {
        // Peek at source type — don't consume wires from frames
        const srcSnap = await db.ref(`boards/${boardId}/objects/${wire.fromObjectId}/type`).get();
        const srcType = srcSnap.val() as string | null;
        if (srcType === 'frame') continue;
        usedIncomingWireIds.add(wire.id);
        const t = await readSource(wire);
        if (t) sourceTexts.push(t);
      }
      if (sourceTexts.length > 0) {
        if (sourceTexts.length === 1) singleSourcePills.add(pill.id);
        inputValues.set(pill.id, sourceTexts.length > 1 ? sourceTexts.join(', ') : sourceTexts[0]);
      }
    }

    // 4b. API node short-circuit — fetch external API instead of LLM
    if (obj.apiConfig?.apiId) {
      const executor = API_EXECUTORS[obj.apiConfig.apiId];
      if (!executor) {
        throw new Error(`Unknown API: ${obj.apiConfig.apiId}`);
      }

      // Build params from API-group input pill values only (pill label → value)
      const apiInPills = inPills.filter((p) => p.apiGroup === obj.apiConfig!.apiId);
      const params: Record<string, string> = {};
      for (const pill of apiInPills) {
        params[pill.label] = inputValues.get(pill.id) ?? '';
      }

      console.log(`[promptRunner] API node: ${obj.apiConfig.apiId}, params:`, params);

      // Execute the API — either via custom execute() or simple buildUrl+formatResponse
      let formattedResult: string;
      if (executor.execute) {
        formattedResult = await executor.execute(params);
      } else {
        const url = executor.buildUrl!(params);
        const apiResponse = await fetch(url);
        if (!apiResponse.ok) {
          throw new Error(`API ${obj.apiConfig.apiId} returned HTTP ${apiResponse.status}`);
        }
        const apiData = await apiResponse.json();
        formattedResult = executor.formatResponse!(apiData);
      }

      console.log(`[promptRunner] API result: ${formattedResult.slice(0, 100)}`);

      // Store the result on the API node itself (promptOutput)
      await db.ref(`boards/${boardId}/objects/${objectId}`).update({
        promptOutput: formattedResult,
      });

      // Route output through output pills + wires (same pattern as LLM nodes)
      const outgoingWires = Object.values(wires).filter(
        (w) => w.fromObjectId === objectId && !usedIncomingWireIds.has(w.id),
      );

      const now = Date.now();
      const runStamp = now.toString(36);
      let stickiesCreated = 0;

      // Match outgoing wires to output pills by node number
      const assignedWireIds = new Set<string>();
      for (const outPill of outPills) {
        const matched = outgoingWires.filter((w) => Number(w.fromNode) === Number(outPill.node));
        const mode = outPill.outputMode ?? 'update';
        for (const wire of matched) {
          assignedWireIds.add(wire.id);
          const result = await routeOutputToTarget(db, boardId, wire.toObjectId, formattedResult, mode, {
            sourceObjectId: objectId, runStamp, wireIdSlug: wire.id.slice(0, 4),
            userId: req.userId, now, stickyIndex: stickiesCreated, noteIdPrefix: 'apiresult',
          });
          if (result.stickyCreated) stickiesCreated++;
        }
      }

      // Fallback: unmatched outgoing wires → route to first output pill target
      const unmatched = outgoingWires.filter((w) => !assignedWireIds.has(w.id));
      for (const wire of unmatched) {
        await routeOutputToTarget(db, boardId, wire.toObjectId, formattedResult, 'update', {
          sourceObjectId: objectId, runStamp, wireIdSlug: wire.id.slice(0, 4),
          userId: req.userId, now, stickyIndex: stickiesCreated,
        });
      }

      // If no outgoing wires at all, create a result sticky below the API node
      if (outgoingWires.length === 0) {
        const resultId = `apiresult-${objectId}-${runStamp}`;
        const resultX = obj.x ?? 0;
        const resultY = (obj.y ?? 0) + (obj.height ?? STICKY_HEIGHT) + INNER_GAP;
        await db.ref(`boards/${boardId}/objects/${resultId}`).set({
          id: resultId, type: 'stickyNote',
          x: resultX, y: resultY, width: STICKY_WIDTH, height: STICKY_HEIGHT,
          color: '#98b8d8', text: '', promptOutput: formattedResult,
          createdBy: req.userId, createdAt: now,
        });
      }

      // Update prompt node status
      await updateRunStatus(db, boardId, objectId, 'success');

      return { success: true, output: formattedResult };
    }

    // ── LLM path: initialize LangSmith trace (API nodes already returned above) ──
    if (langsmith) {
      rootRun = new RunTree({
        name: 'prompt-node-run',
        run_type: 'chain',
        inputs: {
          boardId, objectId, userId: req.userId,
          template,
          inputPills: inPills.map((p) => ({ label: p.label, node: p.node })),
          outputPills: outPills.map((p) => ({ label: p.label, node: p.node, maxChars: p.maxChars })),
        },
        client: langsmith,
        project_name: process.env.LANGSMITH_PROJECT ?? 'collabboard',
      });
      await withTrace(() => rootRun!.postRun());
    }

    // 5. Detect multi-line inputs for fan-out (opt-in via parseMode: 'list')
    // By default, multi-line inputs are passed as a single block of text.
    // Fan-out (one LLM call per line) only activates when a pill has parseMode: 'list'.
    const multiLineInputs: Map<string, string[]> = new Map();
    let maxLines = 0;
    for (const [pillId, value] of inputValues) {
      if (!singleSourcePills.has(pillId)) continue; // combined sources → never fan out
      // Fan-out is opt-in: only split multi-line inputs when parseMode is explicitly 'list'
      const pillDef = pills.find((p) => p.id === pillId);
      if (pillDef?.parseMode !== 'list') continue;
      const lines = value.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
      if (lines.length > 1) {
        multiLineInputs.set(pillId, lines);
        maxLines = Math.max(maxLines, lines.length);
      }
    }
    const hasMultiLine = maxLines > 1;
    const numRows = hasMultiLine ? maxLines : 1;

    // 6. Build system prompt
    const { client, model } = getPreferredClient();
    let systemPrompt = 'You are a data processing node on a collaborative whiteboard. Execute the instruction exactly. Be concise.';

    // If there are output pills, instruct LLM to produce labeled sections
    const hasOutputPills = outPills.length > 0;
    if (hasOutputPills) {
      const sectionList = outPills
        .map((p) => {
          const charNote = p.maxChars ? ` (max ${p.maxChars} chars)` : '';
          return `[${p.label}]:${charNote}`;
        })
        .join('\n');
      systemPrompt += `\n\nFormat your response with these exact labeled sections:\n${sectionList}\n\nPut each section's content after its label on the same or following lines.`;
      if (hasMultiLine) {
        systemPrompt += `\n\nWhen processing multiple items, separate each item's response with a "--- Item N ---" header, then provide the labeled sections for that item.`;
      }
    } else {
      // No output pills — apply global maxChars if any
      const globalLimit = pills.find((p) => p.maxChars && p.maxChars > 0)?.maxChars;
      if (globalLimit) {
        systemPrompt += ` Your response MUST be ${globalLimit} characters or fewer.`;
      }
    }

    // 7. Build the prompt text (replace input pills with values, keep output pill labels visible)
    // Skip API-group pills — they belong to the API block, not the LLM prompt.
    const resolve = (overrides?: Map<string, string>): string =>
      resolveTemplate(template, pills, inputValues, overrides);

    // 8. Call LLM helper (with LangSmith child run + token tracking)
    let llmCallIndex = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    const callLLM = async (prompt: string): Promise<string> => {
      const callIdx = llmCallIndex++;
      let childRun: RunTree | null = null;
      if (rootRun) {
        childRun = await rootRun.createChild({
          name: `llm-call-${callIdx}`,
          run_type: 'llm',
          inputs: {
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: prompt },
            ],
          },
          extra: { invocation_params: { model } },
        });
        await withTrace(() => childRun!.postRun());
      }

      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        max_tokens: 4096,
        temperature: 0.3,
      });
      const result = response.choices?.[0]?.message?.content ?? '';

      // Accumulate token totals for root run
      if (response.usage) {
        totalPromptTokens += response.usage.prompt_tokens ?? 0;
        totalCompletionTokens += response.usage.completion_tokens ?? 0;
      }

      if (childRun) {
        await withTrace(async () => {
          childRun!.end({
            output: { content: result },
            usage: {
              prompt_tokens: response.usage?.prompt_tokens ?? 0,
              completion_tokens: response.usage?.completion_tokens ?? 0,
              total_tokens: response.usage?.total_tokens ?? 0,
            },
          });
          await childRun!.patchRun();
        });
      }

      return result;
    };

    // 9. Build rows: one per fan-out line (or just one row if no multi-line)
    const rows: { overrides: Map<string, string>; rowLabel: string }[] = [];
    if (hasMultiLine) {
      for (let i = 0; i < maxLines; i++) {
        const overrides = new Map(inputValues);
        const labelParts: string[] = [];
        for (const [pillId, lines] of multiLineInputs) {
          const lineVal = lines[i] ?? lines[lines.length - 1];
          overrides.set(pillId, lineVal);
          labelParts.push(lineVal);
        }
        rows.push({ overrides, rowLabel: labelParts.join(' | ') });
      }
    } else {
      rows.push({ overrides: inputValues, rowLabel: '' });
    }

    // 10. Build a single combined prompt for all rows
    const outLabels = outPills.map((p) => p.label);
    let llmResults: string[];

    if (rows.length === 1) {
      // Single row — call LLM directly
      const result = await callLLM(resolve(rows[0].overrides));
      llmResults = [result];
    } else {
      // Multi-row — combine into one prompt, parse response back into items
      const itemPrompts = rows.map((r, i) => {
        const resolved = resolve(r.overrides);
        return `--- Item ${i + 1} ---\n${resolved}`;
      });
      const combinedPrompt = `Process each item below separately. For each item, respond with its own "--- Item N ---" header followed by your answer.\n\n${itemPrompts.join('\n\n')}`;
      const combinedResult = await callLLM(combinedPrompt);
      llmResults = parseItemBlocks(combinedResult, rows.length);
    }

    // 11. Parse each result into sections (one per output pill)
    const parsedRows: Map<string, string>[] = llmResults.map((text) => {
      if (hasOutputPills) {
        const sections = parseSections(text, outLabels);
        // Apply per-pill maxChars truncation
        for (const pill of outPills) {
          if (pill.maxChars) {
            const val = sections.get(pill.label) ?? '';
            if (val.length > pill.maxChars) {
              sections.set(pill.label, val.slice(0, pill.maxChars));
            }
          }
        }
        return sections;
      }
      // No output pills — single column
      return new Map([['_result', text]]);
    });

    // 12. Output routing — route through wires when available, else create under prompt node.
    const promptX = obj.x ?? 0;
    const promptY = obj.y ?? 0;
    const promptH = obj.height ?? STICKY_HEIGHT;
    const now = Date.now();
    const runStamp = now.toString(36);
    const userId = req.userId;

    // Find outgoing wires from this prompt node (wires where this object is the source).
    // Exclude wires already used for input resolution — those go TO input pills, not from output pills.
    const outgoingWires = Object.values(wires).filter(
      (w) => w.fromObjectId === objectId && !usedIncomingWireIds.has(w.id),
    );

    // Separate output pills into wired (have outgoing wires) and unwired.
    // A wire matches a pill if its fromNode equals the pill's node, but users often
    // click a nearby anchor instead of the exact pill, so unmatched wires fall back
    // to the first output pill.
    interface TargetWire { targetId: string; wire: Wire }
    const wiredPills: { pill: PillRef; targetWires: TargetWire[] }[] = [];
    const unwiredLabels: string[] = [];

    if (hasOutputPills) {
      const assignedWireIds = new Set<string>();

      // First pass: exact node match
      for (const pill of outPills) {
        const matched = outgoingWires
          .filter((w) => Number(w.fromNode) === Number(pill.node))
          .map((w) => { assignedWireIds.add(w.id); return { targetId: w.toObjectId, wire: w }; });
        if (matched.length > 0) {
          wiredPills.push({ pill, targetWires: matched });
        }
      }

      // Second pass: unmatched outgoing wires → assign to first output pill
      const unmatched = outgoingWires
        .filter((w) => !assignedWireIds.has(w.id))
        .map((w) => ({ targetId: w.toObjectId, wire: w }));
      if (unmatched.length > 0) {
        const existing = wiredPills.find((wp) => wp.pill === outPills[0]);
        if (existing) {
          existing.targetWires.push(...unmatched);
        } else {
          wiredPills.push({ pill: outPills[0], targetWires: unmatched });
        }
      }

      // Unwired pills: output pills with zero wires
      for (const pill of outPills) {
        if (!wiredPills.some((wp) => wp.pill === pill)) {
          unwiredLabels.push(pill.label);
        }
      }
    } else {
      unwiredLabels.push('_result');
    }

    console.log(`[promptRunner] Output: numRows=${numRows}, wiredPills=${wiredPills.length}, unwiredLabels=${unwiredLabels.length}`);

    let stickiesCreated = 0;

    // --- Route wired output pills to their targets ---
    for (const { pill, targetWires } of wiredPills) {
      // Collect content for this pill across all rows
      const rowContents = parsedRows.map((sections) => sections.get(pill.label) ?? '');
      const joinedContent = numRows > 1 ? rowContents.join('\n---\n') : rowContents[0];
      const mode = pill.outputMode ?? 'update';

      console.log(`[promptRunner] Routing pill "${pill.label}" mode=${mode} to ${targetWires.length} target(s)`);

      for (const tw of targetWires) {
        if (mode === 'update' || mode === 'append') {
          await routeOutputToTarget(db, boardId, tw.targetId, joinedContent, mode, {
            sourceObjectId: objectId, runStamp, wireIdSlug: `w${tw.wire.id.slice(0, 4)}`,
            userId, now, stickyIndex: stickiesCreated, fanOutSource: objectId,
          });
        } else if (mode === 'create') {
          // Read target object position + all objects for collision detection
          const targetSnap = await db.ref(`boards/${boardId}/objects/${tw.targetId}`).get();
          const target = targetSnap.val() as BoardObject | null;
          if (!target) continue;
          const allObjSnap = await db.ref(`boards/${boardId}/objects`).get();
          const allObjs = Object.values((allObjSnap.val() ?? {}) as Record<string, BoardObject>);

          if (numRows > 1) {
            // Fan-out: one sticky per row below target
            for (let r = 0; r < numRows; r++) {
              const content = rowContents[r];
              const result = await routeOutputToTarget(db, boardId, tw.targetId, content, 'create', {
                sourceObjectId: objectId, runStamp, wireIdSlug: `w${tw.wire.id.slice(0, 4)}-r${r}`,
                userId, now, stickyIndex: stickiesCreated,
                color: STICKY_COLORS[stickiesCreated % STICKY_COLORS.length],
                label: rows[r].rowLabel ?? '', allObjects: allObjs, fanOutSource: objectId,
              });
              if (result.stickyCreated && result.newObject) {
                allObjs.push(result.newObject);
                stickiesCreated++;
              }
            }
          } else {
            const result = await routeOutputToTarget(db, boardId, tw.targetId, joinedContent, 'create', {
              sourceObjectId: objectId, runStamp, wireIdSlug: `w${tw.wire.id.slice(0, 4)}`,
              userId, now, stickyIndex: stickiesCreated, allObjects: allObjs, fanOutSource: objectId,
            });
            if (result.stickyCreated) stickiesCreated++;
          }
        }
      }
    }

    // --- Unwired output pills: create under prompt node (existing behavior) ---
    if (unwiredLabels.length > 0) {
      const numCols = unwiredLabels.length;
      const needsGrid = numRows > 1 || numCols > 1;

      if (needsGrid) {
        const frameW = FRAME_PAD * 2 + numCols * STICKY_WIDTH + (numCols - 1) * INNER_GAP;
        const frameH = FRAME_PAD * 2 + numRows * STICKY_HEIGHT + (numRows - 1) * INNER_GAP;
        const frameX = promptX;
        const frameY = promptY + promptH + INNER_GAP;
        const frameId = `fanframe-${objectId}-${runStamp}`;

        await db.ref(`boards/${boardId}/objects/${frameId}`).set({
          id: frameId, type: 'frame',
          x: frameX, y: frameY, width: frameW, height: frameH,
          color: '#3a3a3a', text: '', sentToBack: true,
          createdBy: userId, createdAt: now, fanOutSource: objectId,
        });

        for (let r = 0; r < numRows; r++) {
          const sections = parsedRows[r];
          const rowLabel = rows[r].rowLabel;
          for (let c = 0; c < numCols; c++) {
            const colLabel = unwiredLabels[c];
            const content = sections.get(colLabel) ?? '';
            const noteId = `fan-${objectId}-${runStamp}-r${r}-c${c}`;
            const noteColor = STICKY_COLORS[stickiesCreated % STICKY_COLORS.length];
            const noteX = frameX + FRAME_PAD + c * (STICKY_WIDTH + INNER_GAP);
            const noteY = frameY + FRAME_PAD + r * (STICKY_HEIGHT + INNER_GAP);
            const displayLabel = rowLabel
              ? (numCols > 1 ? `${rowLabel} — ${colLabel}` : rowLabel)
              : (numCols > 1 ? colLabel : '');

            await db.ref(`boards/${boardId}/objects/${noteId}`).set({
              id: noteId, type: 'stickyNote',
              x: noteX, y: noteY, width: STICKY_WIDTH, height: STICKY_HEIGHT,
              color: noteColor, text: displayLabel, promptOutput: content,
              createdBy: userId, createdAt: now + stickiesCreated + 1,
              fanOutSource: objectId, frameId,
            });
            stickiesCreated++;
          }
        }
      } else {
        const output = parsedRows[0].get(unwiredLabels[0]) ?? llmResults[0];
        const resultId = `result-${objectId}-${runStamp}`;
        const resultX = promptX;
        const resultY = promptY + promptH + INNER_GAP;

        await db.ref(`boards/${boardId}/objects/${resultId}`).set({
          id: resultId, type: 'stickyNote',
          x: resultX, y: resultY, width: STICKY_WIDTH, height: STICKY_HEIGHT,
          color: '#98b8d8', text: '', promptOutput: output,
          createdBy: userId, createdAt: now, fanOutSource: objectId,
        });
        stickiesCreated++;
      }
    }

    // Update prompt node status
    await updateRunStatus(db, boardId, objectId, 'success');

    const summaryOutput = stickiesCreated > 0
      ? `Routed output (${stickiesCreated} stickies created)`
      : (wiredPills.length > 0 ? 'Output routed to wired targets' : llmResults[0]);

    if (rootRun) {
      await withTrace(async () => {
        rootRun!.end({
          outputs: { success: true, output: summaryOutput.slice(0, 200), stickiesCreated, wiredPills: wiredPills.length },
          usage: {
            prompt_tokens: totalPromptTokens,
            completion_tokens: totalCompletionTokens,
            total_tokens: totalPromptTokens + totalCompletionTokens,
          },
        });
        await rootRun!.patchRun();
      });
    }

    return { success: true, output: summaryOutput };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    await updateRunStatus(db, boardId, objectId, 'error', errMsg);

    if (rootRun) {
      await withTrace(async () => {
        rootRun!.end({ error: errMsg });
        await rootRun!.patchRun();
      });
    }

    return { success: false, error: errMsg };
  }
}
