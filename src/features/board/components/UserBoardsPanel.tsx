import { useRef, useState, useEffect } from 'react';
import { useUserBoards } from '../hooks/useUserBoards';
import { createNewBoard, duplicateBoard } from '../utils/boardActions';

interface Props {
  userId: string;
  currentBoardId: string;
  onBoardSwitch: (boardId: string) => void;
}

export function UserBoardsPanel({ userId, currentBoardId, onBoardSwitch }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [newBoardStep, setNewBoardStep] = useState<'idle' | 'naming' | 'creating'>('idle');
  const [newBoardName, setNewBoardName] = useState('');
  const [duplicating, setDuplicating] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
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
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus name input when it appears
  useEffect(() => {
    if (newBoardStep === 'naming') {
      setTimeout(() => nameInputRef.current?.focus(), 0);
    }
  }, [newBoardStep]);

  const handleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next) void refresh();
  };

  const handleNewBoardClick = () => {
    setNewBoardStep('naming');
    setNewBoardName('');
  };

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

  const handleNewBoardCancel = () => {
    setNewBoardStep('idle');
    setNewBoardName('');
  };

  const handleDuplicate = async () => {
    if (duplicating) return;
    setDuplicating(true);
    try {
      const id = await duplicateBoard(userId, currentBoardId, currentName);
      void refresh();
      onBoardSwitch(id);
      setOpen(false);
    } finally {
      setDuplicating(false);
    }
  };

  const handleShareBoard = () => {
    const url = `${window.location.origin}${window.location.pathname}?board=${currentBoardId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSwitch = (boardId: string) => {
    if (boardId === currentBoardId) {
      setOpen(false);
      return;
    }
    onBoardSwitch(boardId);
    setOpen(false);
  };

  return (
    <div className="user-boards-panel" ref={panelRef}>
      <button
        className="user-boards-trigger"
        onClick={handleOpen}
        title="Board menu"
      >
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
                  <button
                    className={`user-boards-item${board.id === currentBoardId ? ' active' : ''}`}
                    onClick={() => handleSwitch(board.id)}
                  >
                    <span className="user-boards-item-check">
                      {board.id === currentBoardId ? '●' : '○'}
                    </span>
                    <span className="user-boards-item-name">{board.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="user-boards-divider" />

          <div className="user-boards-actions">
            {newBoardStep === 'idle' && (
              <button className="user-boards-action-btn" onClick={handleNewBoardClick}>
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
                    if (e.key === 'Escape') handleNewBoardCancel();
                  }}
                />
                <div className="user-boards-name-btns">
                  <button className="user-boards-action-btn create" onClick={() => void handleNewBoardCreate()}>
                    Create
                  </button>
                  <button className="user-boards-action-btn" onClick={handleNewBoardCancel}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {newBoardStep === 'creating' && (
              <button className="user-boards-action-btn" disabled>
                [ creating... ]
              </button>
            )}

            <button
              className="user-boards-action-btn"
              onClick={() => void handleDuplicate()}
              disabled={duplicating}
            >
              {duplicating ? '[ duplicating... ]' : '[⧉] Duplicate Board'}
            </button>
            <button
              className="user-boards-action-btn share"
              onClick={handleShareBoard}
            >
              {copied ? '[ copied! ]' : '[⎘] Share Board'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
