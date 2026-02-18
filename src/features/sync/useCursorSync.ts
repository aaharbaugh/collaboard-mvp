import { useState, useEffect, useCallback, useRef } from 'react';
import { ref, onValue, set, onDisconnect, remove } from 'firebase/database';
import { database } from '../../lib/firebase';
import { CURSOR_COLORS } from '../../lib/constants';
import type { Cursor } from '../../types/board';

/** Cursors older than this are hidden and removed from the database. */
const STALE_CURSOR_MS = 60 * 1000;
/** How often to remove stale cursor entries from the database. */
const CLEANUP_INTERVAL_MS = 30 * 1000;

function hashColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0;
  }
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}

function isCursorStale(cursor: Cursor, now: number): boolean {
  const last = cursor?.lastUpdate ?? 0;
  return now - last > STALE_CURSOR_MS;
}

export function useCursorSync(
  boardId: string | null,
  userId: string | undefined,
  userName: string
) {
  const [cursors, setCursors] = useState<Record<string, Cursor>>({});
  const lastUpdate = useRef(0);
  const rawCursorsRef = useRef<Record<string, Cursor>>({});
  const THROTTLE_MS = 16;

  useEffect(() => {
    if (!boardId) {
      setCursors({});
      rawCursorsRef.current = {};
      return;
    }

    const cursorsRef = ref(database, `boards/${boardId}/cursors`);
    const unsubscribe = onValue(cursorsRef, (snapshot) => {
      const raw = snapshot.val() || {};
      rawCursorsRef.current = raw;
      const now = Date.now();
      const active = Object.fromEntries(
        Object.entries(raw).filter(
          ([_, c]) => c && !isCursorStale(c as Cursor, now)
        )
      ) as Record<string, Cursor>;
      setCursors(active);
    });
    return unsubscribe;
  }, [boardId]);

  // Periodically remove stale cursor entries from the database.
  useEffect(() => {
    if (!boardId || !userId) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const raw = rawCursorsRef.current;
      for (const [uid, cursor] of Object.entries(raw)) {
        if (uid === userId) continue;
        if (cursor && isCursorStale(cursor, now)) {
          const cursorRef = ref(database, `boards/${boardId}/cursors/${uid}`);
          remove(cursorRef).catch(() => {});
        }
      }
    }, CLEANUP_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [boardId, userId]);

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
