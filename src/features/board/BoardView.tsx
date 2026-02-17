import { useRef, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { useBoardId } from './hooks/useBoardId';
import { BoardCanvas } from './BoardCanvas';
import { Toolbar } from './Toolbar';
import { CursorOverlay } from '../../components/CursorOverlay';
import { PresenceList } from '../../components/PresenceList';
import { useBoardStore } from '../../lib/store';
import { useCursorSync } from '../sync/useCursorSync';
import { useBoardSync } from '../sync/useBoardSync';
import { TextEditingOverlay } from '../../components/TextEditingOverlay';
import { ColorPicker } from './components/ColorPicker';

export function BoardView() {
  const { user, signOut } = useAuth();
  const { boardId, loading: boardLoading, error: boardError } = useBoardId(user?.uid);
  const [editingId, setEditingId] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const { objects, updateObject } = useBoardSync(boardId);
  const { cursors } = useCursorSync(
    boardId,
    user?.uid,
    user?.displayName ?? 'Anonymous'
  );
  const { viewport, selectedIds } = useBoardStore();

  const selectedObject = selectedIds.length === 1 ? objects[selectedIds[0]] : null;

  const handleStickyNoteDoubleClick = (id: string) => {
    const obj = objects[id];
    if (obj?.type !== 'stickyNote' && obj?.type !== 'text') return;
    setEditingId(id);
  };

  const handleTextSave = (id: string, text: string, headingLevel?: number) => {
    updateObject(id, headingLevel !== undefined ? { text, headingLevel } : { text });
    setEditingId(null);
  };

  const handleColorChange = (color: string) => {
    selectedIds.forEach((id) => {
      updateObject(id, { color });
    });
  };

  if (!user) {
    return null;
  }

  if (boardError && !boardLoading) {
    return (
      <div className="board-loading">
        <p className="board-error-message">Could not load board</p>
        <p className="board-error-detail">{boardError}</p>
        <button
          type="button"
          className="btn-primary"
          onClick={() => window.location.reload()}
        >
          Retry
        </button>
      </div>
    );
  }

  if (boardLoading || !boardId) {
    return (
      <div className="board-loading">
        <div className="auth-loading-spinner" />
        <p>Loading board...</p>
      </div>
    );
  }

  return (
    <div className="board-layout">
      <header className="board-header">
        <div className="board-header-left">
          <h1 className="board-title">CollabBoard</h1>
        </div>
        <div className="board-header-right">
          <PresenceList cursors={cursors} />
          <div className="user-menu">
            <span className="user-name">{user.displayName ?? 'User'}</span>
            <button className="btn-sign-out" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <div className="board-main">
        <div className="board-canvas-wrapper" ref={wrapperRef}>
          <BoardCanvas
            boardId={boardId}
            userId={user.uid}
            userName={user.displayName ?? 'Anonymous'}
            onStickyNoteDoubleClick={handleStickyNoteDoubleClick}
          />
          <TextEditingOverlay
            obj={editingId ? objects[editingId] ?? null : null}
            viewport={viewport}
            onSave={handleTextSave}
            onCancel={() => setEditingId(null)}
          />
          <CursorOverlay
            cursors={cursors}
            viewport={viewport}
            excludeUserId={user.uid}
          />
          {selectedIds.length > 0 && (
            <div className="selection-tools">
              <ColorPicker
                currentColor={selectedObject?.color}
                onColorChange={handleColorChange}
              />
              <div className="object-order-buttons">
                <button
                  type="button"
                  className="toolbar-btn"
                  title="Send behind arrows"
                  onClick={() => selectedIds.forEach((id) => updateObject(id, { sentToBack: true }))}
                >
                  Send to back
                </button>
                <button
                  type="button"
                  className="toolbar-btn"
                  title="Bring in front of arrows"
                  onClick={() => selectedIds.forEach((id) => updateObject(id, { sentToBack: false }))}
                >
                  Bring to front
                </button>
              </div>
            </div>
          )}
          <Toolbar />
        </div>
      </div>
    </div>
  );
}
