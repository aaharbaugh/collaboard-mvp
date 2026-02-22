import { useEffect, useLayoutEffect, useRef, useState } from 'react';

interface TimerPopoverProps {
  position: { x: number; y: number };
  onClose: () => void;
}

const INTERVALS = [
  { label: '1 min', minutes: 1 },
  { label: '5 min', minutes: 5 },
  { label: '15 min', minutes: 15 },
  { label: '30 min', minutes: 30 },
  { label: '1 hour', minutes: 60 },
];

export function TimerPopover({ position, onClose }: TimerPopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [adjustedTop, setAdjustedTop] = useState(position.y);

  // Measure height after first paint and position above the button
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
      className="timer-popover"
      style={{ left: position.x, top: adjustedTop }}
    >
      <div className="timer-popover-header">Auto-run interval</div>
      <div className="timer-popover-list">
        {INTERVALS.map((opt) => (
          <button
            key={opt.minutes}
            className="timer-popover-item disabled"
            disabled
          >
            <span className="timer-popover-item-icon">{'\u23F1'}</span>
            <span className="timer-popover-item-label">{opt.label}</span>
          </button>
        ))}
        <button className="timer-popover-item disabled" disabled>
          <span className="timer-popover-item-icon">{'\u2716'}</span>
          <span className="timer-popover-item-label">Off</span>
        </button>
      </div>
      <div className="timer-popover-footer">Coming soon</div>
    </div>
  );
}
