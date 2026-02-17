import { useState, useEffect, useCallback } from 'react';
import { ref, onValue, set, update, remove } from 'firebase/database';
import { database } from '../../lib/firebase';
import type { BoardObject, Connection } from '../../types/board';

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
      const raw = snapshot.val() || {};
      setObjects(raw as Record<string, BoardObject>);
    });

    const connectionsRef = ref(database, `boards/${boardId}/connections`);
    const unsubConnections = onValue(connectionsRef, (snapshot) => {
      const raw = snapshot.val() || {};
      setConnections(raw as Record<string, Connection>);
    });

    return () => {
      unsubObjects();
      unsubConnections();
    };
  }, [boardId]);

  const createObject = useCallback(
    (obj: BoardObject) => {
      if (!boardId) return;
      set(
        ref(database, `boards/${boardId}/objects/${obj.id}`),
        obj
      ).catch(console.error);
    },
    [boardId]
  );

  const updateObject = useCallback(
    (id: string, updates: Partial<BoardObject>) => {
      if (!boardId) return;
      // Only send defined fields so we never overwrite or clear other users' state (e.g. selectedBy).
      // Firebase update() merges at the path; omitting a key leaves it unchanged.
      const payload: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) payload[key] = value;
      }
      if (Object.keys(payload).length === 0) return;
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
