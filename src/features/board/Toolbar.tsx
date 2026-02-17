import { useEffect } from 'react';
import { useBoardStore, type ToolMode } from '../../lib/store';

const TOOLS: { mode: ToolMode; label: string; hotkey: string }[] = [
  { mode: 'select', label: 'Select', hotkey: '1' },
  { mode: 'move', label: 'Move', hotkey: '2' },
  { mode: 'stickyNote', label: 'Sticky', hotkey: '3' },
  { mode: 'rectangle', label: 'Rect', hotkey: '4' },
  { mode: 'circle', label: 'Circle', hotkey: '5' },
];

export function Toolbar() {
  const { toolMode, setToolMode } = useBoardStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement?.tagName;
      if (active === 'INPUT' || active === 'TEXTAREA') return;

      const tool = TOOLS.find((t) => t.hotkey === e.key);
      if (tool) {
        setToolMode(tool.mode);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setToolMode]);

  return (
    <div className="toolbar">
      {TOOLS.map(({ mode, label, hotkey }) => (
        <button
          key={mode}
          className={`toolbar-btn ${toolMode === mode ? 'active' : ''}`}
          onClick={() => setToolMode(mode)}
        >
          <span className="hotkey">[{hotkey}]</span> {label}
        </button>
      ))}
    </div>
  );
}
