import { ref, set, get, update, remove } from 'firebase/database';
import { database } from '../../../lib/firebase';
import { addBoardToCache, removeBoardFromCache } from './boardCache';

export async function createNewBoard(userId: string, name = 'New Board'): Promise<string> {
  const newId = crypto.randomUUID();
  await set(ref(database, `boards/${newId}`), {
    metadata: { owner: userId, name, createdAt: Date.now() },
    collaborators: { [userId]: true },
    objects: {},
    cursors: {},
  });
  addBoardToCache(userId, newId);
  try {
    await set(ref(database, `userBoards/${userId}/${newId}`), true);
  } catch {
    // Rules not yet deployed — localStorage cache is the fallback
  }
  return newId;
}

export async function renameBoard(boardId: string, newName: string): Promise<void> {
  await update(ref(database, `boards/${boardId}/metadata`), { name: newName });
}

export async function deleteBoard(userId: string, boardId: string): Promise<void> {
  await remove(ref(database, `boards/${boardId}`));
  removeBoardFromCache(userId, boardId);
  try {
    await remove(ref(database, `userBoards/${userId}/${boardId}`));
  } catch {
    // Rules not yet deployed
  }
}

export async function duplicateBoard(userId: string, sourceBoardId: string, sourceName: string): Promise<string> {
  const [objectsSnap, connectionsSnap] = await Promise.all([
    get(ref(database, `boards/${sourceBoardId}/objects`)),
    get(ref(database, `boards/${sourceBoardId}/connections`)),
  ]);

  const newId = crypto.randomUUID();
  await set(ref(database, `boards/${newId}`), {
    metadata: { owner: userId, name: `Copy of ${sourceName}`, createdAt: Date.now() },
    collaborators: { [userId]: true },
    objects: objectsSnap.val() ?? {},
    connections: connectionsSnap.val() ?? {},
    cursors: {},
  });
  addBoardToCache(userId, newId);
  try {
    await set(ref(database, `userBoards/${userId}/${newId}`), true);
  } catch {
    // Rules not yet deployed — localStorage cache is the fallback
  }
  return newId;
}
