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
}

export interface MultiPointOptions {
  color?: string;
  curved?: boolean;
}

export interface SequenceOptions {
  color?: string;
  direction?: 'forward' | 'bidirectional';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COLOR_MAP: Record<string, string> = {
  yellow: '#FFD700',
  pink: '#FFC0CB',
  blue: '#4A90E2',
  green: '#7ED321',
  orange: '#FF6B00',
  purple: '#9013FE',
};

export function mapColorNameToHex(color: string): string {
  return COLOR_MAP[color.toLowerCase()] ?? color;
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
  const objects: Record<string, { x: number; y: number; width: number; height: number }> =
    objectsSnap.val() ?? {};

  const fromObj = objects[fromId];
  const toObj = objects[toId];

  if (!fromObj) throw new Error(`Object not found: ${fromId}`);
  if (!toObj) throw new Error(`Object not found: ${toId}`);

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
    color: options.color ? mapColorNameToHex(options.color) : '#00d4ff',
    createdBy: userId,
    createdAt: Date.now(),
  };

  // Convert {x,y}[] waypoints to flat number[] for Firebase (Connection.points type)
  if (options.points && options.points.length > 0) {
    data['points'] = options.points.flatMap((p) => [p.x, p.y]);
  }

  await admin.database().ref(`boards/${boardId}/connections/${id}`).set(data);
  return id;
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

  const objectsSnap = await admin
    .database()
    .ref(`boards/${boardId}/objects`)
    .once('value');
  const objects: Record<string, { x: number; y: number; width: number; height: number }> =
    objectsSnap.val() ?? {};

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

    const connId = await createConnector(
      boardId,
      fromId,
      toId,
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

  const connectionIds: string[] = [];

  for (let i = 0; i < objectIds.length - 1; i++) {
    const id = await createConnector(
      boardId,
      objectIds[i],
      objectIds[i + 1],
      { color: options.color },
      userId
    );
    connectionIds.push(id);
  }

  if (options.direction === 'bidirectional') {
    for (let i = objectIds.length - 1; i > 0; i--) {
      const id = await createConnector(
        boardId,
        objectIds[i],
        objectIds[i - 1],
        { color: options.color },
        userId
      );
      connectionIds.push(id);
    }
  }

  return connectionIds;
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
