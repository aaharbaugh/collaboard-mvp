import { useRef, useState, useEffect } from 'react';
import { useUserBoards } from '../hooks/useUserBoards';
import { createNewBoard, duplicateBoard, renameBoard, deleteBoard } from '../utils/boardActions';

interface Props {
  userId: string;
  currentBoardId: string;
  onBoardSwitch: (boardId: string) => void;
}

export function UserBoardsPanel({ userId, currentBoardId, onBoardSwitch }: Props) {
  const [open, setOpen] = useState(false);
  const [copiedBoardId, setCopiedBoardId] = useState<string | null>(null);
  const [newBoardStep, setNewBoardStep] = useState<'idle' | 'naming' | 'creating'>('idle');
  const [newBoardName, setNewBoardName] = useState('');
  const [duplicatingBoardId, setDuplicatingBoardId] = useState<string | null>(null);
  const [editingBoardId, setEditingBoardId] = useState<string | null>(null);
  const [editingBoardName, setEditingBoardName] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const { boards, loading, refresh } = useUserBoards(userId);

  const currentBoard = boards.find((b) => b.id === currentBoardId);
  const currentName = currentBoard?.name ?? 'Board';

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
        setNewBoardStep('idle');
        setNewBoardName('');
        setEditingBoardId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (newBoardStep === 'naming') setTimeout(() => nameInputRef.current?.focus(), 0);
  }, [newBoardStep]);

  useEffect(() => {
    if (editingBoardId) setTimeout(() => renameInputRef.current?.select(), 0);
  }, [editingBoardId]);

  const handleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next) void refresh();
  };

  const handleSwitch = (boardId: string) => {
    if (boardId === currentBoardId) { setOpen(false); return; }
    onBoardSwitch(boardId);
    setOpen(false);
  };

  // ── New board ──────────────────────────────────────────────────────────────
  const handleNewBoardCreate = async () => {
    const name = newBoardName.trim() || 'New Board';
    setNewBoardStep('creating');
    try {
      const id = await createNewBoard(userId, name);
      void refresh();
      onBoardSwitch(id);
      setOpen(false);
    } finally {
      setNewBoardStep('idle');
      setNewBoardName('');
    }
  };

  // ── Rename ─────────────────────────────────────────────────────────────────
  const startRename = (boardId: string, currentBoardName: string) => {
    setEditingBoardId(boardId);
    setEditingBoardName(currentBoardName);
  };

  const commitRename = async () => {
    if (!editingBoardId) return;
    const trimmed = editingBoardName.trim();
    if (trimmed) await renameBoard(editingBoardId, trimmed);
    setEditingBoardId(null);
    void refresh();
  };

  const cancelRename = () => setEditingBoardId(null);

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = async (boardId: string, boardName: string) => {
    if (!window.confirm(`Delete "${boardName}"? This cannot be undone.`)) return;
    // If deleting the active board, switch to another first
    if (boardId === currentBoardId) {
      const other = boards.find((b) => b.id !== boardId);
      if (other) onBoardSwitch(other.id);
    }
    await deleteBoard(userId, boardId);
    void refresh();
  };

  // ── Duplicate ──────────────────────────────────────────────────────────────
  const handleDuplicate = async (boardId: string, boardName: string) => {
    if (duplicatingBoardId) return;
    setDuplicatingBoardId(boardId);
    try {
      const id = await duplicateBoard(userId, boardId, boardName);
      void refresh();
      onBoardSwitch(id);
      setOpen(false);
    } finally {
      setDuplicatingBoardId(null);
    }
  };

  // ── Share ──────────────────────────────────────────────────────────────────
  const handleShareBoard = (boardId: string) => {
    const url = `${window.location.origin}${window.location.pathname}?board=${boardId}`;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(url).then(() => {
          setCopiedBoardId(boardId);
          setTimeout(() => setCopiedBoardId(null), 2000);
        }).catch(() => fallbackCopy(url, boardId));
      } else {
        fallbackCopy(url, boardId);
      }
    } catch {
      fallbackCopy(url, boardId);
    }
  };

  const fallbackCopy = (text: string, boardId: string) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    setCopiedBoardId(boardId);
    setTimeout(() => setCopiedBoardId(null), 2000);
  };

  return (
    <div className="user-boards-panel" ref={panelRef}>
      <button className="user-boards-trigger" onClick={handleOpen} title="Board menu">
        <span className="user-boards-name">{currentName}</span>
        <span className="user-boards-chevron">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="user-boards-dropdown">
          <div className="user-boards-section-label">Your Boards</div>

          {loading && boards.length === 0 ? (
            <div className="user-boards-loading">loading...</div>
          ) : boards.length === 0 ? (
            <div className="user-boards-empty">No boards yet</div>
          ) : (
            <ul className="user-boards-list">
              {boards.map((board) => (
                <li key={board.id}>
                  {editingBoardId === board.id ? (
                    <div className="user-boards-item-row">
                      <input
                        ref={renameInputRef}
                        className="user-boards-rename-input"
                        value={editingBoardName}
                        onChange={(e) => setEditingBoardName(e.target.value)}
                        maxLength={60}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void commitRename();
                          if (e.key === 'Escape') cancelRename();
                        }}
                        onBlur={() => void commitRename()}
                      />
                    </div>
                  ) : (
                    <div className={`user-boards-item-row${board.id === currentBoardId ? ' active' : ''}`}>
                      <button
                        className="user-boards-item"
                        onClick={() => handleSwitch(board.id)}
                      >
                        <span className="user-boards-item-check">
                          {board.id === currentBoardId ? '●' : '○'}
                        </span>
                        <span className="user-boards-item-name">{board.name}</span>
                      </button>
                      <div className="user-boards-item-actions">
                        <button
                          className="user-boards-icon-btn"
                          title={copiedBoardId === board.id ? 'Copied!' : 'Share'}
                          onClick={(e) => { e.stopPropagation(); handleShareBoard(board.id); }}
                        >
                          {copiedBoardId === board.id ? '✓' : '⎘'}
                        </button>
                        <button
                          className="user-boards-icon-btn"
                          title="Duplicate"
                          disabled={duplicatingBoardId === board.id}
                          onClick={(e) => { e.stopPropagation(); void handleDuplicate(board.id, board.name); }}
                        >
                          {duplicatingBoardId === board.id ? '…' : '⧉'}
                        </button>
                        <button
                          className="user-boards-icon-btn"
                          title="Rename"
                          onClick={(e) => { e.stopPropagation(); startRename(board.id, board.name); }}
                        >
                          ✎
                        </button>
                        <button
                          className="user-boards-icon-btn danger"
                          title="Delete"
                          onClick={(e) => { e.stopPropagation(); void handleDelete(board.id, board.name); }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="user-boards-divider" />

          <div className="user-boards-actions">
            {newBoardStep === 'idle' && (
              <button className="user-boards-action-btn" onClick={() => setNewBoardStep('naming')}>
                [+] New Board
              </button>
            )}
            {newBoardStep === 'naming' && (
              <div className="user-boards-name-form">
                <input
                  ref={nameInputRef}
                  className="user-boards-name-input"
                  value={newBoardName}
                  onChange={(e) => setNewBoardName(e.target.value)}
                  placeholder="Board name..."
                  maxLength={60}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleNewBoardCreate();
                    if (e.key === 'Escape') { setNewBoardStep('idle'); setNewBoardName(''); }
                  }}
                />
                <div className="user-boards-name-btns">
                  <button className="user-boards-action-btn create" onClick={() => void handleNewBoardCreate()}>Create</button>
                  <button className="user-boards-action-btn" onClick={() => { setNewBoardStep('idle'); setNewBoardName(''); }}>Cancel</button>
                </div>
              </div>
            )}
            {newBoardStep === 'creating' && (
              <button className="user-boards-action-btn" disabled>[ creating... ]</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
