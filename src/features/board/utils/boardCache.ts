const PREFIX = 'collabboard:userBoards:';

export function getCachedBoardIds(userId: string): string[] {
  try {
    const raw = localStorage.getItem(`${PREFIX}${userId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addBoardToCache(userId: string, boardId: string): void {
  try {
    const ids = getCachedBoardIds(userId);
    if (!ids.includes(boardId)) {
      localStorage.setItem(`${PREFIX}${userId}`, JSON.stringify([boardId, ...ids]));
    }
  } catch {
    // ignore
  }
}

export function removeBoardFromCache(userId: string, boardId: string): void {
  try {
    const ids = getCachedBoardIds(userId);
    localStorage.setItem(`${PREFIX}${userId}`, JSON.stringify(ids.filter((id) => id !== boardId)));
  } catch {
    // ignore
  }
}
