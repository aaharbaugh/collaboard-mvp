import OpenAI from 'openai';
import * as agentTools from './agentTools.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TemplateContext {
  boardId: string;
  userId: string;
  viewport?: { x: number; y: number; scale: number; width?: number; height?: number };
  cache: agentTools.ObjectCache;
  /** Firebase IDs of currently selected objects — set when user has a multiselection. */
  selectedIds?: string[];
}

export interface TemplateResult {
  success: boolean;
  message: string;
  /** When set, render these as clickable option buttons in the chat. */
  options?: string[];
  /** IDs of all objects/connections created by this template (used for undo). */
  undoInfo?: { createdObjectIds: string[]; createdConnectionIds: string[] };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function computeCenter(viewport?: TemplateContext['viewport']): { cx: number; cy: number } {
  if (!viewport) return { cx: 500, cy: 400 };
  const { x, y, scale } = viewport;
  const w = viewport.width ?? 1200;
  const h = viewport.height ?? 800;
  return {
    cx: Math.round(-x / scale + w / scale / 2),
    cy: Math.round(-y / scale + h / scale / 2),
  };
}

async function extractContent<T>(
  client: OpenAI,
  model: string,
  userPrompt: string,
  schema: string,
  maxTokens = 600,
): Promise<T> {
  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: `Return ONLY valid JSON matching this schema: ${schema}. No markdown, no explanation.`,
      },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    max_tokens: maxTokens,
    temperature: 0.3,
  });
  return JSON.parse(response.choices[0].message.content ?? '{}') as T;
}

// ---------------------------------------------------------------------------
// Count parsing
// ---------------------------------------------------------------------------

/**
 * Extract an explicit numeric count from a command string.
 * Matches patterns like "5 branches", "ten ideas", "create 8 topics", etc.
 */
function parseRequestedCount(command: string): number | null {
  const wordNums: Record<string, number> = {
    two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
    nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
  };
  // Numeric digit followed by an optional count-noun (idea, branch/branches, topic, node, item…)
  // Use (?:branch(?:es)?) etc. so "branches" matches as one word and \b succeeds (plain "branch"s? leaves "es" and no word boundary).
  const digitMatch = command.match(
    /\b(\d+)\s*(?:idea(?:s)?|branch(?:es)?|topic(?:s)?|node(?:s)?|item(?:s)?|point(?:s)?|concept(?:s)?|sub.?topic(?:s)?|thing(?:s)?|child(?:ren)?|question(?:s)?|category|categories|section(?:s)?)\b/i,
  );
  if (digitMatch) {
    const n = parseInt(digitMatch[1], 10);
    if (n >= 2 && n <= 20) return n;
  }
  // Word numbers anywhere in the command
  const wordPattern = new RegExp(`\\b(${Object.keys(wordNums).join('|')})\\b`, 'i');
  const wordMatch = command.match(wordPattern);
  if (wordMatch) return wordNums[wordMatch[1].toLowerCase()] ?? null;
  return null;
}

// ---------------------------------------------------------------------------
// SWOT template
// ---------------------------------------------------------------------------

async function executeSWOT(
  command: string,
  ctx: TemplateContext,
  client: OpenAI,
  model: string,
): Promise<TemplateResult> {
  await agentTools.writeAgentStatus(ctx.boardId, { phase: 'thinking', iteration: 1, maxIterations: 2 });

  type SWOTContent = {
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
    threats: string[];
  };
  const content = await extractContent<SWOTContent>(
    client,
    model,
    `SWOT analysis for: "${command}". Extract 3 concise items per category.`,
    '{"strengths":["item"],"weaknesses":["item"],"opportunities":["item"],"threats":["item"]}',
  );

  const { cx, cy } = computeCenter(ctx.viewport);
  const qW = 300, qH = 310, gap = 20;
  const startX = cx - qW - gap / 2;
  const startY = cy - qH - gap / 2;

  const quadrants = [
    { key: 'strengths'    as const, label: 'Strengths',     color: agentTools.PALETTE.green,   x: startX,        y: startY        },
    { key: 'weaknesses'   as const, label: 'Weaknesses',    color: agentTools.PALETTE.rose,    x: startX+qW+gap, y: startY        },
    { key: 'opportunities'as const, label: 'Opportunities', color: agentTools.PALETTE.yellow,  x: startX,        y: startY+qH+gap },
    { key: 'threats'      as const, label: 'Threats',       color: agentTools.PALETTE.peach,   x: startX+qW+gap, y: startY+qH+gap },
  ];

  const objects: agentTools.BatchCreateOp[] = [];
  const allChildTempIds: string[] = [];

  // Outer frame
  objects.push({
    tempId: 'f_swot',
    action: 'createFrame',
    params: {
      title: 'SWOT Analysis',
      x: startX - 40, y: startY - 50,
      width: qW * 2 + gap + 80, height: qH * 2 + gap + 90,
    },
  });

  for (const q of quadrants) {
    const items = (content[q.key] ?? []).slice(0, 3);
    const itemText = items.map(s => `• ${s}`).join('\n');

    // Colored background rectangle
    objects.push({
      tempId: `bg_${q.key}`,
      action: 'createShape',
      params: { type: 'rectangle', x: q.x, y: q.y, width: qW, height: qH, color: q.color },
    });
    // Category heading
    objects.push({
      tempId: `h_${q.key}`,
      action: 'createText',
      params: { text: q.label, x: q.x + 10, y: q.y + 8, width: qW - 20, height: 36, color: '#1a1a1a' },
    });
    // Items as a single sticky note
    objects.push({
      tempId: `n_${q.key}`,
      action: 'createStickyNote',
      params: { text: itemText, x: q.x + 10, y: q.y + 52, color: q.color },
    });
    allChildTempIds.push(`bg_${q.key}`, `h_${q.key}`, `n_${q.key}`);
  }

  await agentTools.writeAgentStatus(ctx.boardId, {
    phase: 'calling_tools',
    tools: ['executePlan', 'addToFrame', 'setLayer'],
  });
  const result = await agentTools.executePlan(ctx.boardId, objects, [], ctx.userId, ctx.cache);

  const actualFrameId = result.idMap['f_swot'];
  const allActualChildren = allChildTempIds
    .map(id => result.idMap[id])
    .filter(Boolean) as string[];
  const bgActualIds = quadrants
    .map(q => result.idMap[`bg_${q.key}`])
    .filter(Boolean) as string[];

  await Promise.all([
    actualFrameId && allActualChildren.length > 0
      ? agentTools.addToFrame(ctx.boardId, allActualChildren, actualFrameId)
      : Promise.resolve(),
    ...bgActualIds.map(id => agentTools.setLayer(ctx.boardId, id, true)),
  ]);

  return {
    success: true,
    message: `Created SWOT analysis (${objects.length} objects)`,
    undoInfo: { createdObjectIds: Object.values(result.idMap), createdConnectionIds: result.connectionIds },
  };
}

// ---------------------------------------------------------------------------
// Flowchart template
// ---------------------------------------------------------------------------

/** Try to parse "A → B → C" or "A -> B -> C" arrow chains from the command. */
function parseArrowChain(command: string): string[] | null {
  const m = command.match(/[A-Za-z][^→\->\n]*(?:(?:→|->)[^→\->\n]+)+/);
  if (!m) return null;
  const steps = m[0].split(/→|->/).map(s => s.trim()).filter(s => s.length > 0 && s.length < 60);
  return steps.length >= 2 ? steps : null;
}

async function executeFlowchart(
  command: string,
  ctx: TemplateContext,
  client: OpenAI,
  model: string,
): Promise<TemplateResult> {
  await agentTools.writeAgentStatus(ctx.boardId, { phase: 'thinking', iteration: 1, maxIterations: 1 });

  // Try to parse arrow syntax directly (no LLM call needed)
  let steps = parseArrowChain(command);
  if (!steps) {
    type FlowContent = { steps: string[] };
    const content = await extractContent<FlowContent>(
      client, model,
      `Flowchart steps for: "${command}". 3-6 sequential steps, short labels.`,
      '{"steps":["Step 1","Step 2","Step 3"]}',
    );
    steps = content.steps ?? ['Start', 'Process', 'End'];
  }
  if (steps.length < 2) steps = ['Start', 'Process', 'End'];

  const { cx, cy } = computeCenter(ctx.viewport);
  const nW = 160, nH = 120, gapX = 80;
  const totalW = steps.length * nW + (steps.length - 1) * gapX;
  const startX = Math.round(cx - totalW / 2);
  const startY = Math.round(cy - nH / 2);

  const objects: agentTools.BatchCreateOp[] = [];
  const connections: agentTools.PlanConnection[] = [];

  for (let i = 0; i < steps.length; i++) {
    const nodeId = `node_${i}`;
    const isFirst = i === 0, isLast = i === steps.length - 1;
    const color = isFirst
      ? agentTools.PALETTE.green
      : isLast
        ? agentTools.PALETTE.rose
        : agentTools.PALETTE.blue;
    objects.push({
      tempId: nodeId,
      action: 'createStickyNote',
      params: { text: steps[i], x: startX + i * (nW + gapX), y: startY, color },
    });
    if (i > 0) connections.push({ fromId: `node_${i - 1}`, toId: nodeId });
  }

  await agentTools.writeAgentStatus(ctx.boardId, { phase: 'calling_tools', tools: ['executePlan'] });
  const flowResult = await agentTools.executePlan(ctx.boardId, objects, connections, ctx.userId, ctx.cache);

  return {
    success: true,
    message: `Created flowchart with ${steps.length} steps`,
    undoInfo: { createdObjectIds: Object.values(flowResult.idMap), createdConnectionIds: flowResult.connectionIds },
  };
}

// ---------------------------------------------------------------------------
// Kanban template
// ---------------------------------------------------------------------------

async function executeKanban(
  command: string,
  ctx: TemplateContext,
  client: OpenAI,
  model: string,
): Promise<TemplateResult> {
  await agentTools.writeAgentStatus(ctx.boardId, { phase: 'thinking', iteration: 1, maxIterations: 2 });

  type KanbanContent = { columns: Array<{ name: string; items: string[] }> };
  const content = await extractContent<KanbanContent>(
    client, model,
    `Kanban board for: "${command}". 3 columns, 2-3 items each.`,
    '{"columns":[{"name":"To Do","items":["Task 1","Task 2"]},{"name":"In Progress","items":["Task 3"]},{"name":"Done","items":["Task 4"]}]}',
  );

  const columns = content.columns?.slice(0, 4) ?? [
    { name: 'To Do', items: ['Item 1', 'Item 2'] },
    { name: 'In Progress', items: ['Item 3'] },
    { name: 'Done', items: ['Item 4'] },
  ];

  const { cx, cy } = computeCenter(ctx.viewport);
  const colW = 260, colGap = 30, frameH = 500;
  const totalW = columns.length * colW + (columns.length - 1) * colGap;
  const startX = Math.round(cx - totalW / 2);
  const startY = Math.round(cy - frameH / 2);

  const objects: agentTools.BatchCreateOp[] = [];
  const frameToChildMap = new Map<string, string[]>();
  const noteColors = [
    agentTools.PALETTE.yellow,
    agentTools.PALETTE.blue,
    agentTools.PALETTE.mint,
    agentTools.PALETTE.lavender,
  ];

  for (let c = 0; c < columns.length; c++) {
    const col = columns[c];
    const colX = startX + c * (colW + colGap);
    const frameId = `frame_${c}`;
    objects.push({
      tempId: frameId,
      action: 'createFrame',
      params: { title: col.name, x: colX, y: startY, width: colW, height: frameH },
    });

    const children: string[] = [];
    const items = (col.items ?? []).slice(0, 4);
    for (let i = 0; i < items.length; i++) {
      const noteId = `note_${c}_${i}`;
      objects.push({
        tempId: noteId,
        action: 'createStickyNote',
        params: {
          text: items[i],
          x: colX + 20,
          y: startY + 60 + i * 140,
          color: noteColors[c % noteColors.length],
        },
      });
      children.push(noteId);
    }
    frameToChildMap.set(frameId, children);
  }

  await agentTools.writeAgentStatus(ctx.boardId, { phase: 'calling_tools', tools: ['executePlan', 'addToFrame'] });
  const result = await agentTools.executePlan(ctx.boardId, objects, [], ctx.userId, ctx.cache);

  await Promise.all(
    Array.from(frameToChildMap.entries()).map(([frameId, childIds]) => {
      const actualFrameId = result.idMap[frameId];
      const actualChildren = childIds.map(id => result.idMap[id]).filter(Boolean) as string[];
      return actualFrameId && actualChildren.length > 0
        ? agentTools.addToFrame(ctx.boardId, actualChildren, actualFrameId)
        : Promise.resolve();
    }),
  );

  return {
    success: true,
    message: `Created Kanban board with ${columns.length} columns`,
    undoInfo: { createdObjectIds: Object.values(result.idMap), createdConnectionIds: result.connectionIds },
  };
}

// ---------------------------------------------------------------------------
// Mindmap template
// ---------------------------------------------------------------------------

async function executeMindmap(
  command: string,
  ctx: TemplateContext,
  client: OpenAI,
  model: string,
): Promise<TemplateResult> {
  await agentTools.writeAgentStatus(ctx.boardId, { phase: 'thinking', iteration: 1, maxIterations: 1 });

  // Respect explicit count requests ("5 ideas", "ten branches", etc.); default 4 for mind map (matches "central idea and 4 branches"), cap at 16
  const requestedCount = parseRequestedCount(command) ?? 4;
  const branchCount = Math.min(Math.max(requestedCount, 2), 16);

  type MindmapContent = { center: string; branches: Array<{ label: string; children?: string[] }> };
  const content = await extractContent<MindmapContent>(
    client, model,
    `Mind map for: "${command}". Return a central topic and EXACTLY ${branchCount} branches, each with 2-3 sub-items. The branches array MUST contain exactly ${branchCount} entries.`,
    '{"center":"Main Topic","branches":[{"label":"Branch","children":["Child 1","Child 2"]}]}',
    Math.max(800, branchCount * 80 + 300), // scale token budget with branch count
  );

  const center = content.center ?? 'Main Topic';
  // Accept up to the requested count — no artificial cap below it
  const branches = (content.branches ?? []).slice(0, branchCount);

  const { cx, cy } = computeCenter(ctx.viewport);
  const objects: agentTools.BatchCreateOp[] = [];
  const connections: agentTools.PlanConnection[] = [];

  // Center node
  objects.push({
    tempId: 'center',
    action: 'createStickyNote',
    params: { text: center, x: cx - 80, y: cy - 60, color: agentTools.PALETTE.blue },
  });

  const branchColors = [
    agentTools.PALETTE.green, agentTools.PALETTE.rose,   agentTools.PALETTE.yellow,
    agentTools.PALETTE.peach, agentTools.PALETTE.mint,   agentTools.PALETTE.lavender,
  ];

  // Radius must be large enough so the arc-length per branch ≥ node width (170px)
  const branchRadius = Math.max(300, Math.ceil((branchCount * 170) / (2 * Math.PI)));
  const childRadius  = 180;

  for (let b = 0; b < branches.length; b++) {
    const angle  = (b / branches.length) * 2 * Math.PI - Math.PI / 2;
    const bx     = Math.round(cx + branchRadius * Math.cos(angle) - 80);
    const by     = Math.round(cy + branchRadius * Math.sin(angle) - 60);
    const branchId = `branch_${b}`;
    const color    = branchColors[b % branchColors.length];

    objects.push({
      tempId: branchId,
      action: 'createStickyNote',
      params: { text: branches[b].label, x: bx, y: by, color },
    });
    connections.push({ fromId: 'center', toId: branchId });

    const children = (branches[b].children ?? []).slice(0, 3);
    for (let ci = 0; ci < children.length; ci++) {
      const spread  = angle + (ci - (children.length - 1) / 2) * 0.45;
      const childId = `child_${b}_${ci}`;
      objects.push({
        tempId: childId,
        action: 'createStickyNote',
        params: {
          text:  children[ci],
          x:     Math.round(bx + 80 + childRadius * Math.cos(spread) - 80),
          y:     Math.round(by + 60 + childRadius * Math.sin(spread) - 60),
          color: agentTools.PALETTE.grey,
        },
      });
      connections.push({ fromId: branchId, toId: childId });
    }
  }

  await agentTools.writeAgentStatus(ctx.boardId, { phase: 'calling_tools', tools: ['executePlan'] });
  const mindmapResult = await agentTools.executePlan(ctx.boardId, objects, connections, ctx.userId, ctx.cache);

  return {
    success: true,
    message: `Created mind map with ${branches.length} branches`,
    undoInfo: { createdObjectIds: Object.values(mindmapResult.idMap), createdConnectionIds: mindmapResult.connectionIds },
  };
}

// ---------------------------------------------------------------------------
// Arrange-within template (zero LLM calls — selection + keyword parsing)
// ---------------------------------------------------------------------------

/** Map palette hex values back to color names for command matching. */
const HEX_TO_COLOR_NAME: Record<string, string> = {
  '#f5e6ab': 'yellow', '#d4e4bc': 'green',  '#c5d5e8': 'blue',
  '#e8c5c5': 'rose',   '#d4c5e8': 'lavender','#c5e8d4': 'mint',
  '#e8d4c5': 'peach',  '#e0e0d0': 'grey',
};

/** Color name synonyms for matching user commands. */
const COLOR_SYNONYMS: Record<string, string> = {
  red: 'rose', gray: 'grey', purple: 'lavender', orange: 'peach', pink: 'rose',
};

/** Container-type priority: higher = more likely to be the container. */
const CONTAINER_TYPE_PRIORITY: Record<string, number> = {
  frame: 100, rectangle: 80, stickyNote: 60, text: 40, circle: 20, star: 0,
};

interface SelectedObjectInfo {
  id: string;
  type: string;
  color: string;
  width: number;
  height: number;
}

/**
 * Identify which selected object is the container based on command keywords
 * (color/type mentions) and structural heuristics (type priority, largest area).
 */
function identifyContainer(
  command: string,
  objects: SelectedObjectInfo[],
): string | null {
  if (objects.length === 0) return null;
  if (objects.length === 1) return objects[0].id;

  // Parse mentioned type keyword
  const typeHints: Array<[RegExp, string]> = [
    [/\bframe\b/i, 'frame'],
    [/\b(rectangle|rect|square)\b/i, 'rectangle'],
    [/\b(sticky.?note|sticky|note|card)\b/i, 'stickyNote'],
    [/\bcircle\b/i, 'circle'],
    [/\bstar\b/i, 'star'],
  ];
  let mentionedType: string | undefined;
  for (const [re, t] of typeHints) {
    if (re.test(command)) { mentionedType = t; break; }
  }

  // Parse mentioned color keyword
  const colorWords = ['yellow', 'green', 'blue', 'rose', 'red', 'lavender', 'mint', 'peach', 'grey', 'gray', 'purple', 'orange', 'pink'];
  let mentionedColor: string | undefined;
  for (const c of colorWords) {
    if (new RegExp(`\\b${c}\\b`, 'i').test(command)) { mentionedColor = c; break; }
  }
  // Resolve synonym
  if (mentionedColor && COLOR_SYNONYMS[mentionedColor]) mentionedColor = COLOR_SYNONYMS[mentionedColor];

  const scored = objects.map(obj => {
    let score = 0;
    const typePriority = CONTAINER_TYPE_PRIORITY[obj.type] ?? 0;
    score += typePriority;

    // Exact type match
    if (mentionedType && obj.type === mentionedType) score += 50;

    // Color match
    if (mentionedColor) {
      const objColorName = HEX_TO_COLOR_NAME[obj.color.toLowerCase()] ?? '';
      if (objColorName === mentionedColor) score += 40;
    }

    // Larger objects are more likely containers (log scale to not dominate)
    score += Math.log10(Math.max(1, obj.width * obj.height)) * 2;

    return { id: obj.id, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].id;
}

async function executeArrangeWithin(
  command: string,
  ctx: TemplateContext,
): Promise<TemplateResult> {
  const selectedIds = ctx.selectedIds ?? [];
  if (selectedIds.length < 2) {
    return { success: false, message: 'Select the items AND the container first, then ask to arrange.' };
  }

  await agentTools.writeAgentStatus(ctx.boardId, { phase: 'thinking', iteration: 1, maxIterations: 1 });

  // Fetch all selected objects from Firebase in one parallel batch
  const admin = await import('firebase-admin');
  const snaps = await Promise.all(
    selectedIds.map(id => admin.database().ref(`boards/${ctx.boardId}/objects/${id}`).once('value')),
  );

  const objects: SelectedObjectInfo[] = [];
  for (const snap of snaps) {
    const o = snap.val() as Record<string, unknown> | null;
    if (!o) continue;
    objects.push({
      id: String(o['id'] ?? snap.key ?? ''),
      type: String(o['type'] ?? 'rectangle'),
      color: String(o['color'] ?? ''),
      width: Number(o['width'] ?? 160),
      height: Number(o['height'] ?? 120),
    });
  }

  const containerId = identifyContainer(command, objects);
  if (!containerId) {
    return { success: false, message: 'Could not identify a container in the selection.' };
  }

  const itemIds = objects.map(o => o.id).filter(id => id !== containerId);
  if (itemIds.length === 0) {
    return { success: false, message: 'No items to arrange — only the container is selected.' };
  }

  // Detect layout preference from command
  const layout: 'grid' | 'row' | 'column' =
    /\b(row|horizontal|line)\b/i.test(command)    ? 'row'    :
    /\b(column|vertical)\b/i.test(command)        ? 'column' :
    'grid';

  await agentTools.writeAgentStatus(ctx.boardId, { phase: 'calling_tools', tools: ['arrangeWithin'] });

  const result = await agentTools.arrangeWithin(ctx.boardId, {
    objectIds: itemIds,
    containerId,
    layout,
    gap: 8,
    resizeToFit: true,
    addToFrame: objects.find(o => o.id === containerId)?.type === 'frame',
  });

  const containerObj = objects.find(o => o.id === containerId);
  const containerDesc = containerObj ? `${containerObj.type}` : 'container';
  return {
    success: true,
    message: `Arranged ${result.moves} objects inside the ${containerDesc}${result.resized ? ' (resized to fit)' : ''}`,
  };
}

// ---------------------------------------------------------------------------
// Bulk create template (zero LLM calls — pure regex parsing)
// ---------------------------------------------------------------------------

const WORD_NUMS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};

/** Default count when no number is specified, keyed by layout type. */
const DEFAULT_COUNT_FOR_LAYOUT: Record<agentTools.CreateManyLayout, number> = {
  grid: 25, row: 10, column: 10, circle: 16,
  x_pattern: 9, cross: 17, diamond: 13, triangle: 15,
};

type BulkObjectType = agentTools.ShapeType | 'stickyNote';

interface BulkParams {
  count: number;
  objectType: BulkObjectType;
  color?: string;
  layout: agentTools.CreateManyLayout;
}

/** Detect layout from command text, including named geometric patterns. */
function detectLayout(command: string): agentTools.CreateManyLayout {
  if (/\bx[ -]?pattern\b|\bx[ -]?shape\b|\bdiagonal\b/i.test(command)) return 'x_pattern';
  if (/\bcross\b|\bplus\b|\bplus[ -]?sign\b/i.test(command))             return 'cross';
  if (/\bdiamond\b|\brhombus\b/i.test(command))                           return 'diamond';
  if (/\btriangle\b|\bpyramid\b/i.test(command))                         return 'triangle';
  if (/\b(circle|ring|radial|around)\b/i.test(command))                   return 'circle';
  if (/\b(row|horizontal|line)\b/i.test(command))                         return 'row';
  if (/\b(column|vertical)\b/i.test(command))                             return 'column';
  return 'grid';
}

function parseBulkCreate(command: string): BulkParams | null {
  const colorNames = 'yellow|green|blue|rose|red|lavender|mint|peach|grey|gray|purple|orange|pink|white';
  const typeNames  = 'star|circle|rectangle|square|sticky.?note|note|card';

  // Try to match an explicit count + optional color + shape type
  const countedRe = new RegExp(
    `\\b(\\d+|${Object.keys(WORD_NUMS).join('|')})\\s+(?:(${colorNames})\\s+)?(${typeNames})s?\\b`,
    'i',
  );
  const counted = command.match(countedRe);

  // Also try shape + pattern without a count ("create stars in X pattern")
  const patternRe = new RegExp(
    `\\b(?:(${colorNames})\\s+)?(${typeNames})s?\\b`,
    'i',
  );
  const withPattern = command.match(patternRe);

  let count: number;
  let objectType: BulkObjectType;
  let color: string | undefined;
  const layout = detectLayout(command);

  if (counted) {
    const rawCount = counted[1];
    const parsed = /^\d+$/.test(rawCount)
      ? parseInt(rawCount, 10)
      : (WORD_NUMS[rawCount.toLowerCase()] ?? null);
    if (!parsed || parsed < 1) return null;
    count = Math.min(parsed, 200);
    color = counted[2]?.toLowerCase();
    const typeWord = counted[3].toLowerCase().replace(/[\s-]/g, '');
    objectType =
      typeWord === 'star'      ? 'star'      :
      typeWord === 'circle'    ? 'circle'    :
      typeWord === 'rectangle' ? 'rectangle' :
      typeWord === 'square'    ? 'rectangle' : 'stickyNote';
  } else if (withPattern && layout !== 'grid') {
    // No explicit count but a layout pattern is named — use layout default
    color = withPattern[1]?.toLowerCase();
    const typeWord = withPattern[2].toLowerCase().replace(/[\s-]/g, '');
    objectType =
      typeWord === 'star'      ? 'star'      :
      typeWord === 'circle'    ? 'circle'    :
      typeWord === 'rectangle' ? 'rectangle' :
      typeWord === 'square'    ? 'rectangle' : 'stickyNote';
    count = DEFAULT_COUNT_FOR_LAYOUT[layout];
  } else {
    return null;
  }

  return { count, objectType, color, layout };
}

async function executeBulkCreate(
  command: string,
  ctx: TemplateContext,
): Promise<TemplateResult> {
  const parsed = parseBulkCreate(command);
  if (!parsed) return { success: false, message: 'Could not parse bulk create command' };

  await agentTools.writeAgentStatus(ctx.boardId, { phase: 'calling_tools', tools: ['createMany'] });

  const { cx, cy } = computeCenter(ctx.viewport);

  // Item dimensions — server centers automatically via centerPositions()
  const itemW = parsed.objectType === 'stickyNote' ? 160 : 80;
  const itemH = parsed.objectType === 'stickyNote' ? 120 : 80;

  const result = await agentTools.createMany(ctx.boardId, {
    objectType: parsed.objectType,
    count:      parsed.count,
    layout:     parsed.layout,
    anchorX:    cx,   // createMany treats this as center when no containerId
    anchorY:    cy,
    itemWidth:  itemW,
    itemHeight: itemH,
    gap:        12,
    color:      parsed.color,
  }, ctx.userId, ctx.cache);

  const typeName = parsed.objectType === 'stickyNote' ? 'sticky notes' : `${parsed.objectType}s`;
  const layoutName = parsed.layout.replace('_', ' ');
  return {
    success: true,
    message: `Created ${result.objectIds.length} ${typeName} in a ${layoutName}`,
    undoInfo: { createdObjectIds: result.objectIds, createdConnectionIds: [] },
  };
}

// ---------------------------------------------------------------------------
// Unknown layout — ask the user to pick from known options
// ---------------------------------------------------------------------------

async function executeUnknownLayout(command: string): Promise<TemplateResult> {
  const typeMatch = command.match(
    /\b(star|circle|rectangle|square|sticky.?note|note|card)s?\b/i,
  );
  const countMatch = command.match(/\b(\d+)\b/);

  const shape     = typeMatch  ? typeMatch[1].toLowerCase().replace(/[\s-]/g, '') : 'star';
  const count     = countMatch ? countMatch[1] : '25';
  const shapeName = shape === 'stickynote' || shape === 'note' || shape === 'card'
    ? 'sticky notes' : `${shape}s`;

  const layouts: Array<[agentTools.CreateManyLayout, string]> = [
    ['grid',      'Grid'],
    ['circle',    'Circle / ring'],
    ['x_pattern', 'X shape'],
    ['cross',     'Cross / plus'],
    ['diamond',   'Diamond'],
    ['triangle',  'Triangle'],
    ['row',       'Single row'],
    ['column',    'Single column'],
  ];

  return {
    success: false,
    message: `I don't know that layout. How would you like the ${shapeName} arranged?`,
    options: layouts.map(([key, label]) => `Create ${count} ${shapeName} in a ${key.replace('_', ' ')} — ${label}`),
  };
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export async function executeTemplate(
  pattern: string,
  command: string,
  ctx: TemplateContext,
  client: OpenAI,
  model: string,
): Promise<TemplateResult | null> {
  try {
    switch (pattern) {
      case 'swot':        return await executeSWOT(command, ctx, client, model);
      case 'flowchart':   return await executeFlowchart(command, ctx, client, model);
      case 'kanban':      return await executeKanban(command, ctx, client, model);
      case 'mindmap':     return await executeMindmap(command, ctx, client, model);
      case 'bulk_create':     return await executeBulkCreate(command, ctx);
      case 'arrange_within':  return await executeArrangeWithin(command, ctx);
      case 'unknown_layout':  return await executeUnknownLayout(command);
      default:                return null;
    }
  } catch (err) {
    console.error(`Template error for pattern "${pattern}":`, err);
    return null; // fall through to agentic loop
  }
}
