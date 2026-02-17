import { useState, useEffect, useRef, useCallback } from 'react';
import type { BoardObject } from '../types/board';
import { computeAutoFitFontSize, getWrappedLines, LINE_HEIGHT_RATIO } from '../lib/textParser';

interface TextEditingOverlayProps {
  obj: BoardObject | null;
  viewport: { x: number; y: number; scale: number };
  onSave: (id: string, text: string, headingLevel?: number) => void;
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
  const toolbarRef = useRef<HTMLDivElement>(null);
  const openedIdRef = useRef<string | null>(null);

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

  // Close edit only when visible note/text has no drawable area (infinite zoom: no scale-based minimum)
  useEffect(() => {
    if (!obj || (obj.type !== 'stickyNote' && obj.type !== 'text')) return;
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

  if (!obj || (obj.type !== 'stickyNote' && obj.type !== 'text')) return null;

  const scale = Number.isFinite(viewport.scale) && viewport.scale > 0 ? viewport.scale : 1;
  const screenX = obj.x * scale + viewport.x;
  const screenY = obj.y * scale + viewport.y;
  const screenW = obj.width * scale;
  const screenH = obj.height * scale;

  const minScreenDim = Math.min(screenW, screenH);
  const { fontSize: rawFontSize, padding: rawPadding } = computeAutoFitFontSize(
    text,
    Math.max(1, screenW),
    Math.max(1, screenH),
  );
  let screenFontSize = Number.isFinite(rawFontSize) && rawFontSize > 0 ? rawFontSize : minScreenDim * 0.1;
  const screenPadding = Number.isFinite(rawPadding) && rawPadding >= 0 ? rawPadding : minScreenDim * 0.06;
  const availW = Math.max(1, screenW - screenPadding * 2);
  const availH = Math.max(1, screenH - screenPadding * 2);
  const wrapped = getWrappedLines(text, availW, screenFontSize);
  const lineCount = Math.max(1, wrapped.length);
  const maxFontForHeight = availH / (lineCount * LINE_HEIGHT_RATIO);
  if (screenFontSize > maxFontForHeight) {
    screenFontSize = Math.max(1, maxFontForHeight);
  }

  if (!Number.isFinite(screenW) || !Number.isFinite(screenH) || screenW < 1 || screenH < 1) {
    return null;
  }

  const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    const next = e.relatedTarget as Node | null;
    if (toolbarRef.current && next && toolbarRef.current.contains(next)) return;
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
  const toolbarTop = Math.max(8, screenY - toolbarHeight - 4);

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
        ref={toolbarRef}
        className="text-edit-toolbar"
        style={{
          position: 'absolute',
          left: screenX,
          top: toolbarTop,
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
          whiteSpace: 'pre-wrap',
          wordWrap: 'break-word',
          pointerEvents: 'auto',
        }}
      />
    </div>
  );
}
