import { useState, useEffect } from 'react';
import { ref, set, get, update } from 'firebase/database';
import { database } from '../../../lib/firebase';
import { addBoardToCache } from '../utils/boardCache';

const SHARED_DEMO_BOARD_ID = 'demo';

function getUrlBoardId(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('board');
}

/** Best-effort: index the board under userBoards. Never throws. */
async function tryIndexBoard(userId: string, boardId: string): Promise<void> {
  try {
    await set(ref(database, `userBoards/${userId}/${boardId}`), true);
  } catch {
    // Rules not deployed yet — board listing won't work until rules are updated
  }
}

export function useBoardId(userId: string | undefined) {
  const [boardId, setBoardId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const createPersonalBoard = async (): Promise<string> => {
      const newId = crypto.randomUUID();
      await set(ref(database, `boards/${newId}`), {
        metadata: {
          owner: userId,
          name: 'My Board',
          createdAt: Date.now(),
        },
        collaborators: { [userId]: true },
        objects: {},
        cursors: {},
      });
      addBoardToCache(userId, newId);
      await tryIndexBoard(userId, newId);
      return newId;
    };

    const initBoard = async () => {
      setError(null);
      try {
        // If a board ID is specified in the URL, try to join that board
        const urlBoardId = getUrlBoardId();
        if (urlBoardId) {
          const urlBoardRef = ref(database, `boards/${urlBoardId}`);
          const urlSnapshot = await get(urlBoardRef);
          if (urlSnapshot.exists()) {
            const collaborators = urlSnapshot.child('collaborators').val() || {};
            if (!collaborators[userId]) {
              await update(ref(database, `boards/${urlBoardId}`), {
                [`collaborators/${userId}`]: true,
              });
            }
            addBoardToCache(userId, urlBoardId);
            await tryIndexBoard(userId, urlBoardId);
            if (!cancelled) {
              setBoardId(urlBoardId);
              setLoading(false);
            }
            return;
          }
        }

        const boardRef = ref(database, `boards/${SHARED_DEMO_BOARD_ID}`);

        const timeoutMs = 10000;
        const snapshot = await Promise.race([
          get(boardRef),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    'Connection timed out. Check Firebase Realtime Database URL and that the database is enabled.'
                  )
                ),
              timeoutMs
            )
          ),
        ]);

        if (cancelled) return;

        if (!snapshot.exists()) {
          await set(boardRef, {
            metadata: {
              owner: userId,
              name: 'Shared Demo Board',
              createdAt: Date.now(),
            },
            collaborators: { [userId]: true },
            objects: {},
            cursors: {},
          });
        } else {
          const collaborators = snapshot.child('collaborators').val() || {};
          if (!collaborators[userId]) {
            await update(ref(database, `boards/${SHARED_DEMO_BOARD_ID}`), {
              [`collaborators/${userId}`]: true,
            });
          }
        }

        addBoardToCache(userId, SHARED_DEMO_BOARD_ID);
        await tryIndexBoard(userId, SHARED_DEMO_BOARD_ID);

        if (!cancelled) {
          setBoardId(SHARED_DEMO_BOARD_ID);
        }
      } catch (err) {
        const isPermissionDenied =
          (err &&
            typeof err === 'object' &&
            'code' in err &&
            (err as { code?: string }).code === 'PERMISSION_DENIED') ||
          (err instanceof Error &&
            (err.message.includes('Permission denied') ||
              err.message.includes('permission_denied')));

        if (isPermissionDenied && !cancelled) {
          try {
            const personalId = await createPersonalBoard();
            if (!cancelled) {
              setBoardId(personalId);
            }
          } catch (fallbackErr) {
            if (!cancelled) {
              console.error('Fallback board creation failed:', fallbackErr);
              setError(
                err instanceof Error ? err.message : 'Failed to load board'
              );
            }
          }
        } else if (!cancelled) {
          console.error('Board init failed:', err);
          setError(err instanceof Error ? err.message : 'Failed to load board');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    initBoard();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return { boardId, loading, error };
}
