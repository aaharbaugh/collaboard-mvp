import { useState, useEffect, useRef } from 'react';
import { useAgentCommand, getStatusMessage } from './useAgentCommand';

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
  const [command, setCommand] = useState('');
  const { runCommand, loading, error, agentStatus } = useAgentCommand(boardId);

  if (!isOpen) return null;
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // Focus the input when the panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Auto-hide when clicking outside — but ignore clicks within the toolbar-area
  // so the [6] toggle button can manage its own open/close state.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const toolbarArea = popupRef.current?.closest('.toolbar-area');
      if (toolbarArea?.contains(target)) return;
      if (!popupRef.current?.contains(target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim() || loading) return;
    try {
      await runCommand(command, { selectedIds, viewport });
      setCommand('');
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
        <button
          type="button"
          className="agent-close-btn"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <form className="agent-form" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          className="agent-input"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="Describe what to create or change..."
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

      {loading && (
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
    </div>
  );
}
