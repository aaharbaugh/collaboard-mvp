import { useEffect, useRef } from 'react';
import type { WireOutputMode } from '../../types/board';

interface WireModePopoverProps {
  currentMode: WireOutputMode;
  position: { x: number; y: number };
  onChange: (mode: WireOutputMode) => void;
  onClose: () => void;
}

const OPTIONS: { mode: WireOutputMode; label: string; desc: string }[] = [
  { mode: 'update', label: 'Update', desc: 'Overwrite target' },
  { mode: 'append', label: 'Append', desc: 'Add to list' },
  { mode: 'create', label: 'Create New', desc: 'New sticky below' },
];

export function WireModePopover({
  currentMode,
  position,
  onChange,
  onClose,
}: WireModePopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null);

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
      className="wire-mode-popover"
      style={{ left: position.x, top: position.y }}
    >
      {OPTIONS.map((opt) => (
        <button
          key={opt.mode}
          className={`wire-mode-btn ${currentMode === opt.mode ? 'active' : ''}`}
          onClick={() => {
            onChange(opt.mode);
          }}
        >
          <span className="wire-mode-btn-label">{opt.label}</span>
          <span className="wire-mode-btn-desc">{opt.desc}</span>
        </button>
      ))}
    </div>
  );
}
