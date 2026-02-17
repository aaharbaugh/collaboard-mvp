import { useState, useEffect, useRef, useCallback } from 'react';
import type { BoardObject } from '../types/board';
import { computeAutoFitFontSize } from '../lib/textParser';

interface TextEditingOverlayProps {
  obj: BoardObject | null;
  viewport: { x: number; y: number; scale: number };
  onSave: (id: string, text: string) => void;
  onCancel: () => void;
}

export function TextEditingOverlay({
  obj,
  viewport,
  onSave,
  onCancel,
}: TextEditingOverlayProps) {
  const [text, setText] = useState(obj?.text ?? '');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const openedIdRef = useRef<string | null>(null);

  // Only sync from server when we first open this note (or switch to another). Don't overwrite
  // local text when obj reference changes due to other Firebase updates (e.g. another user moving something).
  useEffect(() => {
    if (!obj) {
      openedIdRef.current = null;
      return;
    }
    if (openedIdRef.current !== obj.id) {
      openedIdRef.current = obj.id;
      setText(obj.text ?? '');
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [obj]);

  // Close edit only when visible note has no drawable area (infinite zoom: no scale-based minimum)
  useEffect(() => {
    if (!obj || obj.type !== 'stickyNote') return;
    const scale = Number.isFinite(viewport.scale) && viewport.scale > 0 ? viewport.scale : 1;
    const sw = obj.width * scale;
    const sh = obj.height * scale;
    if (!Number.isFinite(sw) || !Number.isFinite(sh) || sw < 1 || sh < 1) onCancel();
  }, [obj, viewport.scale, viewport.x, viewport.y, onCancel]);

  const wrapSelection = useCallback((before: string, after: string) => {
    const ta = inputRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = text.slice(start, end);
    const newText = text.slice(0, start) + before + selected + after + text.slice(end);
    setText(newText);
    setTimeout(() => {
      ta.focus();
      ta.selectionStart = start + before.length;
      ta.selectionEnd = end + before.length;
    }, 0);
  }, [text]);

  const prefixLine = useCallback((prefix: string) => {
    const ta = inputRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
    const newText = text.slice(0, lineStart) + prefix + text.slice(lineStart);
    setText(newText);
    setTimeout(() => {
      ta.focus();
      ta.selectionStart = pos + prefix.length;
      ta.selectionEnd = pos + prefix.length;
    }, 0);
  }, [text]);

  if (!obj || obj.type !== 'stickyNote') return null;

  const scale = Number.isFinite(viewport.scale) && viewport.scale > 0 ? viewport.scale : 1;
  const screenX = obj.x * scale + viewport.x;
  const screenY = obj.y * scale + viewport.y;
  const screenW = obj.width * scale;
  const screenH = obj.height * scale;

  const minScreenDim = Math.min(screenW, screenH);
  const { fontSize: rawFontSize, padding: rawPadding } = computeAutoFitFontSize(
    text,
    Math.max(1, screenW),
    Math.max(1, screenH)
  );
  const screenFontSize = Number.isFinite(rawFontSize) && rawFontSize > 0 ? rawFontSize : minScreenDim * 0.1;
  const screenPadding = Number.isFinite(rawPadding) && rawPadding >= 0 ? rawPadding : minScreenDim * 0.06;

  if (!Number.isFinite(screenW) || !Number.isFinite(screenH) || screenW < 1 || screenH < 1) {
    return null;
  }

  const handleBlur = () => {
    onSave(obj.id, text);
    onCancel();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setText(obj.text ?? '');
      onCancel();
    }
  };

  const toolbarHeight = 28;

  return (
    <div
      className="text-editing-overlay"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        pointerEvents: 'none',
        zIndex: 5,
      }}
    >
      <div
        className="text-edit-toolbar"
        style={{
          position: 'absolute',
          left: screenX,
          top: screenY - toolbarHeight - 4,
          pointerEvents: 'auto',
        }}
        onMouseDown={(e) => e.preventDefault()}
      >
        <button
          className="text-edit-btn"
          onClick={() => wrapSelection('**', '**')}
          title="Bold"
        >
          B
        </button>
        <button
          className="text-edit-btn"
          style={{ fontStyle: 'italic' }}
          onClick={() => wrapSelection('*', '*')}
          title="Italic"
        >
          I
        </button>
        <button
          className="text-edit-btn"
          onClick={() => prefixLine('- ')}
          title="List"
        >
          List
        </button>
      </div>
      <textarea
        ref={inputRef}
        className="text-editing-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        style={{
          position: 'absolute',
          left: screenX + screenPadding,
          top: screenY + screenPadding,
          width: Math.max(1, screenW - screenPadding * 2),
          height: Math.max(1, screenH - screenPadding * 2),
          boxSizing: 'border-box',
          padding: 0,
          margin: 0,
          border: '1px solid rgba(74,124,89,0.5)',
          borderRadius: Math.max(0, Math.min(8, minScreenDim * 0.02)),
          fontFamily: '"Courier New", Courier, monospace',
          fontSize: screenFontSize,
          lineHeight: 1.3,
          resize: 'none',
          overflow: 'auto',
          pointerEvents: 'auto',
        }}
      />
    </div>
  );
}
