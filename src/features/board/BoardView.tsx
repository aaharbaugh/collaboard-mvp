import { useRef, useState, useEffect } from 'react';
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
import { AgentPanel } from '../agent/AgentPanel';
import {
  getPersistedEditState,
  setPersistedEditState,
  clearPersistedEditState,
} from '../../lib/editStatePersistence';

export function BoardView() {
  const { user, signOut } = useAuth();
  const { boardId, loading: boardLoading, error: boardError } = useBoardId(user?.uid);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAiOpen, setIsAiOpen] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState<string | null>(null);
  const hasRestoredRef = useRef(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const editOverlayContainerRef = useRef<HTMLDivElement>(null);
  const latestDraftRef = useRef<string>('');

  const { objects, updateObject } = useBoardSync(boardId);
  const { cursors } = useCursorSync(
    boardId,
    user?.uid,
    user?.displayName ?? 'Anonymous'
  );
  const { viewport, setViewport, selectedIds, setSelection } = useBoardStore();

  const selectedObject = selectedIds.length === 1 ? objects[selectedIds[0]] : null;

  // Restore edit state from localStorage when board and objects are ready.
  // Do not clear persisted state when object is missing—objects may not have loaded yet.
  useEffect(() => {
    if (!boardId || hasRestoredRef.current) return;
    const persisted = getPersistedEditState(boardId);
    if (!persisted) return;
    const obj = objects[persisted.editingId];
    if (obj && (obj.type === 'stickyNote' || obj.type === 'text')) {
      hasRestoredRef.current = true;
      if (
        persisted.viewport &&
        Number.isFinite(persisted.viewport.x) &&
        Number.isFinite(persisted.viewport.y) &&
        Number.isFinite(persisted.viewport.scale) &&
        persisted.viewport.scale > 0
      ) {
        setViewport(persisted.viewport);
      }
      setEditingId(persisted.editingId);
      setRestoredDraft(persisted.draftText);
      latestDraftRef.current = persisted.draftText;
    }
  }, [boardId, objects, setViewport]);

  // If we're "editing" but the object is missing (deleted or wrong board), clear state
  useEffect(() => {
    if (!boardId || !editingId) return;
    const obj = objects[editingId];
    if (!obj) {
      setEditingId(null);
      setRestoredDraft(null);
      clearPersistedEditState(boardId);
    }
  }, [boardId, editingId, objects]);

  // Clear restored draft after overlay has consumed it (one tick)
  useEffect(() => {
    if (editingId && restoredDraft != null) {
      const t = setTimeout(() => setRestoredDraft(null), 0);
      return () => clearTimeout(t);
    }
  }, [editingId, restoredDraft]);

  const handleStickyNoteDoubleClick = (id: string) => {
    const obj = objects[id];
    if (obj?.type !== 'stickyNote' && obj?.type !== 'text') return;
    if (boardId) clearPersistedEditState(boardId);
    latestDraftRef.current = obj?.text ?? '';
    setEditingId(id);
    setRestoredDraft(null);
  };

  const handleTextSave = (id: string, text: string, headingLevel?: number) => {
    updateObject(id, headingLevel !== undefined ? { text, headingLevel } : { text });
    if (boardId) clearPersistedEditState(boardId);
    setEditingId(null);
    setRestoredDraft(null);
  };

  const handleColorChange = (color: string) => {
    selectedIds.forEach((id) => {
      updateObject(id, { color });
    });
  };

  const clearSelectionOnHotkey = () => {
    const ids = useBoardStore.getState().selectedIds;
    ids.forEach((id) => updateObject(id, { selectedBy: null, selectedByName: null }));
    setSelection([]);
  };

  const handleEditCancel = () => {
    if (boardId) clearPersistedEditState(boardId);
    setEditingId(null);
    setRestoredDraft(null);
  };

  const handleDraftChange = (text: string) => {
    latestDraftRef.current = text;
    if (boardId && editingId) {
      setPersistedEditState(boardId, {
        editingId,
        draftText: text,
        viewport: { x: viewport.x, y: viewport.y, scale: viewport.scale },
      });
    }
  };

  // Click outside the edit overlay (canvas, empty area, etc.) → save and close.
  // Listener on document so we always receive the event (Konva canvas can consume it on the wrapper).
  // Applies to both sticky notes and text fields.
  useEffect(() => {
    if (!editingId) return;
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = (e.target as Node) ?? null;
      const container = editOverlayContainerRef.current;
      if (container && target && container.contains(target)) return;
      const draft = latestDraftRef.current ?? objects[editingId]?.text ?? '';
      updateObject(editingId, { text: draft });
      clearPersistedEditState(boardId ?? '');
      setEditingId(null);
      setRestoredDraft(null);
    };
    document.addEventListener('mousedown', handlePointerDown as (e: MouseEvent) => void, true);
    document.addEventListener('touchstart', handlePointerDown as (e: TouchEvent) => void, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown as (e: MouseEvent) => void, true);
      document.removeEventListener('touchstart', handlePointerDown as (e: TouchEvent) => void, true);
    };
  }, [editingId, boardId, objects, updateObject]);

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
          <span className="board-object-count" title="Objects on board">
            {Object.keys(objects).length} object{Object.keys(objects).length === 1 ? '' : 's'}
          </span>
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
          <div ref={editOverlayContainerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <TextEditingOverlay
              obj={editingId ? objects[editingId] ?? null : null}
              viewport={viewport}
              initialDraft={editingId && restoredDraft != null ? restoredDraft : undefined}
              onSave={handleTextSave}
              onCancel={handleEditCancel}
              onDraftChange={handleDraftChange}
              latestDraftRef={latestDraftRef}
            />
          </div>
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
          <Toolbar
            onHotkeyPress={clearSelectionOnHotkey}
            onAiToggle={() => setIsAiOpen((v) => !v)}
            isAiOpen={isAiOpen}
          />
        </div>
      </div>
      <AgentPanel
            boardId={boardId}
            isOpen={isAiOpen}
            onClose={() => setIsAiOpen(false)}
            selectedIds={selectedIds}
            viewport={viewport}
          />
    </div>
  );
}
