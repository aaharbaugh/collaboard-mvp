import { useState, useEffect, useCallback, useRef } from 'react';
import { ref, onValue, set, onDisconnect, remove } from 'firebase/database';
import { database } from '../../lib/firebase';
import { CURSOR_COLORS } from '../../lib/constants';
import type { Cursor } from '../../types/board';

function hashColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0;
  }
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}

export function useCursorSync(
  boardId: string | null,
  userId: string | undefined,
  userName: string
) {
  const [cursors, setCursors] = useState<Record<string, Cursor>>({});
  const lastUpdate = useRef(0);
  const THROTTLE_MS = 16;

  useEffect(() => {
    if (!boardId) {
      setCursors({});
      return;
    }

    const cursorsRef = ref(database, `boards/${boardId}/cursors`);
    const unsubscribe = onValue(cursorsRef, (snapshot) => {
      setCursors(snapshot.val() || {});
    });
    return unsubscribe;
  }, [boardId]);

  const updateCursor = useCallback(
    (x: number, y: number) => {
      if (!boardId || !userId) return;
      const now = Date.now();
      if (now - lastUpdate.current < THROTTLE_MS) return;
      lastUpdate.current = now;

      const cursor: Cursor = {
        userId,
        name: userName,
        x,
        y,
        color: hashColor(userId),
        lastUpdate: now,
      };

      const cursorRef = ref(database, `boards/${boardId}/cursors/${userId}`);
      set(cursorRef, cursor).catch(console.error);
    },
    [boardId, userId, userName]
  );

  useEffect(() => {
    if (!boardId || !userId) return;

    const cursorRef = ref(database, `boards/${boardId}/cursors/${userId}`);
    onDisconnect(cursorRef).remove().catch(console.error);

    return () => {
      remove(cursorRef).catch(() => {});
    };
  }, [boardId, userId]);

  return { cursors, updateCursor };
}
