import { useState, useEffect, useCallback } from 'react';
import { ref, get } from 'firebase/database';
import { database } from '../../../lib/firebase';
import { getCachedBoardIds } from '../utils/boardCache';

export interface BoardMeta {
  id: string;
  name: string;
  owner: string;
  createdAt: number;
}

async function fetchBoardMeta(boardId: string): Promise<BoardMeta | null> {
  try {
    const snap = await get(ref(database, `boards/${boardId}/metadata`));
    if (!snap.exists()) return null;
    const m = snap.val();
    return { id: boardId, name: m.name ?? 'Untitled', owner: m.owner, createdAt: m.createdAt ?? 0 };
  } catch {
    return null;
  }
}

export function useUserBoards(userId: string | undefined) {
  const [boards, setBoards] = useState<BoardMeta[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!userId) {
      setBoards([]);
      return;
    }
    setLoading(true);

    // Always start from localStorage cache so we never hang on missing Firebase rules
    const cachedIds = getCachedBoardIds(userId);

    // Optionally merge with Firebase userBoards index if rules are deployed
    let allIds = cachedIds;
    try {
      const snap = await get(ref(database, `userBoards/${userId}`));
      if (snap.exists()) {
        const fbIds = Object.keys(snap.val());
        allIds = [...new Set([...fbIds, ...cachedIds])];
      }
    } catch {
      // Rules not deployed yet — localStorage cache is enough
    }

    const results = await Promise.all(allIds.map(fetchBoardMeta));
    const valid = (results.filter(Boolean) as BoardMeta[]).sort(
      (a, b) => b.createdAt - a.createdAt
    );
    setBoards(valid);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { boards, loading, refresh: load };
}
