const STORAGE_KEY_PREFIX = 'collaboard_edit_state_';

export interface ViewportSnapshot {
  x: number;
  y: number;
  scale: number;
}

export interface PersistedEditState {
  editingId: string;
  draftText: string;
  viewport?: ViewportSnapshot;
}

export function getPersistedEditState(boardId: string): PersistedEditState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + boardId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedEditState;
    if (typeof parsed.editingId === 'string' && typeof parsed.draftText === 'string') {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

export function setPersistedEditState(
  boardId: string,
  state: PersistedEditState
): void {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + boardId, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function clearPersistedEditState(boardId: string): void {
  try {
    localStorage.removeItem(STORAGE_KEY_PREFIX + boardId);
  } catch {
    // ignore
  }
}
