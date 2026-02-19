import { useState, useEffect, useRef } from 'react';
import { useAgentCommand } from './useAgentCommand';

interface AgentPanelProps {
  boardId: string;
  isOpen: boolean;
  onClose: () => void;
}

const EXAMPLE_COMMANDS = [
  'Create a SWOT analysis with four quadrants',
  'Draw a flowchart: Start → Process → Decision → End',
  'Create a mind map with a central idea and 4 branches',
  'Connect all rectangles in sequence with arrows',
];

export function AgentPanel({ boardId, isOpen, onClose }: AgentPanelProps) {
  const [command, setCommand] = useState('');
  const { runCommand, loading, error } = useAgentCommand(boardId);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input when the panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim() || loading) return;
    try {
      await runCommand(command);
      setCommand('');
    } catch {
      // error shown via hook state
    }
  };

  return (
    <>
      <div
        className="agent-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="agent-popup"
        role="dialog"
        aria-modal="true"
        aria-label="Ask AI"
      >
        <div className="agent-popup-header">
          <span className="agent-popup-title">Ask AI</span>
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
            {loading ? 'Working...' : 'Ask'}
          </button>
        </form>

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
    </>
  );
}
