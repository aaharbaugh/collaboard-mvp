import { useState, useEffect, useRef } from 'react';
import type { PillRef, WireOutputMode } from '../../types/board';

interface PillDropdownProps {
  pill: PillRef;
  position: { x: number; y: number };
  onUpdate: (updated: PillRef) => void;
  onRemove: () => void;
  onClose: () => void;
}

const OUTPUT_MODES: { mode: WireOutputMode; label: string; desc: string }[] = [
  { mode: 'update', label: 'Update', desc: 'Overwrite target' },
  { mode: 'append', label: 'Append', desc: 'Add to list' },
  { mode: 'create', label: 'Create New', desc: 'New sticky below' },
];

export function PillDropdown({
  pill,
  position,
  onUpdate,
  onRemove,
  onClose,
}: PillDropdownProps) {
  const [label, setLabel] = useState(pill.label);
  const [maxChars, setMaxChars] = useState<string>(pill.maxChars ? String(pill.maxChars) : '');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
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

  const currentMode = pill.outputMode ?? 'update';

  return (
    <div
      ref={ref}
      className="pill-dropdown"
      style={{ left: position.x, top: position.y }}
    >
      <div className="pill-dropdown-section">
        <label className="pill-dropdown-label">Name</label>
        <input
          className="pill-dropdown-input"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => {
            if (label.trim() && label !== pill.label) {
              onUpdate({ ...pill, label: label.trim() });
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (label.trim() && label !== pill.label) {
                onUpdate({ ...pill, label: label.trim() });
              }
              onClose();
            }
          }}
        />
      </div>

      <div className="pill-dropdown-section">
        <label className="pill-dropdown-label">Direction</label>
        <div className="pill-dropdown-row">
          <button
            className={`pill-dropdown-dir-btn ${pill.direction === 'in' ? 'active' : ''}`}
            onClick={() => onUpdate({ ...pill, direction: 'in' })}
          >
            Input
          </button>
          <button
            className={`pill-dropdown-dir-btn ${pill.direction === 'out' ? 'active' : ''}`}
            onClick={() => onUpdate({ ...pill, direction: 'out' })}
          >
            Output
          </button>
        </div>
      </div>

      {pill.direction === 'in' && (
        <div className="pill-dropdown-section">
          <label className="pill-dropdown-label">Multi-line</label>
          <div className="pill-dropdown-mode-group">
            <button
              className={`pill-dropdown-mode-btn ${(pill.parseMode ?? 'list') === 'list' ? 'active' : ''}`}
              onClick={() => onUpdate({ ...pill, parseMode: 'list' })}
            >
              <span className="pill-dropdown-mode-label">Each line</span>
              <span className="pill-dropdown-mode-desc">Process per line</span>
            </button>
            <button
              className={`pill-dropdown-mode-btn ${pill.parseMode === 'whole' ? 'active' : ''}`}
              onClick={() => onUpdate({ ...pill, parseMode: 'whole' })}
            >
              <span className="pill-dropdown-mode-label">As whole</span>
              <span className="pill-dropdown-mode-desc">Pass all text together</span>
            </button>
          </div>
        </div>
      )}

      {pill.direction === 'out' && (
        <>
          <div className="pill-dropdown-section">
            <label className="pill-dropdown-label">Output mode</label>
            <div className="pill-dropdown-mode-group">
              {OUTPUT_MODES.map((opt) => (
                <button
                  key={opt.mode}
                  className={`pill-dropdown-mode-btn ${currentMode === opt.mode ? 'active' : ''}`}
                  onClick={() => onUpdate({ ...pill, outputMode: opt.mode })}
                >
                  <span className="pill-dropdown-mode-label">{opt.label}</span>
                  <span className="pill-dropdown-mode-desc">{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="pill-dropdown-section">
            <label className="pill-dropdown-label">Max characters</label>
            <input
              className="pill-dropdown-input"
              type="number"
              min={0}
              placeholder="No limit"
              value={maxChars}
              onChange={(e) => setMaxChars(e.target.value)}
              onBlur={() => {
                const val = parseInt(maxChars, 10);
                const newMax = val > 0 ? val : undefined;
                if (newMax !== pill.maxChars) {
                  onUpdate({ ...pill, maxChars: newMax });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const val = parseInt(maxChars, 10);
                  const newMax = val > 0 ? val : undefined;
                  if (newMax !== pill.maxChars) {
                    onUpdate({ ...pill, maxChars: newMax });
                  }
                  onClose();
                }
              }}
            />
          </div>
        </>
      )}

      <button className="pill-dropdown-remove" onClick={onRemove}>
        Remove pill
      </button>
    </div>
  );
}
