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

  const screenX = obj.x * viewport.scale + viewport.x;
  const screenY = obj.y * viewport.scale + viewport.y;
  const screenW = obj.width * viewport.scale;
  const screenH = obj.height * viewport.scale;

  const { fontSize: worldFontSize, padding: worldPadding } = computeAutoFitFontSize(
    text, obj.width, obj.height
  );
  const screenFontSize = worldFontSize * viewport.scale;
  const screenPadding = worldPadding * viewport.scale;

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
          width: screenW - screenPadding * 2,
          height: screenH - screenPadding * 2,
          fontSize: screenFontSize,
          lineHeight: 1.3,
          pointerEvents: 'auto',
        }}
      />
    </div>
  );
}
