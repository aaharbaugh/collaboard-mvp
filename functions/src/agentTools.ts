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
  action: 'createStickyNote' | 'createShape' | 'createFrame';
  params: Record<string, unknown>;
}

export interface BatchConnectOp {
  fromId: string;
  toId: string;
  options?: ConnectorOptions;
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
// Internal: write a single connection record (no Firebase object read)
// ---------------------------------------------------------------------------

async function _writeConnection(
  boardId: string,
  fromId: string,
  toId: string,
  fromObj: BoardObjectLite,
  toObj: BoardObjectLite,
  options: ConnectorOptions,
  userId: string
): Promise<string> {
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
    color: options.color ? mapColorNameToHex(options.color) : BOARD_PALETTE_HEX[2],
    createdBy: userId,
    createdAt: Date.now(),
  };

  const flat = flattenWaypoints(options);
  if (flat) data['points'] = flat;

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
    const x = Number(op.params['x'] ?? 0);
    const y = Number(op.params['y'] ?? 0);
    let w = 160;
    let h = 120;
    let obj: Record<string, unknown>;

    switch (op.action) {
      case 'createStickyNote': {
        w = 160; h = 120;
        obj = {
          id, type: 'stickyNote',
          text: String(op.params['text'] ?? ''),
          x, y, width: w, height: h,
          color: mapColorNameToHex(String(op.params['color'] ?? 'yellow')),
          createdBy: userId, createdAt: Date.now(),
        };
        break;
      }
      case 'createShape': {
        w = Number(op.params['width'] ?? 150);
        h = Number(op.params['height'] ?? 100);
        obj = {
          id, type: String(op.params['type'] ?? 'rectangle'),
          x, y, width: w, height: h,
          color: mapColorNameToHex(String(op.params['color'] ?? 'blue')),
          createdBy: userId, createdAt: Date.now(),
        };
        break;
      }
      case 'createFrame': {
        w = Number(op.params['width'] ?? 320);
        h = Number(op.params['height'] ?? 220);
        obj = {
          id, type: 'frame',
          text: String(op.params['title'] ?? ''),
          x, y, width: w, height: h,
          color: '#12121a',
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

    const connId = await _writeConnection(
      boardId, fromId, toId, fromObj, toObj,
      { color: options.color, points: waypoints },
      userId
    );
    connectionIds.push(connId);
  }

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

  // Read objects once (instead of once per connector)
  const objectsSnap = await admin
    .database()
    .ref(`boards/${boardId}/objects`)
    .once('value');
  const objects: Record<string, BoardObjectLite> = objectsSnap.val() ?? {};

  const connectionIds: string[] = [];

  for (let i = 0; i < objectIds.length - 1; i++) {
    const fromId = objectIds[i];
    const toId = objectIds[i + 1];
    if (!objects[fromId]) throw new Error(`Object not found: ${fromId}`);
    if (!objects[toId]) throw new Error(`Object not found: ${toId}`);
    const id = await _writeConnection(
      boardId, fromId, toId, objects[fromId], objects[toId],
      { color: options.color },
      userId
    );
    connectionIds.push(id);
  }

  if (options.direction === 'bidirectional') {
    for (let i = objectIds.length - 1; i > 0; i--) {
      const fromId = objectIds[i];
      const toId = objectIds[i - 1];
      if (!objects[fromId]) throw new Error(`Object not found: ${fromId}`);
      if (!objects[toId]) throw new Error(`Object not found: ${toId}`);
      const id = await _writeConnection(
        boardId, fromId, toId, objects[fromId], objects[toId],
        { color: options.color },
        userId
      );
      connectionIds.push(id);
    }
  }

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
      color: options.color ? mapColorNameToHex(options.color) : BOARD_PALETTE_HEX[2],
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

/** Reference canvas size for viewport-to-world rect (px). */
const VIEWPORT_CANVAS_WIDTH = 1200;
const VIEWPORT_CANVAS_HEIGHT = 800;

export interface BoardContextOptions {
  selectedIds?: string[];
  viewport?: { x: number; y: number; scale: number };
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
    const w = VIEWPORT_CANVAS_WIDTH / scale;
    const h = VIEWPORT_CANVAS_HEIGHT / scale;
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
