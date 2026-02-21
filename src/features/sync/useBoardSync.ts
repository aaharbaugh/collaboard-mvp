import { useState, useEffect, useCallback } from 'react';
import { ref, onValue, set, update, remove } from 'firebase/database';
import { database } from '../../lib/firebase';
import type { BoardObject, Connection } from '../../types/board';

// ---------------------------------------------------------------------------
// Field-level diff helpers — only trigger re-renders for objects that changed
// ---------------------------------------------------------------------------

function hasObjectChanged(prev: BoardObject, next: BoardObject): boolean {
  return (
    prev.x !== next.x ||
    prev.y !== next.y ||
    prev.width !== next.width ||
    prev.height !== next.height ||
    prev.text !== next.text ||
    prev.color !== next.color ||
    prev.rotation !== next.rotation ||
    prev.sentToBack !== next.sentToBack ||
    prev.frameId !== next.frameId ||
    prev.selectedBy !== next.selectedBy ||
    prev.selectedByName !== next.selectedByName ||
    prev.headingLevel !== next.headingLevel ||
    prev.type !== next.type
  );
}

function hasConnectionChanged(prev: Connection, next: Connection): boolean {
  if (
    prev.fromId !== next.fromId ||
    prev.toId !== next.toId ||
    prev.fromAnchor !== next.fromAnchor ||
    prev.toAnchor !== next.toAnchor ||
    prev.color !== next.color
  ) return true;
  const pp = prev.points, np = next.points;
  if (pp === np) return false;
  if (!pp || !np || pp.length !== np.length) return true;
  for (let i = 0; i < pp.length; i++) if (pp[i] !== np[i]) return true;
  return false;
}

export function useBoardSync(boardId: string | null) {
  const [objects, setObjects] = useState<Record<string, BoardObject>>({});
  const [connections, setConnections] = useState<Record<string, Connection>>({});

  useEffect(() => {
    if (!boardId) {
      setObjects({});
      setConnections({});
      return;
    }

    const objectsRef = ref(database, `boards/${boardId}/objects`);
    const unsubObjects = onValue(objectsRef, (snapshot) => {
      const raw = (snapshot.val() || {}) as Record<string, BoardObject>;
      // Copy-on-write: only update entries that actually changed, return same
      // reference if nothing changed so downstream useMemos don't invalidate.
      setObjects((prev) => {
        let next = prev;
        for (const id of Object.keys(prev)) {
          if (!raw[id]) {
            if (next === prev) next = { ...prev };
            delete next[id];
          }
        }
        for (const [id, newObj] of Object.entries(raw)) {
          if (!prev[id] || hasObjectChanged(prev[id], newObj)) {
            if (next === prev) next = { ...prev };
            next[id] = newObj;
          }
        }
        return next;
      });
    });

    const connectionsRef = ref(database, `boards/${boardId}/connections`);
    const unsubConnections = onValue(connectionsRef, (snapshot) => {
      const raw = (snapshot.val() || {}) as Record<string, Connection>;
      setConnections((prev) => {
        let next = prev;
        for (const id of Object.keys(prev)) {
          if (!raw[id]) {
            if (next === prev) next = { ...prev };
            delete next[id];
          }
        }
        for (const [id, newConn] of Object.entries(raw)) {
          if (!prev[id] || hasConnectionChanged(prev[id], newConn)) {
            if (next === prev) next = { ...prev };
            next[id] = newConn;
          }
        }
        return next;
      });
    });

    return () => {
      unsubObjects();
      unsubConnections();
    };
  }, [boardId]);

  const createObject = useCallback(
    (obj: BoardObject) => {
      if (!boardId) return;
      // Serialize to a plain object so undefined/null and non-JSON fields don't break persistence (e.g. frames)
      const payload: Record<string, unknown> = {
        id: obj.id,
        type: obj.type,
        x: obj.x,
        y: obj.y,
        width: obj.width,
        height: obj.height,
        createdBy: obj.createdBy,
        createdAt: obj.createdAt,
      };
      if (obj.color != null) payload.color = obj.color;
      if (obj.text != null) payload.text = obj.text;
      if (obj.headingLevel != null) payload.headingLevel = obj.headingLevel;
      if (obj.imageData != null) payload.imageData = obj.imageData;
      if (obj.rotation != null) payload.rotation = obj.rotation;
      if (obj.selectedBy != null) payload.selectedBy = obj.selectedBy;
      if (obj.selectedByName != null) payload.selectedByName = obj.selectedByName;
      if (obj.sentToBack != null) payload.sentToBack = obj.sentToBack;
      if (obj.frameId != null) payload.frameId = obj.frameId;
      set(
        ref(database, `boards/${boardId}/objects/${obj.id}`),
        payload
      ).catch(console.error);
    },
    [boardId]
  );

  /** Keys that can be explicitly cleared by passing undefined; we send null so Firebase removes them */
  const CLEARABLE_OBJECT_KEYS = new Set<string>(['frameId', 'selectedBy', 'selectedByName']);

  const updateObject = useCallback(
    (id: string, updates: Partial<BoardObject>) => {
      if (!boardId) return;
      const payload: Record<string, unknown> = {};
      const optimistic: Partial<BoardObject> = {};
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) {
          payload[key] = value;
          (optimistic as Record<string, unknown>)[key] = value;
        } else if (CLEARABLE_OBJECT_KEYS.has(key)) {
          payload[key] = null;
          (optimistic as Record<string, unknown>)[key] = null;
        }
      }
      if (Object.keys(payload).length === 0) return;
      // Optimistic local update so UI doesn't re-render again when Firebase sync returns
      setObjects((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev[id], ...optimistic } as BoardObject;
        if (!hasObjectChanged(prev[id], next)) return prev;
        return { ...prev, [id]: next };
      });
      update(
        ref(database, `boards/${boardId}/objects/${id}`),
        payload
      ).catch(console.error);
    },
    [boardId]
  );

  const deleteObject = useCallback(
    (id: string) => {
      if (!boardId) return;
      remove(ref(database, `boards/${boardId}/objects/${id}`)).catch(
        console.error
      );
    },
    [boardId]
  );

  const createConnection = useCallback(
    (conn: Connection) => {
      if (!boardId) return;
      set(
        ref(database, `boards/${boardId}/connections/${conn.id}`),
        conn
      ).catch(console.error);
    },
    [boardId]
  );

  const updateConnection = useCallback(
    (id: string, updates: Partial<Connection>) => {
      if (!boardId) return;
      const payload: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) payload[key] = value;
      }
      if (Object.keys(payload).length === 0) return;
      update(
        ref(database, `boards/${boardId}/connections/${id}`),
        payload
      ).catch(console.error);
    },
    [boardId]
  );

  const deleteConnection = useCallback(
    (id: string) => {
      if (!boardId) return;
      remove(ref(database, `boards/${boardId}/connections/${id}`)).catch(
        console.error
      );
    },
    [boardId]
  );

  const deleteConnectionsForObject = useCallback(
    (objectId: string) => {
      if (!boardId) return;
      const updates: Record<string, null> = {};
      for (const [connId, conn] of Object.entries(connections)) {
        if (conn.fromId === objectId || conn.toId === objectId) {
          updates[`boards/${boardId}/connections/${connId}`] = null;
        }
      }
      if (Object.keys(updates).length > 0) {
        update(ref(database), updates).catch(console.error);
      }
    },
    [boardId, connections]
  );

  return {
    objects,
    connections,
    createObject,
    updateObject,
    deleteObject,
    createConnection,
    updateConnection,
    deleteConnection,
    deleteConnectionsForObject,
  };
}
