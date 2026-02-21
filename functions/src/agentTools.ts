import * as admin from 'firebase-admin';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ShapeType = 'rectangle' | 'circle' | 'star';

export interface WaypointXY {
  x: number;
  y: number;
}

export interface ConnectorOptions {
  fromAnchor?: string;
  toAnchor?: string;
  color?: string;
  /** Waypoints in {x,y} format; converted to flat number[] for Firebase */
  points?: WaypointXY[];
  /** If true, points[0] is absolute {x,y}, points[1..] are {dx,dy} relative to previous. */
  pointsRelative?: boolean;
}

export interface MultiPointOptions {
  color?: string;
  curved?: boolean;
}

export interface SequenceOptions {
  color?: string;
  direction?: 'forward' | 'bidirectional';
}

/** Minimal object info needed for connection routing and layout calculations. */
export type BoardObjectLite = { x: number; y: number; width: number; height: number };

/** Per-command cache of board objects to avoid redundant Firebase reads. */
export type ObjectCache = Map<string, BoardObjectLite>;

export interface BatchCreateOp {
  tempId: string;
  action: 'createStickyNote' | 'createShape' | 'createFrame' | 'createText';
  params: Record<string, unknown>;
}

export interface BatchConnectOp {
  fromId: string;
  toId: string;
  options?: ConnectorOptions;
}

/**
 * Connection entry for executePlan — fromId/toId may be a tempId from the
 * objects[] array (e.g. "s1") or an existing Firebase object ID.
 */
export interface PlanConnection {
  fromId: string;
  toId: string;
  options?: ConnectorOptions;
}

// ---------------------------------------------------------------------------
// Compound tool args (single LLM call → atomic board update)
// ---------------------------------------------------------------------------

export interface CreateQuadrantArgs {
  title: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  quadrantLabels?: {
    topLeft?: string;
    topRight?: string;
    bottomLeft?: string;
    bottomRight?: string;
  };
  items?: {
    topLeft?: string[];
    topRight?: string[];
    bottomLeft?: string[];
    bottomRight?: string[];
  };
  /** Placement anchor (e.g. viewport center). If omitted, server finds open space. */
  anchorX?: number;
  anchorY?: number;
}

export interface CreateColumnLayoutArgs {
  title: string;
  columns: Array<{ title: string; items: string[] }>;
  /** Placement anchor. If omitted, server finds open space. */
  anchorX?: number;
  anchorY?: number;
}

export interface CreateDiagramArgs {
  /** Node labels; order determines layout position. */
  nodes: Array<{ label: string }>;
  /** Edges by node index: { from: 0, to: 1 }. */
  edges: Array<{ from: number; to: number }>;
  layout?: 'horizontal' | 'vertical';
  /** Placement anchor. If omitted, server finds open space. */
  anchorX?: number;
  anchorY?: number;
}

export type CreateManyLayout =
  | 'grid' | 'row' | 'column' | 'circle'
  | 'x_pattern'   // two diagonals crossing (letter X)
  | 'cross'       // horizontal + vertical bar (plus sign)
  | 'diamond'     // filled diamond / rhombus
  | 'triangle';   // staircase triangle (1-2-3-4... rows)

export interface CreateManyArgs {
  /** Object type to create (all N copies will be the same type). */
  objectType: 'stickyNote' | 'rectangle' | 'circle' | 'star';
  /** Number of objects to create (1–200). */
  count: number;
  /** How to lay objects out. Server computes all coordinates — never supply x/y per item. */
  layout: CreateManyLayout;
  /** Top-left anchor (absolute world coords) — ignored when containerId is set. */
  anchorX?: number;
  anchorY?: number;
  /** Per-item dimensions (px). Defaults: stickyNote 160×120, shapes 100×80. */
  itemWidth?: number;
  itemHeight?: number;
  /** Gap between items in px (default 10). */
  gap?: number;
  /** Color name or hex. */
  color?: string;
  /** Text for sticky notes (same text on all copies, or leave blank). */
  text?: string;
  /** If set, pack all items inside this container and resize it if they don't fit. */
  containerId?: string;
}

export interface ArrangeWithinArgs {
  /** Firebase IDs of the objects to arrange (do NOT include containerId). */
  objectIds: string[];
  /** Firebase ID of the container (frame, sticky note, or shape) to pack inside. */
  containerId: string;
  /** Layout within container (default 'grid'). */
  layout?: 'grid' | 'row' | 'column';
  /** Gap between items in px (default 8). */
  gap?: number;
  /** Resize the container to fit all items if they don't fit (default true). */
  resizeToFit?: boolean;
  /** Also set frameId on each item so they belong to the frame (default false). */
  addToFrame?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Board palette (must match ColorPicker PALETTE in frontend). Only these colors are allowed. */
export const BOARD_PALETTE_HEX = [
  '#f5e6ab', // warm yellow
  '#d4e4bc', // sage green
  '#c5d5e8', // soft blue
  '#e8c5c5', // dusty rose
  '#d4c5e8', // lavender
  '#c5e8d4', // mint
  '#e8d4c5', // peach
  '#e0e0d0', // light grey
] as const;

/** Named aliases for the board palette — use these instead of raw hex strings. */
export const PALETTE = {
  yellow:   BOARD_PALETTE_HEX[0], // '#f5e6ab'
  green:    BOARD_PALETTE_HEX[1], // '#d4e4bc' (sage)
  blue:     BOARD_PALETTE_HEX[2], // '#c5d5e8' (default for connections)
  rose:     BOARD_PALETTE_HEX[3], // '#e8c5c5' (dusty rose / negative)
  lavender: BOARD_PALETTE_HEX[4], // '#d4c5e8'
  mint:     BOARD_PALETTE_HEX[5], // '#c5e8d4'
  peach:    BOARD_PALETTE_HEX[6], // '#e8d4c5' (warning)
  grey:     BOARD_PALETTE_HEX[7], // '#e0e0d0'
} as const;

const COLOR_MAP: Record<string, string> = {
  yellow: '#f5e6ab',
  warmyellow: '#f5e6ab',
  green: '#d4e4bc',
  sagegreen: '#d4e4bc',
  blue: '#c5d5e8',
  softblue: '#c5d5e8',
  pink: '#e8c5c5',
  dustyrose: '#e8c5c5',
  lavender: '#d4c5e8',
  purple: '#d4c5e8',
  mint: '#c5e8d4',
  peach: '#e8d4c5',
  grey: '#e0e0d0',
  gray: '#e0e0d0',
  lightgrey: '#e0e0d0',
};

export function mapColorNameToHex(color: string): string {
  const key = color.toLowerCase().replace(/\s+/g, '');
  if (COLOR_MAP[key]) return COLOR_MAP[key];
  // If already a valid palette hex, pass through
  if (BOARD_PALETTE_HEX.includes(color as (typeof BOARD_PALETTE_HEX)[number])) return color;
  return COLOR_MAP.yellow ?? BOARD_PALETTE_HEX[0];
}

export function autoSelectAnchors(
  fromObj: { x: number; y: number; width: number; height: number },
  toObj: { x: number; y: number; width: number; height: number }
): { fromAnchor: string; toAnchor: string } {
  const fromCX = fromObj.x + fromObj.width / 2;
  const fromCY = fromObj.y + fromObj.height / 2;
  const toCX = toObj.x + toObj.width / 2;
  const toCY = toObj.y + toObj.height / 2;

  const dx = toCX - fromCX;
  const dy = toCY - fromCY;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { fromAnchor: 'right', toAnchor: 'left' }
      : { fromAnchor: 'left', toAnchor: 'right' };
  }
  return dy >= 0
    ? { fromAnchor: 'bottom', toAnchor: 'top' }
    : { fromAnchor: 'top', toAnchor: 'bottom' };
}

/** Anchor offset from center (half-size). */
function anchorOffset(w: number, h: number, anchor: string): { x: number; y: number } {
  switch (anchor) {
    case 'top': return { x: 0, y: -h / 2 };
    case 'bottom': return { x: 0, y: h / 2 };
    case 'left': return { x: -w / 2, y: 0 };
    case 'right': return { x: w / 2, y: 0 };
    case 'top-left': return { x: -w / 2, y: -h / 2 };
    case 'top-right': return { x: w / 2, y: -h / 2 };
    case 'bottom-left': return { x: -w / 2, y: h / 2 };
    case 'bottom-right': return { x: w / 2, y: h / 2 };
    default: return { x: w / 2, y: -h / 2 };
  }
}

export function getAnchorWorldPoint(
  obj: { x: number; y: number; width: number; height: number },
  anchor: string
): { x: number; y: number } {
  const cx = obj.x + obj.width / 2;
  const cy = obj.y + obj.height / 2;
  const off = anchorOffset(obj.width, obj.height, anchor);
  return { x: cx + off.x, y: cy + off.y };
}

/** Convert ConnectorOptions.points to flat number[] or undefined. */
function flattenWaypoints(options: ConnectorOptions): number[] | undefined {
  if (!options.points || options.points.length === 0) return undefined;
  if (options.pointsRelative) {
    const abs: WaypointXY[] = [];
    for (let i = 0; i < options.points.length; i++) {
      const p = options.points[i];
      if (i === 0) {
        abs.push({ x: p.x, y: p.y });
      } else {
        const prev = abs[i - 1];
        abs.push({ x: prev.x + p.x, y: prev.y + p.y });
      }
    }
    return abs.flatMap((p) => [p.x, p.y]);
  }
  return options.points.flatMap((p) => [p.x, p.y]);
}

// ---------------------------------------------------------------------------
// Internal: build connection data (pure, no Firebase write)
// ---------------------------------------------------------------------------

function _buildConnectionData(
  fromId: string,
  toId: string,
  fromObj: BoardObjectLite,
  toObj: BoardObjectLite,
  options: ConnectorOptions,
  userId: string
): { id: string; data: Record<string, unknown> } {
  const autoAnchors = autoSelectAnchors(fromObj, toObj);
  const fromAnchor = options.fromAnchor ?? autoAnchors.fromAnchor;
  const toAnchor = options.toAnchor ?? autoAnchors.toAnchor;

  const id = randomUUID();
  const data: Record<string, unknown> = {
    id,
    fromId,
    toId,
    fromAnchor,
    toAnchor,
    color: options.color ? mapColorNameToHex(options.color) : PALETTE.blue,
    createdBy: userId,
    createdAt: Date.now(),
  };

  const flat = flattenWaypoints(options);
  if (flat) data['points'] = flat;

  return { id, data };
}

/** Write a single connection record (used by createConnector only). */
async function _writeConnection(
  boardId: string,
  fromId: string,
  toId: string,
  fromObj: BoardObjectLite,
  toObj: BoardObjectLite,
  options: ConnectorOptions,
  userId: string
): Promise<string> {
  const { id, data } = _buildConnectionData(fromId, toId, fromObj, toObj, options, userId);
  await admin.database().ref(`boards/${boardId}/connections/${id}`).set(data);
  return id;
}

// ---------------------------------------------------------------------------
// Object creation
// ---------------------------------------------------------------------------

export async function createStickyNote(
  boardId: string,
  text: string,
  x: number,
  y: number,
  color: string,
  userId: string
): Promise<string> {
  const id = randomUUID();
  await admin.database().ref(`boards/${boardId}/objects/${id}`).set({
    id,
    type: 'stickyNote',
    text,
    x,
    y,
    width: 160,
    height: 120,
    color: mapColorNameToHex(color),
    createdBy: userId,
    createdAt: Date.now(),
  });
  return id;
}

export async function createShape(
  boardId: string,
  type: ShapeType,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  userId: string
): Promise<string> {
  const id = randomUUID();
  await admin.database().ref(`boards/${boardId}/objects/${id}`).set({
    id,
    type,
    x,
    y,
    width,
    height,
    color: mapColorNameToHex(color),
    createdBy: userId,
    createdAt: Date.now(),
  });
  return id;
}

export async function createFrame(
  boardId: string,
  title: string,
  x: number,
  y: number,
  width: number,
  height: number,
  userId: string
): Promise<string> {
  const id = randomUUID();
  await admin.database().ref(`boards/${boardId}/objects/${id}`).set({
    id,
    type: 'frame',
    text: title,
    x,
    y,
    width,
    height,
    color: '#12121a',
    sentToBack: true,
    createdBy: userId,
    createdAt: Date.now(),
  });
  return id;
}

export async function createText(
  boardId: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  userId: string
): Promise<string> {
  const id = randomUUID();
  await admin.database().ref(`boards/${boardId}/objects/${id}`).set({
    id,
    type: 'text',
    text,
    x,
    y,
    width,
    height,
    color,
    createdBy: userId,
    createdAt: Date.now(),
  });
  return id;
}

// ---------------------------------------------------------------------------
// Batch creation — single multi-path Firebase write for multiple objects
// ---------------------------------------------------------------------------

export async function createBatch(
  boardId: string,
  operations: BatchCreateOp[],
  userId: string,
  cache?: ObjectCache
): Promise<{ tempId: string; actualId: string }[]> {
  if (operations.length === 0) return [];

  const updates: Record<string, unknown> = {};
  const results: { tempId: string; actualId: string }[] = [];

  for (const op of operations) {
    const id = randomUUID();
    const p = op.params ?? {};
    const x = Number(p['x'] ?? 0);
    const y = Number(p['y'] ?? 0);
    let w = 160;
    let h = 120;
    let obj: Record<string, unknown>;

    switch (op.action) {
      case 'createStickyNote': {
        w = 160; h = 120;
        obj = {
          id, type: 'stickyNote',
          text: String(p['text'] ?? ''),
          x, y, width: w, height: h,
          color: mapColorNameToHex(String(p['color'] ?? 'yellow')),
          createdBy: userId, createdAt: Date.now(),
        };
        break;
      }
      case 'createShape': {
        w = Number(p['width'] ?? 150);
        h = Number(p['height'] ?? 100);
        obj = {
          id, type: String(p['type'] ?? 'rectangle'),
          x, y, width: w, height: h,
          color: mapColorNameToHex(String(p['color'] ?? 'blue')),
          createdBy: userId, createdAt: Date.now(),
        };
        break;
      }
      case 'createFrame': {
        w = Number(p['width'] ?? 320);
        h = Number(p['height'] ?? 220);
        obj = {
          id, type: 'frame',
          text: String(p['title'] ?? ''),
          x, y, width: w, height: h,
          color: '#12121a',
          sentToBack: true,
          createdBy: userId, createdAt: Date.now(),
        };
        break;
      }
      case 'createText': {
        w = Number(p['width'] ?? 240);
        h = Number(p['height'] ?? 60);
        obj = {
          id, type: 'text',
          text: String(p['text'] ?? ''),
          x, y, width: w, height: h,
          color: String(p['color'] ?? '#1a1a1a'),
          createdBy: userId, createdAt: Date.now(),
        };
        break;
      }
      default:
        throw new Error(`Unknown batch action: ${String(op.action)}`);
    }

    updates[`boards/${boardId}/objects/${id}`] = obj;
    cache?.set(id, { x, y, width: w, height: h });
    results.push({ tempId: op.tempId, actualId: id });
  }

  await admin.database().ref().update(updates);
  return results;
}

// ---------------------------------------------------------------------------
// executePlan — create objects + connections in a single Firebase write
// ---------------------------------------------------------------------------

/**
 * PRIMARY creation tool. Accepts both objects and connections in one call.
 * Resolves tempIds locally (no extra Firebase read for newly-created objects),
 * then writes everything — objects AND connections — in a single multi-path update.
 *
 * Returns { idMap: {tempId→actualId}, connectionIds }.
 */
export async function executePlan(
  boardId: string,
  objects: BatchCreateOp[],
  connections: PlanConnection[],
  userId: string,
  cache?: ObjectCache
): Promise<{ idMap: Record<string, string>; connectionIds: string[] }> {
  const idMap: Record<string, string> = {};
  const newGeometry: Record<string, BoardObjectLite> = {};
  const allUpdates: Record<string, unknown> = {};
  const now = Date.now();

  // ── Phase 1: Build object data locally (no Firebase yet) ─────────────────
  for (const op of objects) {
    const id = randomUUID();
    const p = op.params ?? {};
    const x = Number(p['x'] ?? 0);
    const y = Number(p['y'] ?? 0);
    let w: number;
    let h: number;
    let obj: Record<string, unknown>;

    switch (op.action) {
      case 'createStickyNote': {
        w = 160; h = 120;
        obj = {
          id, type: 'stickyNote', text: String(p['text'] ?? ''),
          x, y, width: w, height: h,
          color: mapColorNameToHex(String(p['color'] ?? 'yellow')),
          createdBy: userId, createdAt: now,
        };
        break;
      }
      case 'createShape': {
        w = Number(p['width'] ?? 150);
        h = Number(p['height'] ?? 100);
        obj = {
          id, type: String(p['type'] ?? 'rectangle'),
          x, y, width: w, height: h,
          color: mapColorNameToHex(String(p['color'] ?? 'blue')),
          createdBy: userId, createdAt: now,
        };
        break;
      }
      case 'createFrame': {
        w = Number(p['width'] ?? 320);
        h = Number(p['height'] ?? 220);
        obj = {
          id, type: 'frame', text: String(p['title'] ?? ''),
          x, y, width: w, height: h, color: '#12121a',
          sentToBack: true,
          createdBy: userId, createdAt: now,
        };
        break;
      }
      case 'createText': {
        w = Number(p['width'] ?? 240);
        h = Number(p['height'] ?? 60);
        obj = {
          id, type: 'text', text: String(p['text'] ?? ''),
          x, y, width: w, height: h,
          color: String(p['color'] ?? '#1a1a1a'),
          createdBy: userId, createdAt: now,
        };
        break;
      }
      default:
        throw new Error(`Unknown executePlan object action: ${String(op.action)}`);
    }

    idMap[op.tempId] = id;
    newGeometry[id] = { x, y, width: w, height: h };
    cache?.set(id, { x, y, width: w, height: h });
    allUpdates[`boards/${boardId}/objects/${id}`] = obj;
  }

  // ── Phase 2: Build connection data, resolving tempIds ────────────────────
  const connectionIds: string[] = [];

  if (connections.length > 0) {
    // Resolve all IDs and check which ones lack geometry
    const resolvedConns = connections.map((conn) => ({
      fromActualId: idMap[conn.fromId] ?? conn.fromId,
      toActualId:   idMap[conn.toId]   ?? conn.toId,
      options: conn.options ?? {},
    }));

    const unknownIds = new Set<string>();
    for (const { fromActualId, toActualId } of resolvedConns) {
      if (!newGeometry[fromActualId] && !cache?.has(fromActualId)) unknownIds.add(fromActualId);
      if (!newGeometry[toActualId]   && !cache?.has(toActualId))   unknownIds.add(toActualId);
    }

    // Fetch from Firebase only when connecting to pre-existing objects not in cache
    let fetchedGeometry: Record<string, BoardObjectLite> = {};
    if (unknownIds.size > 0) {
      const snap = await admin.database().ref(`boards/${boardId}/objects`).once('value');
      const raw: Record<string, unknown> = snap.val() ?? {};
      for (const [id, obj] of Object.entries(raw)) {
        if (obj && typeof obj === 'object') {
          const o = obj as Record<string, unknown>;
          fetchedGeometry[id] = {
            x: Number(o['x'] ?? 0), y: Number(o['y'] ?? 0),
            width: Number(o['width'] ?? 160), height: Number(o['height'] ?? 120),
          };
        }
      }
    }

    for (const { fromActualId, toActualId, options } of resolvedConns) {
      const fromObj = newGeometry[fromActualId] ?? cache?.get(fromActualId) ?? fetchedGeometry[fromActualId];
      const toObj   = newGeometry[toActualId]   ?? cache?.get(toActualId)   ?? fetchedGeometry[toActualId];
      if (!fromObj) throw new Error(`executePlan: object not found: ${fromActualId}`);
      if (!toObj)   throw new Error(`executePlan: object not found: ${toActualId}`);

      const { id, data } = _buildConnectionData(fromActualId, toActualId, fromObj, toObj, options, userId);
      allUpdates[`boards/${boardId}/connections/${id}`] = data;
      connectionIds.push(id);
    }
  }

  // ── Phase 3: Single Firebase write — objects AND connections together ─────
  if (Object.keys(allUpdates).length > 0) {
    await admin.database().ref().update(allUpdates);
  }

  return { idMap, connectionIds };
}

// ---------------------------------------------------------------------------
// Compound tools — single call creates frame + axes + labels + notes + frameId + fit
// ---------------------------------------------------------------------------

const STICKY_W = 160;
const STICKY_H = 120;
const QUADRANT_PADDING = 40;
const QUADRANT_TITLE_BAR = 50;
const AXIS_LINE_THICK = 2;
const COLUMN_GAP = 24;
const ROW_GAP = 20;
const DIAGRAM_NODE_W = 200;
const DIAGRAM_NODE_H = 120;
const DIAGRAM_GAP = 80;

/** Resolve anchor (anchorX, anchorY) or find open space to the right of existing content. */
async function getPlacementAnchor(
  boardId: string,
  anchorX: number | undefined,
  anchorY: number | undefined,
  neededWidth: number,
  neededHeight: number
): Promise<{ x: number; y: number }> {
  if (typeof anchorX === 'number' && typeof anchorY === 'number') {
    return { x: anchorX, y: anchorY };
  }
  const snap = await admin.database().ref(`boards/${boardId}/objects`).once('value');
  const raw: Record<string, unknown> = snap.val() ?? {};
  let maxRight = 0;
  let maxBottom = 0;
  for (const obj of Object.values(raw)) {
    if (!obj || typeof obj !== 'object') continue;
    const o = obj as Record<string, unknown>;
    const x = Number(o['x'] ?? 0);
    const y = Number(o['y'] ?? 0);
    const w = Number(o['width'] ?? 0);
    const h = Number(o['height'] ?? 0);
    maxRight = Math.max(maxRight, x + w);
    maxBottom = Math.max(maxBottom, y + h);
  }
  const pad = 80;
  return { x: maxRight + pad, y: Math.max(0, maxBottom - neededHeight) };
}

/**
 * Create a quadrant/matrix diagram (e.g. SWOT) in one atomic write: frame, axis lines,
 * axis labels, quadrant titles, sticky notes per quadrant, all assigned to frame, then fit.
 */
export async function createQuadrant(
  boardId: string,
  args: CreateQuadrantArgs,
  userId: string
): Promise<{ frameId: string; objectIds: string[] }> {
  const now = Date.now();
  const title = args.title ?? 'Quadrant';
  const xAxisLabel = args.xAxisLabel ?? 'Low ← → High';
  const yAxisLabel = args.yAxisLabel ?? 'Low ← → High';
  const ql = args.quadrantLabels ?? {};
  const items = args.items ?? {};

  // Content size: 2 columns of quadrants, each side ~280px + axis + padding
  const innerW = 600;
  const innerH = 520;
  const totalW = innerW + QUADRANT_PADDING * 2;
  const totalH = innerH + QUADRANT_PADDING * 2 + QUADRANT_TITLE_BAR;

  const anchor = await getPlacementAnchor(boardId, args.anchorX, args.anchorY, totalW, totalH);
  const fx = anchor.x;
  const fy = anchor.y;
  const cx = fx + QUADRANT_PADDING + innerW / 2;
  const cy = fy + QUADRANT_TITLE_BAR + QUADRANT_PADDING + innerH / 2;

  const frameId = randomUUID();
  const updates: Record<string, unknown> = {};

  // Frame (will be resized at end)
  updates[`boards/${boardId}/objects/${frameId}`] = {
    id: frameId,
    type: 'frame',
    text: title,
    x: fx,
    y: fy,
    width: totalW,
    height: totalH,
    color: '#12121a',
    sentToBack: true,
    createdBy: userId,
    createdAt: now,
  };

  // Axis lines (thin rectangles)
  const vLineId = randomUUID();
  const hLineId = randomUUID();
  const vX = cx - AXIS_LINE_THICK / 2;
  const vY = fy + QUADRANT_TITLE_BAR + QUADRANT_PADDING;
  const hX = fx + QUADRANT_PADDING;
  const hY = cy - AXIS_LINE_THICK / 2;
  updates[`boards/${boardId}/objects/${vLineId}`] = {
    id: vLineId,
    type: 'rectangle',
    x: vX,
    y: vY,
    width: AXIS_LINE_THICK,
    height: innerH,
    color: '#4a5568',
    frameId,
    sentToBack: true,
    createdBy: userId,
    createdAt: now,
  };
  updates[`boards/${boardId}/objects/${hLineId}`] = {
    id: hLineId,
    type: 'rectangle',
    x: hX,
    y: hY,
    width: innerW,
    height: AXIS_LINE_THICK,
    color: '#4a5568',
    frameId,
    sentToBack: true,
    createdBy: userId,
    createdAt: now,
  };

  // Axis labels (text)
  const labelH = 22;
  const xLowId = randomUUID();
  const xHighId = randomUUID();
  const yLowId = randomUUID();
  const yHighId = randomUUID();
  const xParts = xAxisLabel.split(/[←→\-–]/).map((s) => s.trim()).filter(Boolean);
  const yParts = yAxisLabel.split(/[←→\-–]/).map((s) => s.trim()).filter(Boolean);
  const xLow = xParts[0] ?? 'Low';
  const xHigh = xParts[xParts.length - 1] ?? (xParts[0] ? '' : 'High');
  const yLow = yParts[0] ?? 'Low';
  const yHigh = yParts[yParts.length - 1] ?? (yParts[0] ? '' : 'High');
  updates[`boards/${boardId}/objects/${xLowId}`] = { id: xLowId, type: 'text', text: xLow, x: hX, y: hY + 8, width: 60, height: labelH, color: '#718096', frameId, createdBy: userId, createdAt: now };
  updates[`boards/${boardId}/objects/${xHighId}`] = { id: xHighId, type: 'text', text: xHigh, x: hX + innerW - 60, y: hY + 8, width: 60, height: labelH, color: '#718096', frameId, createdBy: userId, createdAt: now };
  updates[`boards/${boardId}/objects/${yLowId}`] = { id: yLowId, type: 'text', text: yLow, x: vX - 50, y: vY + innerH - 24, width: 50, height: labelH, color: '#718096', frameId, createdBy: userId, createdAt: now };
  updates[`boards/${boardId}/objects/${yHighId}`] = { id: yHighId, type: 'text', text: yHigh, x: vX - 50, y: vY, width: 50, height: labelH, color: '#718096', frameId, createdBy: userId, createdAt: now };

  const quadrantColors = { topLeft: PALETTE.green, topRight: PALETTE.rose, bottomLeft: PALETTE.yellow, bottomRight: PALETTE.peach };
  const objectIds: string[] = [frameId, vLineId, hLineId, xLowId, xHighId, yLowId, yHighId];

  // Quadrant section titles
  const qTitleW = 200;
  const qTitleH = 28;
  const topLeftTitleX = fx + QUADRANT_PADDING + 20;
  const topLeftTitleY = fy + QUADRANT_TITLE_BAR + QUADRANT_PADDING + 8;
  const topRightTitleX = cx + 20;
  const topRightTitleY = topLeftTitleY;
  const bottomLeftTitleX = topLeftTitleX;
  const bottomLeftTitleY = cy + 12;
  const bottomRightTitleX = topRightTitleX;
  const bottomRightTitleY = bottomLeftTitleY;

  for (const [key, label] of Object.entries(ql)) {
    if (!label) continue;
    const id = randomUUID();
    let x = 0, y = 0;
    if (key === 'topLeft') { x = topLeftTitleX; y = topLeftTitleY; }
    else if (key === 'topRight') { x = topRightTitleX; y = topRightTitleY; }
    else if (key === 'bottomLeft') { x = bottomLeftTitleX; y = bottomLeftTitleY; }
    else if (key === 'bottomRight') { x = bottomRightTitleX; y = bottomRightTitleY; }
    else continue;
    updates[`boards/${boardId}/objects/${id}`] = { id, type: 'text', text: label, x, y, width: qTitleW, height: qTitleH, color: '#1a1a1a', frameId, createdBy: userId, createdAt: now };
    objectIds.push(id);
  }

  // Sticky notes per quadrant (grid within each quadrant)
  const halfW = innerW / 2;
  const halfH = innerH / 2;
  const quadrants: Array<{ key: keyof typeof items; startX: number; startY: number; w: number; h: number; color: string }> = [
    { key: 'topLeft', startX: fx + QUADRANT_PADDING, startY: fy + QUADRANT_TITLE_BAR + QUADRANT_PADDING, w: halfW - 10, h: halfH - 10, color: quadrantColors.topLeft },
    { key: 'topRight', startX: cx + 10, startY: fy + QUADRANT_TITLE_BAR + QUADRANT_PADDING, w: halfW - 10, h: halfH - 10, color: quadrantColors.topRight },
    { key: 'bottomLeft', startX: fx + QUADRANT_PADDING, startY: cy + 10, w: halfW - 10, h: halfH - 10, color: quadrantColors.bottomLeft },
    { key: 'bottomRight', startX: cx + 10, startY: cy + 10, w: halfW - 10, h: halfH - 10, color: quadrantColors.bottomRight },
  ];
  for (const q of quadrants) {
    const list = items[q.key] ?? [];
    const cols = 2;
    for (let i = 0; i < list.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const sx = q.startX + 36 + col * (STICKY_W + COLUMN_GAP);
      const sy = q.startY + 40 + row * (STICKY_H + ROW_GAP);
      const id = randomUUID();
      updates[`boards/${boardId}/objects/${id}`] = {
        id,
        type: 'stickyNote',
        text: list[i],
        x: sx,
        y: sy,
        width: STICKY_W,
        height: STICKY_H,
        color: mapColorNameToHex(q.color),
        frameId,
        createdBy: userId,
        createdAt: now,
      };
      objectIds.push(id);
    }
  }

  await admin.database().ref().update(updates);
  await fitFrameToContents(boardId, frameId, QUADRANT_PADDING);
  return { frameId, objectIds };
}

/**
 * Create a column layout (kanban, retro, journey map) in one atomic write.
 */
export async function createColumnLayout(
  boardId: string,
  args: CreateColumnLayoutArgs,
  userId: string
): Promise<{ frameId: string; objectIds: string[] }> {
  const now = Date.now();
  const columns = args.columns ?? [];
  if (columns.length === 0) throw new Error('createColumnLayout requires at least one column');

  const colW = 280;
  const headerH = 44;
  const maxRows = Math.max(4, ...columns.map((c) => c.items?.length ?? 0));
  const totalW = columns.length * colW + (columns.length - 1) * COLUMN_GAP + QUADRANT_PADDING * 2;
  const totalH = QUADRANT_TITLE_BAR + QUADRANT_PADDING + headerH + maxRows * (STICKY_H + ROW_GAP) + QUADRANT_PADDING;

  const anchor = await getPlacementAnchor(boardId, args.anchorX, args.anchorY, totalW, totalH);
  const fx = anchor.x;
  const fy = anchor.y;

  const frameId = randomUUID();
  const updates: Record<string, unknown> = {};
  updates[`boards/${boardId}/objects/${frameId}`] = {
    id: frameId,
    type: 'frame',
    text: args.title ?? 'Board',
    x: fx,
    y: fy,
    width: totalW,
    height: totalH,
    color: '#12121a',
    sentToBack: true,
    createdBy: userId,
    createdAt: now,
  };
  const objectIds: string[] = [frameId];

  let x = fx + QUADRANT_PADDING;
  for (const col of columns) {
    const titleId = randomUUID();
    updates[`boards/${boardId}/objects/${titleId}`] = {
      id: titleId,
      type: 'text',
      text: col.title ?? 'Column',
      x,
      y: fy + QUADRANT_TITLE_BAR + 8,
      width: colW,
      height: headerH - 16,
      color: '#1a1a1a',
      frameId,
      createdBy: userId,
      createdAt: now,
    };
    objectIds.push(titleId);

    const items = col.items ?? [];
    for (let i = 0; i < items.length; i++) {
      const id = randomUUID();
      const sy = fy + QUADRANT_TITLE_BAR + headerH + 12 + i * (STICKY_H + ROW_GAP);
      updates[`boards/${boardId}/objects/${id}`] = {
        id,
        type: 'stickyNote',
        text: items[i],
        x,
        y: sy,
        width: STICKY_W,
        height: STICKY_H,
        color: mapColorNameToHex(PALETTE.yellow),
        frameId,
        createdBy: userId,
        createdAt: now,
      };
      objectIds.push(id);
    }
    x += colW + COLUMN_GAP;
  }

  await admin.database().ref().update(updates);
  await fitFrameToContents(boardId, frameId, QUADRANT_PADDING);
  return { frameId, objectIds };
}

/**
 * Create a flowchart/diagram: nodes (rectangles) + connectors in one atomic write.
 */
export async function createDiagram(
  boardId: string,
  args: CreateDiagramArgs,
  userId: string
): Promise<{ nodeIds: string[]; connectionIds: string[] }> {
  const now = Date.now();
  const nodes = args.nodes ?? [];
  const edges = args.edges ?? [];
  const layout = args.layout ?? 'horizontal';

  if (nodes.length === 0) throw new Error('createDiagram requires at least one node');

  const anchor = await getPlacementAnchor(
    boardId,
    args.anchorX,
    args.anchorY,
    nodes.length * (DIAGRAM_NODE_W + DIAGRAM_GAP),
    (layout === 'vertical' ? nodes.length : 1) * (DIAGRAM_NODE_H + DIAGRAM_GAP)
  );
  const updates: Record<string, unknown> = {};
  const nodeIds: string[] = [];
  const nodePositions: BoardObjectLite[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const id = randomUUID();
    const nx = layout === 'vertical'
      ? anchor.x + (DIAGRAM_NODE_W + DIAGRAM_GAP) / 2
      : anchor.x + i * (DIAGRAM_NODE_W + DIAGRAM_GAP);
    const ny = layout === 'vertical'
      ? anchor.y + i * (DIAGRAM_NODE_H + DIAGRAM_GAP)
      : anchor.y;
    updates[`boards/${boardId}/objects/${id}`] = {
      id,
      type: 'stickyNote',
      text: nodes[i].label ?? '',
      x: nx,
      y: ny,
      width: DIAGRAM_NODE_W,
      height: DIAGRAM_NODE_H,
      color: mapColorNameToHex(PALETTE.blue),
      createdBy: userId,
      createdAt: now,
    };
    nodeIds.push(id);
    nodePositions.push({ x: nx, y: ny, width: DIAGRAM_NODE_W, height: DIAGRAM_NODE_H });
  }

  const connectionIds: string[] = [];
  for (const edge of edges) {
    const fromIdx = edge.from;
    const toIdx = edge.to;
    if (fromIdx < 0 || fromIdx >= nodeIds.length || toIdx < 0 || toIdx >= nodeIds.length) continue;
    const fromId = nodeIds[fromIdx];
    const toId = nodeIds[toIdx];
    const fromObj = nodePositions[fromIdx];
    const toObj = nodePositions[toIdx];
    const { id: connId, data } = _buildConnectionData(fromId, toId, fromObj, toObj, {}, userId);
    updates[`boards/${boardId}/connections/${connId}`] = data;
    connectionIds.push(connId);
  }

  await admin.database().ref().update(updates);
  return { nodeIds, connectionIds };
}

// ---------------------------------------------------------------------------
// Connection creation
// ---------------------------------------------------------------------------

export async function createConnector(
  boardId: string,
  fromId: string,
  toId: string,
  options: ConnectorOptions,
  userId: string
): Promise<string> {
  const objectsSnap = await admin
    .database()
    .ref(`boards/${boardId}/objects`)
    .once('value');
  const objects: Record<string, BoardObjectLite> = objectsSnap.val() ?? {};

  const fromObj = objects[fromId];
  const toObj = objects[toId];

  if (!fromObj) throw new Error(`Object not found: ${fromId}`);
  if (!toObj) throw new Error(`Object not found: ${toId}`);

  return _writeConnection(boardId, fromId, toId, fromObj, toObj, options, userId);
}

export async function createMultiPointConnector(
  boardId: string,
  objectIds: string[],
  options: MultiPointOptions,
  userId: string
): Promise<string[]> {
  if (objectIds.length < 2) {
    throw new Error('Need at least 2 objects to connect');
  }

  // Read objects once for all connections
  const objectsSnap = await admin
    .database()
    .ref(`boards/${boardId}/objects`)
    .once('value');
  const objects: Record<string, BoardObjectLite> = objectsSnap.val() ?? {};

  const missing = objectIds.find((id) => !objects[id]);
  if (missing) throw new Error(`Object not found: ${missing}`);

  const updates: Record<string, unknown> = {};
  const connectionIds: string[] = [];

  for (let i = 0; i < objectIds.length - 1; i++) {
    const fromId = objectIds[i];
    const toId = objectIds[i + 1];
    const fromObj = objects[fromId];
    const toObj = objects[toId];

    let waypoints: WaypointXY[] | undefined;
    if (options.curved) {
      const midX = (fromObj.x + fromObj.width / 2 + toObj.x + toObj.width / 2) / 2;
      const midY = (fromObj.y + fromObj.height / 2 + toObj.y + toObj.height / 2) / 2;
      waypoints = [{ x: midX, y: midY + 30 }];
    }

    const { id, data } = _buildConnectionData(
      fromId, toId, fromObj, toObj,
      { color: options.color, points: waypoints },
      userId
    );
    updates[`boards/${boardId}/connections/${id}`] = data;
    connectionIds.push(id);
  }

  await admin.database().ref().update(updates);
  return connectionIds;
}

export async function connectInSequence(
  boardId: string,
  objectIds: string[],
  options: SequenceOptions,
  userId: string
): Promise<string[]> {
  if (objectIds.length < 2) {
    throw new Error('Need at least 2 objects to connect');
  }

  // Read objects once for all connections
  const objectsSnap = await admin
    .database()
    .ref(`boards/${boardId}/objects`)
    .once('value');
  const objects: Record<string, BoardObjectLite> = objectsSnap.val() ?? {};

  const updates: Record<string, unknown> = {};
  const connectionIds: string[] = [];

  // Build forward pairs (and optionally reverse pairs for bidirectional)
  const pairs: [string, string][] = [];
  for (let i = 0; i < objectIds.length - 1; i++) {
    pairs.push([objectIds[i], objectIds[i + 1]]);
  }
  if (options.direction === 'bidirectional') {
    for (let i = objectIds.length - 1; i > 0; i--) {
      pairs.push([objectIds[i], objectIds[i - 1]]);
    }
  }

  for (const [fromId, toId] of pairs) {
    if (!objects[fromId]) throw new Error(`Object not found: ${fromId}`);
    if (!objects[toId]) throw new Error(`Object not found: ${toId}`);
    const { id, data } = _buildConnectionData(
      fromId, toId, objects[fromId], objects[toId],
      { color: options.color },
      userId
    );
    updates[`boards/${boardId}/connections/${id}`] = data;
    connectionIds.push(id);
  }

  await admin.database().ref().update(updates);
  return connectionIds;
}

// ---------------------------------------------------------------------------
// Batch connection — single read + single multi-path Firebase write
// ---------------------------------------------------------------------------

export async function connectBatch(
  boardId: string,
  connections: BatchConnectOp[],
  userId: string,
  cache?: ObjectCache
): Promise<string[]> {
  if (connections.length === 0) return [];

  // Determine if all needed IDs are in cache
  const allIds = [...new Set(connections.flatMap((c) => [c.fromId, c.toId]))];
  const needFetch = !cache || allIds.some((id) => !cache.has(id));

  let objects: Record<string, BoardObjectLite>;

  if (needFetch) {
    const snap = await admin.database().ref(`boards/${boardId}/objects`).once('value');
    const raw: Record<string, unknown> = snap.val() ?? {};
    objects = {};
    for (const [id, obj] of Object.entries(raw)) {
      if (obj && typeof obj === 'object') {
        const o = obj as Record<string, unknown>;
        const lite: BoardObjectLite = {
          x: Number(o['x'] ?? 0),
          y: Number(o['y'] ?? 0),
          width: Number(o['width'] ?? 160),
          height: Number(o['height'] ?? 120),
        };
        objects[id] = lite;
        cache?.set(id, lite);
      }
    }
  } else {
    objects = Object.fromEntries(cache!.entries());
  }

  const updates: Record<string, unknown> = {};
  const connectionIds: string[] = [];

  for (const conn of connections) {
    const fromObj = objects[conn.fromId];
    const toObj = objects[conn.toId];
    if (!fromObj) throw new Error(`Object not found: ${conn.fromId}`);
    if (!toObj) throw new Error(`Object not found: ${conn.toId}`);

    const options = conn.options ?? {};
    const autoAnchors = autoSelectAnchors(fromObj, toObj);
    const fromAnchor = options.fromAnchor ?? autoAnchors.fromAnchor;
    const toAnchor = options.toAnchor ?? autoAnchors.toAnchor;

    const id = randomUUID();
    connectionIds.push(id);

    const data: Record<string, unknown> = {
      id,
      fromId: conn.fromId,
      toId: conn.toId,
      fromAnchor,
      toAnchor,
      color: options.color ? mapColorNameToHex(options.color) : PALETTE.blue,
      createdBy: userId,
      createdAt: Date.now(),
    };

    const flat = flattenWaypoints(options);
    if (flat) data['points'] = flat;

    updates[`boards/${boardId}/connections/${id}`] = data;
  }

  await admin.database().ref().update(updates);
  return connectionIds;
}

// ---------------------------------------------------------------------------
// Object deletion
// ---------------------------------------------------------------------------

export async function deleteObjects(
  boardId: string,
  objectIds: string[]
): Promise<{ deleted: number; connectionsRemoved: number }> {
  if (objectIds.length === 0) return { deleted: 0, connectionsRemoved: 0 };

  const updates: Record<string, null> = {};
  for (const id of objectIds) {
    updates[`boards/${boardId}/objects/${id}`] = null;
  }

  // Also delete any connections that reference these objects
  const connSnap = await admin.database().ref(`boards/${boardId}/connections`).once('value');
  const connections: Record<string, unknown> = connSnap.val() ?? {};
  const objSet = new Set(objectIds);
  let connectionsRemoved = 0;

  for (const [connId, conn] of Object.entries(connections)) {
    if (conn && typeof conn === 'object') {
      const c = conn as Record<string, unknown>;
      if (objSet.has(c['fromId'] as string) || objSet.has(c['toId'] as string)) {
        updates[`boards/${boardId}/connections/${connId}`] = null;
        connectionsRemoved++;
      }
    }
  }

  await admin.database().ref().update(updates as Record<string, unknown>);
  return { deleted: objectIds.length, connectionsRemoved };
}

// ---------------------------------------------------------------------------
// Object manipulation
// ---------------------------------------------------------------------------

export async function moveObject(
  boardId: string,
  objectId: string,
  x: number,
  y: number
): Promise<void> {
  await admin.database().ref(`boards/${boardId}/objects/${objectId}`).update({ x, y });
}

/** Move multiple objects in one atomic Firebase write. */
export async function moveBatch(
  boardId: string,
  moves: Array<{ id: string; x: number; y: number }>
): Promise<{ moved: number }> {
  if (moves.length === 0) return { moved: 0 };
  const updates: Record<string, unknown> = {};
  for (const { id, x, y } of moves) {
    updates[`boards/${boardId}/objects/${id}/x`] = x;
    updates[`boards/${boardId}/objects/${id}/y`] = y;
  }
  await admin.database().ref().update(updates);
  return { moved: moves.length };
}

/**
 * Resize a frame to tightly fit its children (objects with frameId === frameId).
 * Adds `padding` px on all sides; 50px extra at top for the frame title.
 */
export async function fitFrameToContents(
  boardId: string,
  frameId: string,
  padding = 40
): Promise<{ x: number; y: number; width: number; height: number }> {
  const snap = await admin.database().ref(`boards/${boardId}/objects`).once('value');
  const raw: Record<string, unknown> = snap.val() ?? {};

  const children: BoardObjectLite[] = [];
  for (const [id, obj] of Object.entries(raw)) {
    if (id === frameId || !obj || typeof obj !== 'object') continue;
    const o = obj as Record<string, unknown>;
    if (String(o['frameId'] ?? '') === frameId) {
      children.push({
        x: Number(o['x'] ?? 0),
        y: Number(o['y'] ?? 0),
        width: Number(o['width'] ?? 160),
        height: Number(o['height'] ?? 120),
      });
    }
  }

  if (children.length === 0) throw new Error(`Frame ${frameId} has no children to fit`);

  const minX = Math.min(...children.map((c) => c.x));
  const minY = Math.min(...children.map((c) => c.y));
  const maxX = Math.max(...children.map((c) => c.x + c.width));
  const maxY = Math.max(...children.map((c) => c.y + c.height));

  const newX = minX - padding;
  const newY = minY - padding - 50; // 50px for frame title bar
  const newW = maxX - minX + padding * 2;
  const newH = maxY - minY + padding * 2 + 50;

  await admin.database().ref(`boards/${boardId}/objects/${frameId}`).update({
    x: newX, y: newY, width: newW, height: newH,
  });

  return { x: newX, y: newY, width: newW, height: newH };
}

export async function resizeObject(
  boardId: string,
  objectId: string,
  width: number,
  height: number
): Promise<void> {
  await admin.database().ref(`boards/${boardId}/objects/${objectId}`).update({ width, height });
}

export async function updateText(
  boardId: string,
  objectId: string,
  newText: string
): Promise<void> {
  await admin.database().ref(`boards/${boardId}/objects/${objectId}`).update({ text: newText });
}

export async function changeColor(
  boardId: string,
  objectId: string,
  color: string
): Promise<void> {
  await admin
    .database()
    .ref(`boards/${boardId}/objects/${objectId}`)
    .update({ color: mapColorNameToHex(color) });
}

// ---------------------------------------------------------------------------
// Board state
// ---------------------------------------------------------------------------

const COMPRESS_OBJECT_KEYS = ['id', 'type', 'x', 'y', 'width', 'height', 'text', 'color'] as const;
const COMPRESS_CONNECTION_KEYS = ['id', 'fromId', 'toId', 'fromAnchor', 'toAnchor', 'color', 'points'] as const;

function pick<T extends Record<string, unknown>>(obj: T, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

export function compressBoardState(state: {
  objects: Record<string, unknown>;
  connections: Record<string, unknown>;
}): { objects: Record<string, unknown>; connections: Record<string, unknown> } {
  const objects: Record<string, unknown> = {};
  for (const [id, obj] of Object.entries(state.objects)) {
    if (obj && typeof obj === 'object') objects[id] = pick(obj as Record<string, unknown>, COMPRESS_OBJECT_KEYS);
  }
  const connections: Record<string, unknown> = {};
  for (const [id, conn] of Object.entries(state.connections)) {
    if (conn && typeof conn === 'object') connections[id] = pick(conn as Record<string, unknown>, COMPRESS_CONNECTION_KEYS);
  }
  return { objects, connections };
}

/** Fallback canvas size if actual dimensions are not provided. */
const VIEWPORT_CANVAS_WIDTH = 1200;
const VIEWPORT_CANVAS_HEIGHT = 800;

export interface BoardContextOptions {
  selectedIds?: string[];
  /** width/height are the actual canvas pixel dimensions for accurate viewport filtering. */
  viewport?: { x: number; y: number; scale: number; width?: number; height?: number };
}

/** Returns compressed board state, optionally filtered by selection or viewport. */
export async function getBoardContext(
  boardId: string,
  options?: BoardContextOptions
): Promise<{ objects: Record<string, unknown>; connections: Record<string, unknown> }> {
  const raw = await getBoardState(boardId);
  const objects = raw.objects as Record<string, Record<string, unknown>>;
  const connections = raw.connections as Record<string, Record<string, unknown>>;

  let objectIds: Set<string>;
  if (options?.selectedIds?.length) {
    objectIds = new Set(options.selectedIds);
    for (const conn of Object.values(connections)) {
      if (conn && conn.fromId && conn.toId && (objectIds.has(conn.fromId as string) || objectIds.has(conn.toId as string))) {
        objectIds.add(conn.fromId as string);
        objectIds.add(conn.toId as string);
      }
    }
  } else if (options?.viewport) {
    const { x, y, scale } = options.viewport;
    const left = -x / scale;
    const top = -y / scale;
    const w = (options.viewport.width ?? VIEWPORT_CANVAS_WIDTH) / scale;
    const h = (options.viewport.height ?? VIEWPORT_CANVAS_HEIGHT) / scale;
    objectIds = new Set<string>();
    for (const [id, obj] of Object.entries(objects)) {
      if (!obj || typeof obj !== 'object') continue;
      const ox = Number(obj.x);
      const oy = Number(obj.y);
      const ow = Number(obj.width) ?? 0;
      const oh = Number(obj.height) ?? 0;
      if (ox + ow >= left && ox <= left + w && oy + oh >= top && oy <= top + h) objectIds.add(id);
    }
    for (const conn of Object.values(connections)) {
      if (conn && conn.fromId && conn.toId && (objectIds.has(conn.fromId as string) || objectIds.has(conn.toId as string))) {
        objectIds.add(conn.fromId as string);
        objectIds.add(conn.toId as string);
      }
    }
  } else {
    return compressBoardState(raw);
  }

  const filteredObjects: Record<string, unknown> = {};
  for (const id of objectIds) {
    if (objects[id]) filteredObjects[id] = objects[id];
  }
  const filteredConnections: Record<string, unknown> = {};
  for (const [cid, conn] of Object.entries(connections)) {
    if (conn && conn.fromId && conn.toId && objectIds.has(conn.fromId as string) && objectIds.has(conn.toId as string)) {
      filteredConnections[cid] = conn;
    }
  }
  return compressBoardState({ objects: filteredObjects, connections: filteredConnections });
}

export async function getBoardState(boardId: string): Promise<{
  objects: Record<string, unknown>;
  connections: Record<string, unknown>;
}> {
  const [objSnap, connSnap] = await Promise.all([
    admin.database().ref(`boards/${boardId}/objects`).once('value'),
    admin.database().ref(`boards/${boardId}/connections`).once('value'),
  ]);
  return {
    objects: objSnap.val() ?? {},
    connections: connSnap.val() ?? {},
  };
}

// ---------------------------------------------------------------------------
// Frame membership + layer control + rotation
// ---------------------------------------------------------------------------

export async function addToFrame(
  boardId: string,
  objectIds: string[],
  frameId: string
): Promise<void> {
  if (objectIds.length === 0) return;
  const updates: Record<string, unknown> = {};
  for (const id of objectIds) {
    updates[`boards/${boardId}/objects/${id}/frameId`] = frameId;
  }
  await admin.database().ref().update(updates);
}

export async function setLayer(
  boardId: string,
  objectId: string,
  sentToBack: boolean
): Promise<void> {
  await admin.database().ref(`boards/${boardId}/objects/${objectId}`).update({ sentToBack });
}

export async function rotateObject(
  boardId: string,
  objectId: string,
  rotation: number
): Promise<void> {
  await admin.database().ref(`boards/${boardId}/objects/${objectId}`).update({ rotation });
}

// ---------------------------------------------------------------------------
// createMany — server-computed bulk creation
// ---------------------------------------------------------------------------

/**
 * Compute N (x,y) positions for a given layout strategy.
 * All positions are relative to origin (0,0) — the caller offsets them to center on the viewport.
 */
function computeLayoutPositions(
  layout: CreateManyLayout,
  count: number,
  itemW: number,
  itemH: number,
  gap: number,
): Array<{ x: number; y: number }> {
  const sw = itemW + gap;
  const sh = itemH + gap;
  const pts: Array<{ x: number; y: number }> = [];

  switch (layout) {
    case 'grid': {
      const cols = Math.ceil(Math.sqrt(count));
      for (let i = 0; i < count; i++) {
        pts.push({ x: (i % cols) * sw, y: Math.floor(i / cols) * sh });
      }
      break;
    }
    case 'row': {
      for (let i = 0; i < count; i++) pts.push({ x: i * sw, y: 0 });
      break;
    }
    case 'column': {
      for (let i = 0; i < count; i++) pts.push({ x: 0, y: i * sh });
      break;
    }
    case 'circle': {
      const radius = Math.max(150, Math.ceil((count * (Math.max(itemW, itemH) + gap)) / (2 * Math.PI)));
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * 2 * Math.PI - Math.PI / 2;
        pts.push({
          x: Math.round(radius + radius * Math.cos(angle) - itemW / 2),
          y: Math.round(radius + radius * Math.sin(angle) - itemH / 2),
        });
      }
      break;
    }
    case 'x_pattern': {
      // Two crossing diagonals. Arm length N = ceil((count+1)/2).
      const N = Math.max(2, Math.ceil((count + 1) / 2));
      const seen = new Set<string>();
      for (let i = 0; i < N && pts.length < count; i++) {
        const k1 = `${i},${i}`;
        if (!seen.has(k1)) { seen.add(k1); pts.push({ x: i * sw, y: i * sh }); }
        const k2 = `${N - 1 - i},${i}`;
        if (!seen.has(k2)) { seen.add(k2); pts.push({ x: (N - 1 - i) * sw, y: i * sh }); }
      }
      break;
    }
    case 'cross': {
      // Plus sign: horizontal + vertical bar crossing at center.
      const N = Math.max(2, Math.ceil((count + 3) / 4)); // arm count (including center)
      const total = 2 * N - 1;
      const center = (N - 1) * sw;
      const seen = new Set<string>();
      for (let i = 0; i < total && pts.length < count; i++) {
        const hk = `h${i}`;
        if (!seen.has(hk)) { seen.add(hk); pts.push({ x: i * sw, y: center }); }
      }
      for (let j = 0; j < total && pts.length < count; j++) {
        const vk = `v${j}`;
        if (j === N - 1) continue; // center already added by horizontal pass
        if (!seen.has(vk)) { seen.add(vk); pts.push({ x: center, y: j * sh }); }
      }
      break;
    }
    case 'diamond': {
      // Filled diamond: all (col,row) cells where taxicab distance from center ≤ R.
      const R = Math.max(1, Math.round(Math.sqrt(count / 2)));
      for (let row = -R; row <= R && pts.length < count; row++) {
        const span = R - Math.abs(row);
        for (let col = -span; col <= span && pts.length < count; col++) {
          pts.push({ x: (R + col) * sw, y: (R + row) * sh });
        }
      }
      break;
    }
    case 'triangle': {
      // Staircase triangle: row r has r+1 items, centered within the widest row.
      const N = Math.ceil((-1 + Math.sqrt(1 + 8 * count)) / 2); // rows needed
      let remaining = count;
      for (let r = 0; r < N && remaining > 0; r++) {
        const items = Math.min(r + 1, remaining);
        const offsetX = Math.round(((N - 1) - r) / 2); // center row within base
        for (let c = 0; c < items; c++) {
          pts.push({ x: (offsetX + c) * sw, y: r * sh });
        }
        remaining -= items;
      }
      break;
    }
  }
  return pts.slice(0, count);
}

/** Offset a set of positions so their bounding box is centered at (cx, cy). */
function centerPositions(
  pts: Array<{ x: number; y: number }>,
  itemW: number,
  itemH: number,
  cx: number,
  cy: number,
): Array<{ x: number; y: number }> {
  if (pts.length === 0) return pts;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + itemW); maxY = Math.max(maxY, p.y + itemH);
  }
  const dx = Math.round(cx - (minX + maxX) / 2);
  const dy = Math.round(cy - (minY + maxY) / 2);
  return pts.map(p => ({ x: p.x + dx, y: p.y + dy }));
}

/**
 * Create N identical objects in one Firebase write.
 * The server computes all positions — the LLM only needs to specify count, layout, and anchor.
 * If containerId is set, items are packed inside that container (and it is resized if needed).
 */
export async function createMany(
  boardId: string,
  args: CreateManyArgs,
  userId: string,
  cache?: ObjectCache,
): Promise<{ objectIds: string[] }> {
  const count = Math.min(Math.max(Math.round(args.count), 1), 200);
  const defaultW = args.objectType === 'stickyNote' ? 160 : 100;
  const defaultH = args.objectType === 'stickyNote' ? 120 : (args.objectType === 'circle' ? 100 : 80);
  const itemW = args.itemWidth ?? defaultW;
  const itemH = args.itemHeight ?? defaultH;
  const gap   = args.gap ?? 10;
  const color = mapColorNameToHex(args.color ?? (args.objectType === 'stickyNote' ? 'yellow' : 'blue'));
  const now   = Date.now();

  let positions: Array<{ x: number; y: number }>;

  if (args.containerId) {
    // Pack inside container, resize if needed
    const snap = await admin.database().ref(`boards/${boardId}/objects/${args.containerId}`).once('value');
    const container = snap.val() as Record<string, unknown> | null;
    if (!container) throw new Error(`Container ${args.containerId} not found`);

    const cx = Number(container['x'] ?? 0);
    const cy = Number(container['y'] ?? 0);
    let cw   = Number(container['width'] ?? 320);
    let ch   = Number(container['height'] ?? 220);
    const pad = 20;

    let cols = Math.max(1, Math.floor((cw - pad * 2 + gap) / (itemW + gap)));
    let rows = Math.ceil(count / cols);
    const neededW = cols * (itemW + gap) - gap + pad * 2;
    const neededH = rows * (itemH + gap) - gap + pad * 2;

    if (neededH > ch || neededW > cw) {
      cw = Math.max(cw, neededW);
      ch = neededH;
      await admin.database().ref(`boards/${boardId}/objects/${args.containerId}`).update({ width: cw, height: ch });
      cols = Math.max(1, Math.floor((cw - pad * 2 + gap) / (itemW + gap)));
      rows = Math.ceil(count / cols);
    }

    positions = [];
    for (let i = 0; i < count; i++) {
      positions.push({
        x: cx + pad + (i % cols) * (itemW + gap),
        y: cy + pad + Math.floor(i / cols) * (itemH + gap),
      });
    }
  } else {
    // Compute positions at origin, then center on the provided anchor (viewport center)
    const rawPts = computeLayoutPositions(args.layout, count, itemW, itemH, gap);
    const anchorCx = args.anchorX ?? 500;
    const anchorCy = args.anchorY ?? 400;
    positions = centerPositions(rawPts, itemW, itemH, anchorCx, anchorCy);
  }

  const updates: Record<string, unknown> = {};
  const objectIds: string[] = [];

  for (let i = 0; i < count; i++) {
    const id = randomUUID();
    const { x, y } = positions[i];
    let obj: Record<string, unknown>;

    if (args.objectType === 'stickyNote') {
      obj = { id, type: 'stickyNote', text: args.text ?? '', x, y, width: itemW, height: itemH, color, createdBy: userId, createdAt: now + i };
    } else {
      obj = { id, type: args.objectType, x, y, width: itemW, height: itemH, color, createdBy: userId, createdAt: now + i };
    }

    updates[`boards/${boardId}/objects/${id}`] = obj;
    cache?.set(id, { x, y, width: itemW, height: itemH });
    objectIds.push(id);
  }

  await admin.database().ref().update(updates);
  return { objectIds };
}

// ---------------------------------------------------------------------------
// arrangeWithin — server-computed packing of existing objects into a container
// ---------------------------------------------------------------------------

/**
 * Move existing objects into a tight grid inside a container.
 * Reads actual item dimensions from Firebase, computes all positions server-side,
 * centers the grid within the available interior, and resizes the container if needed.
 */
export async function arrangeWithin(
  boardId: string,
  args: ArrangeWithinArgs,
): Promise<{ moves: number; resized: boolean }> {
  // Fetch container + all items in one parallel batch
  const [containerSnap, ...itemSnaps] = await Promise.all([
    admin.database().ref(`boards/${boardId}/objects/${args.containerId}`).once('value'),
    ...args.objectIds.map(id =>
      admin.database().ref(`boards/${boardId}/objects/${id}`).once('value')
    ),
  ]);

  const container = containerSnap.val() as Record<string, unknown> | null;
  if (!container) throw new Error(`Container ${args.containerId} not found`);

  // Pair each objectId with its data — preserves index alignment (no filter-shift bug)
  const rawItems = itemSnaps.map(s => s.val() as Record<string, unknown> | null);
  const validPairs = args.objectIds
    .map((id, i) => ({ id, data: rawItems[i] }))
    .filter((p): p is { id: string; data: Record<string, unknown> } => p.data !== null);

  const count = validPairs.length;
  if (count === 0) return { moves: 0, resized: false };

  const cx  = Number(container['x'] ?? 0);
  const cy  = Number(container['y'] ?? 0);
  let cw    = Number(container['width']  ?? 320);
  let ch    = Number(container['height'] ?? 220);
  const gap    = args.gap ?? 8;
  const layout = args.layout ?? 'grid';
  const pad    = 20;

  // Frames render a title bar that consumes the top ~50 px of their bounding box.
  // Offset items downward so they don't overlap the title.
  const isFrame    = String(container['type'] ?? '') === 'frame';
  const titleOffset = isFrame ? 50 : 0;

  // Average item dimensions (used for spacing; works best when items are uniform)
  const avgW = Math.round(
    validPairs.reduce((s, p) => s + Number(p.data['width']  ?? 80), 0) / count
  );
  const avgH = Math.round(
    validPairs.reduce((s, p) => s + Number(p.data['height'] ?? 80), 0) / count
  );

  // Interior available space (inside padding, below title bar)
  const innerW = cw - pad * 2;
  const innerH = ch - pad * 2 - titleOffset;

  // Columns: how many items fit in a row
  let cols: number;
  if      (layout === 'row')    { cols = count; }
  else if (layout === 'column') { cols = 1; }
  else { cols = Math.max(1, Math.floor((innerW + gap) / (avgW + gap))); }

  const rows  = Math.ceil(count / cols);
  // Pixel footprint of the grid content (no trailing gap)
  const gridW = cols * (avgW + gap) - gap;
  const gridH = rows * (avgH + gap) - gap;

  // Minimum container dimensions to contain the grid with padding on all sides
  const minCW = gridW + pad * 2;
  const minCH = gridH + pad * 2 + titleOffset;

  let resized = false;
  if ((args.resizeToFit !== false) && (cw < minCW || ch < minCH)) {
    cw = Math.max(cw, minCW);
    ch = Math.max(ch, minCH);
    await admin.database()
      .ref(`boards/${boardId}/objects/${args.containerId}`)
      .update({ width: cw, height: ch });
    resized = true;
    // Recompute cols if container grew wider than originally planned
    if (layout === 'grid') {
      cols = Math.max(1, Math.floor((cw - pad * 2 + gap) / (avgW + gap)));
    }
  }

  // Center the grid within the container interior
  const startX = cx + Math.round((cw - gridW) / 2);
  const startY = cy + titleOffset + Math.round((ch - titleOffset - gridH) / 2);

  const updates: Record<string, unknown> = {};
  for (let i = 0; i < validPairs.length; i++) {
    const col = layout === 'column' ? 0 : i % cols;
    const row = layout === 'row'    ? 0 : Math.floor(i / cols);
    updates[`boards/${boardId}/objects/${validPairs[i].id}/x`] = startX + col * (avgW + gap);
    updates[`boards/${boardId}/objects/${validPairs[i].id}/y`] = startY + row * (avgH + gap);
    if (args.addToFrame) {
      updates[`boards/${boardId}/objects/${validPairs[i].id}/frameId`] = args.containerId;
    }
  }

  if (Object.keys(updates).length > 0) {
    await admin.database().ref().update(updates);
  }

  return { moves: validPairs.length, resized };
}

// ---------------------------------------------------------------------------
// Agent status (for live UI streaming)
// ---------------------------------------------------------------------------

export interface AgentStatus {
  phase: 'thinking' | 'calling_tools';
  iteration?: number;
  maxIterations?: number;
  tools?: string[];
}

export async function writeAgentStatus(boardId: string, status: AgentStatus): Promise<void> {
  await admin.database().ref(`boards/${boardId}/agentStatus`).set(status);
}

export async function clearAgentStatus(boardId: string): Promise<void> {
  await admin.database().ref(`boards/${boardId}/agentStatus`).remove();
}
