import { useState, useEffect, useRef } from 'react';
import { useAgentCommand, getStatusMessage } from './useAgentCommand';
import { useBoardSync } from '../sync/useBoardSync';

interface AgentPanelProps {
  boardId: string;
  isOpen: boolean;
  onClose: () => void;
  selectedIds?: string[];
  viewport?: { x: number; y: number; scale: number; width?: number; height?: number };
}

const EXAMPLE_COMMANDS = [
  'Create a SWOT analysis with four quadrants',
  'Draw a flowchart: Start → Process → Decision → End',
  'Create a mind map with a central idea and 4 branches',
  'Connect all rectangles in sequence with arrows',
];

export function AgentPanel({ boardId, isOpen, onClose, selectedIds, viewport }: AgentPanelProps) {
  // ALL hooks must run unconditionally before any early return
  const [command, setCommand] = useState('');
  const [undoing, setUndoing] = useState(false);
  const { runCommand, loading, error, agentStatus, history, clearHistory, lastUndoInfo } = useAgentCommand(boardId);
  const { deleteObject, deleteConnection } = useBoardSync(boardId);
  const inputRef    = useRef<HTMLInputElement>(null);
  const popupRef    = useRef<HTMLDivElement>(null);
  const historyRef  = useRef<HTMLDivElement>(null);

  // Focus the input when the panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  // Auto-scroll history to bottom whenever it updates or panel opens
  useEffect(() => {
    if (isOpen && historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
    }
  }, [history, loading, isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // Auto-hide when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const toolbarArea = popupRef.current?.closest('.toolbar-area');
      if (toolbarArea?.contains(target)) return;
      if (!popupRef.current?.contains(target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, onClose]);

  const handleUndoLastCommand = async () => {
    if (!lastUndoInfo) return;
    setUndoing(true);
    lastUndoInfo.createdConnectionIds.forEach((id) => deleteConnection(id));
    lastUndoInfo.createdObjectIds.forEach((id) => deleteObject(id));
    setUndoing(false);
  };

  // Panel is always mounted (so history is preserved), but hidden when closed
  if (!isOpen) return null;

  const hasHistory = history.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim() || loading) return;
    const cmd = command;
    setCommand('');
    try {
      await runCommand(cmd, { selectedIds, viewport });
    } catch {
      // error shown via hook state
    }
  };

  const statusMessage = getStatusMessage(agentStatus);

  return (
    <div
      ref={popupRef}
      className="agent-popup"
      role="dialog"
      aria-modal="true"
      aria-label="Ask AI"
    >
      <div className="agent-header">
        <span className="agent-header-label">Ask AI</span>
        <div className="agent-header-actions">
          {hasHistory && (
            <button
              type="button"
              className="agent-new-chat-btn"
              onClick={() => { clearHistory(); setCommand(''); }}
              disabled={loading}
              aria-label="New chat"
            >
              new chat
            </button>
          )}
          <button
            type="button"
            className="agent-close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Chat history */}
      {hasHistory && (
        <div className="agent-history" ref={historyRef}>
          {history.map((entry, i) => (
            <div key={i} className="agent-message-group">
              <div className={`agent-message agent-message--${entry.role}`}>
                {entry.text}
              </div>
              {entry.options && entry.options.length > 0 && (
                <div className="agent-message-options">
                  {entry.options.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      className="agent-option-btn"
                      disabled={loading}
                      onClick={() => runCommand(opt, { selectedIds, viewport })}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}
              {entry.role === 'agent' && i === history.length - 1 && lastUndoInfo && !loading && (
                <button
                  type="button"
                  className="agent-undo-btn"
                  onClick={handleUndoLastCommand}
                  disabled={undoing}
                  title="Remove everything created by this command"
                >
                  {undoing ? 'Undoing...' : '↩ Undo last command'}
                </button>
              )}
            </div>
          ))}
          {loading && (
            <div className="agent-message agent-message--agent agent-message--thinking">
              <span className="agent-spinner" />
              <span>{statusMessage}</span>
            </div>
          )}
        </div>
      )}

      {/* Status bar when there's no history yet */}
      {loading && !hasHistory && (
        <div className="agent-status-bar">
          <span className="agent-spinner" />
          <span className="agent-status-text">{statusMessage}</span>
        </div>
      )}

      {error && (
        <div className="agent-error" role="alert">
          {error}
        </div>
      )}

      <form className="agent-form" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          className="agent-input"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder={hasHistory ? 'Follow up...' : 'Describe what to create or change...'}
          disabled={loading}
          aria-label="AI command"
        />
        <button
          type="submit"
          className="agent-send-btn"
          disabled={loading || !command.trim()}
        >
          {loading ? '...' : 'Ask'}
        </button>
      </form>

      {/* Examples — only shown before any conversation starts */}
      {!hasHistory && (
        <div>
          <div className="agent-examples-label">Examples</div>
          <div className="agent-examples">
            {EXAMPLE_COMMANDS.map((cmd) => (
              <button
                key={cmd}
                type="button"
                className="agent-example-btn"
                disabled={loading}
                onClick={() => { if (!loading) setCommand(cmd); }}
              >
                {cmd}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
