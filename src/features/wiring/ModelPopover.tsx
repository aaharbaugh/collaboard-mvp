import { useEffect, useLayoutEffect, useRef, useState } from 'react';

interface ModelPopoverProps {
  position: { x: number; y: number };
  onClose: () => void;
}

const MODELS = [
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'OpenAI', selected: true },
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'OpenAI' },
  { id: 'gpt-4.1', label: 'GPT-4.1', provider: 'OpenAI' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', provider: 'OpenAI' },
  { id: 'claude-sonnet', label: 'Claude Sonnet', provider: 'Anthropic' },
  { id: 'claude-haiku', label: 'Claude Haiku', provider: 'Anthropic' },
  { id: 'gemini-flash', label: 'Gemini Flash', provider: 'Google' },
  { id: 'llama-3', label: 'Llama 3', provider: 'Meta' },
];

export function ModelPopover({ position, onClose }: ModelPopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [adjustedTop, setAdjustedTop] = useState(position.y);

  useLayoutEffect(() => {
    if (containerRef.current) {
      const h = containerRef.current.offsetHeight;
      setAdjustedTop(position.y - h - 6);
    }
  }, [position.y]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick, true);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick, true);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      className="model-popover"
      style={{ left: position.x, top: adjustedTop }}
    >
      <div className="model-popover-header">Model</div>
      <div className="model-popover-list">
        {MODELS.map((model) => (
          <button
            key={model.id}
            className={`model-popover-item disabled${model.selected ? ' model-popover-item--selected' : ''}`}
            disabled
          >
            <span className="model-popover-item-label">{model.label}</span>
            <span className="model-popover-item-provider">{model.provider}</span>
            {model.selected && <span className="model-popover-item-check">{'\u2713'}</span>}
          </button>
        ))}
      </div>
      <div className="model-popover-footer">Coming soon</div>
    </div>
  );
}
