import { useEffect } from 'react';
import { useBoardStore, type ToolMode, SHAPE_CYCLE, POINTER_CYCLE } from '../../lib/store';

const TOOLS: { mode: ToolMode; label: string; hotkey: string }[] = [
  { mode: 'stickyNote', label: 'Sticky note', hotkey: '2' },
  { mode: 'text', label: 'Text', hotkey: '4' },
  { mode: 'frame', label: 'Frame', hotkey: '5' },
];

const SHAPE_LABELS: Record<string, string> = { star: 'Star', circle: 'Circle', rectangle: 'Rect' };
const POINTER_LABELS: Record<string, string> = { select: 'Select', move: 'Move' };

const SHAPE_PREVIEW_SIZE = 20;
const SHAPE_STROKE = 1.25;

/** 5-point star matching board Star (innerRadius = 0.4 * outerRadius), viewBox 0 0 24 24, center 12,12 */
const STAR_PATH = 'M12 2 L14.35 8.76 L21.5 8.91 L15.8 13.24 L17.88 20.09 L12 16 L6.12 20.09 L8.2 13.24 L2.5 8.91 L9.65 8.76 Z';

function ShapePreviewIcons({ activeShape }: { activeShape: ToolMode }) {
  const green = 'var(--accent-green)';
  const stroke = 'var(--text-primary)';
  const isStar = activeShape === 'star';
  const isCircle = activeShape === 'circle';
  const isRect = activeShape === 'rectangle';

  return (
    <div className="toolbar-shape-preview" aria-hidden>
      <svg width={SHAPE_PREVIEW_SIZE} height={SHAPE_PREVIEW_SIZE} viewBox="0 0 24 24" fill="none" stroke={isStar ? green : stroke} strokeWidth={SHAPE_STROKE}>
        {isStar ? <path fill={green} stroke={green} d={STAR_PATH} /> : <path d={STAR_PATH} />}
      </svg>
      <svg width={SHAPE_PREVIEW_SIZE} height={SHAPE_PREVIEW_SIZE} viewBox="0 0 24 24" fill="none" stroke={isCircle ? green : stroke} strokeWidth={SHAPE_STROKE}>
        {isCircle ? <circle cx="12" cy="12" r="9" fill={green} stroke={green} /> : <circle cx="12" cy="12" r="9" />}
      </svg>
      <svg width={SHAPE_PREVIEW_SIZE} height={SHAPE_PREVIEW_SIZE} viewBox="0 0 24 24" fill="none" stroke={isRect ? green : stroke} strokeWidth={SHAPE_STROKE}>
        {isRect ? <rect x="4" y="5" width="16" height="14" fill={green} stroke={green} /> : <rect x="4" y="5" width="16" height="14" />}
      </svg>
    </div>
  );
}

export interface ToolbarProps {
  /** Called when a hotkey (1–5) is pressed; use to clear selection and hide color bar */
  onHotkeyPress?: () => void;
}

export function Toolbar({ onHotkeyPress }: ToolbarProps) {
  const { toolMode, setToolMode, cycleShapeTool, cyclePointerTool } = useBoardStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement?.tagName;
      if (active === 'INPUT' || active === 'TEXTAREA') return;
      if (e.repeat) return;

      let digit: string | null = null;
      if (e.key >= '1' && e.key <= '5') digit = e.key;
      else if (e.code?.startsWith('Digit') && e.code.length === 6) {
        const n = e.code.slice(5);
        if (n >= '1' && n <= '5') digit = n;
      } else if (e.code?.startsWith('Numpad') && e.code.length === 7) {
        const n = e.code.slice(6);
        if (n >= '1' && n <= '5') digit = n;
      }

      if (digit) {
        e.preventDefault();
        onHotkeyPress?.();
        if (digit === '1') {
          cyclePointerTool();
          return;
        }
        if (digit === '3') {
          cycleShapeTool();
          return;
        }
        const tool = TOOLS.find((t) => t.hotkey === digit);
        if (tool) setToolMode(tool.mode);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setToolMode, cycleShapeTool, cyclePointerTool, onHotkeyPress]);

  const pointerLabel = POINTER_CYCLE.includes(toolMode) ? POINTER_LABELS[toolMode] : POINTER_LABELS[POINTER_CYCLE[0]];
  const isPointerActive = POINTER_CYCLE.includes(toolMode);

  const shapeLabel = SHAPE_CYCLE.includes(toolMode) ? SHAPE_LABELS[toolMode] : SHAPE_LABELS[SHAPE_CYCLE[0]];
  const isShapeActive = SHAPE_CYCLE.includes(toolMode);
  const currentShape = isShapeActive ? toolMode : SHAPE_CYCLE[0];

  return (
    <div className="toolbar">
      <button
        key="pointer"
        className={`toolbar-btn ${isPointerActive ? 'active' : ''}`}
        onClick={() => cyclePointerTool()}
      >
        <span className="hotkey">[1]</span> {pointerLabel}
      </button>
      {TOOLS.slice(0, 1).map(({ mode, label, hotkey }) => (
        <button
          key={mode}
          className={`toolbar-btn ${toolMode === mode ? 'active' : ''}`}
          onClick={() => setToolMode(mode)}
        >
          <span className="hotkey">[{hotkey}]</span> {label}
        </button>
      ))}
      <div className="toolbar-shape-group">
        {isShapeActive && <ShapePreviewIcons activeShape={currentShape} />}
        <button
          key="shape"
          className={`toolbar-btn ${isShapeActive ? 'active' : ''}`}
          onClick={() => cycleShapeTool()}
        >
          <span className="hotkey">[3]</span> {shapeLabel}
        </button>
      </div>
      {TOOLS.slice(1).map(({ mode, label, hotkey }) => (
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
