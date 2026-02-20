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
}

export interface TemplateResult {
  success: boolean;
  message: string;
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
    max_tokens: 500,
    temperature: 0.3,
  });
  return JSON.parse(response.choices[0].message.content ?? '{}') as T;
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

  return { success: true, message: `Created SWOT analysis (${objects.length} objects)` };
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
  await agentTools.executePlan(ctx.boardId, objects, connections, ctx.userId, ctx.cache);

  return { success: true, message: `Created flowchart with ${steps.length} steps` };
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

  return { success: true, message: `Created Kanban board with ${columns.length} columns` };
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

  type MindmapContent = { center: string; branches: Array<{ label: string; children?: string[] }> };
  const content = await extractContent<MindmapContent>(
    client, model,
    `Mind map for: "${command}". Central topic + 4-6 branches, 2-3 sub-items each.`,
    '{"center":"Main Topic","branches":[{"label":"Branch","children":["Child 1","Child 2"]}]}',
  );

  const center = content.center ?? 'Main Topic';
  const branches = (content.branches ?? []).slice(0, 6);

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
  const branchRadius = 300;
  const childRadius  = 200;

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
      const spread  = angle + (ci - (children.length - 1) / 2) * 0.4;
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
  await agentTools.executePlan(ctx.boardId, objects, connections, ctx.userId, ctx.cache);

  return { success: true, message: `Created mind map with ${branches.length} branches` };
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
      case 'swot':     return await executeSWOT(command, ctx, client, model);
      case 'flowchart':return await executeFlowchart(command, ctx, client, model);
      case 'kanban':   return await executeKanban(command, ctx, client, model);
      case 'mindmap':  return await executeMindmap(command, ctx, client, model);
      default:         return null;
    }
  } catch (err) {
    console.error(`Template error for pattern "${pattern}":`, err);
    return null; // fall through to agentic loop
  }
}
