import { useState, useEffect, useRef } from 'react';
import type { BoardObject } from '../types/board';
import { computeAutoFitFontSize, getWrappedLines, LINE_HEIGHT_RATIO } from '../lib/textParser';

const DRAFT_PERSIST_DEBOUNCE_MS = 400;

interface TextEditingOverlayProps {
  obj: BoardObject | null;
  viewport: { x: number; y: number; scale: number };
  initialDraft?: string;
  onSave: (id: string, text: string, headingLevel?: number) => void;
  onCancel: () => void;
  onDraftChange?: (text: string) => void;
  /** Ref updated on every keystroke so parent can read latest draft when saving on click-outside */
  latestDraftRef?: React.MutableRefObject<string>;
}

export function TextEditingOverlay({
  obj,
  viewport,
  initialDraft,
  onSave,
  onCancel,
  onDraftChange,
  latestDraftRef,
}: TextEditingOverlayProps) {
  const isFrame = obj?.type === 'frame';
  const [text, setText] = useState(
    () =>
      initialDraft !== undefined
        ? initialDraft
        : isFrame
          ? (obj?.text?.trim() ?? 'Frame')
          : (obj?.text ?? '')
  );
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const openedIdRef = useRef<string | null>(null);
  const draftDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!obj) {
      openedIdRef.current = null;
      return;
    }
    if (openedIdRef.current !== obj.id) {
      openedIdRef.current = obj.id;
      const next =
        initialDraft !== undefined
          ? initialDraft
          : obj.type === 'frame'
            ? (obj.text?.trim() ?? 'Frame')
            : (obj.text ?? '');
      setText(next);
      if (latestDraftRef) latestDraftRef.current = next;
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [obj, initialDraft, latestDraftRef]);

  useEffect(() => {
    if (!onDraftChange || !obj) return;
    draftDebounceRef.current = setTimeout(() => {
      draftDebounceRef.current = null;
      onDraftChange(text);
    }, DRAFT_PERSIST_DEBOUNCE_MS);
    return () => {
      if (draftDebounceRef.current) {
        clearTimeout(draftDebounceRef.current);
        draftDebounceRef.current = null;
      }
    };
  }, [text, obj?.id, onDraftChange]);

  // Close edit only when visible note/text has no drawable area (infinite zoom: no scale-based minimum)
  useEffect(() => {
    if (!obj || (obj.type !== 'stickyNote' && obj.type !== 'text')) return;
    const scale = Number.isFinite(viewport.scale) && viewport.scale > 0 ? viewport.scale : 1;
    const sw = obj.width * scale;
    const sh = obj.height * scale;
    if (!Number.isFinite(sw) || !Number.isFinite(sh) || sw < 1 || sh < 1) onCancel();
  }, [obj, viewport.scale, viewport.x, viewport.y, onCancel]);

  if (!obj || (obj.type !== 'stickyNote' && obj.type !== 'text' && obj.type !== 'frame')) return null;

  const scale = Number.isFinite(viewport.scale) && viewport.scale > 0 ? viewport.scale : 1;
  const screenX = obj.x * scale + viewport.x;
  const screenY = obj.y * scale + viewport.y;
  const screenW = obj.width * scale;
  const screenH = obj.height * scale;

  // Frame title: single-line edit above the frame, Done on the right
  if (obj.type === 'frame') {
    const frameTitleHeight = 28;
    const frameTitleY = screenY - frameTitleHeight - 4;
    const frameInputWidth = Math.max(120, Math.min(280, screenW - 8));
    const handleFrameKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setText(obj.text?.trim() ?? 'Frame');
        onCancel();
      }
      if (e.key === 'Enter') {
        onSave(obj.id, text.trim() || 'Frame');
        onCancel();
      }
    };
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
          style={{
            position: 'absolute',
            left: screenX + 4,
            top: frameTitleY,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            pointerEvents: 'auto',
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type="text"
            className="text-editing-input frame-name-input"
            value={text}
            onChange={(e) => {
              const next = e.target.value;
              setText(next);
              if (latestDraftRef) latestDraftRef.current = next;
            }}
            onKeyDown={handleFrameKeyDown}
            style={{
              width: frameInputWidth,
              height: frameTitleHeight,
              boxSizing: 'border-box',
              padding: '0 8px',
              margin: 0,
              border: '1px solid rgba(74,124,89,0.5)',
              borderRadius: 4,
              fontFamily: '"Courier New", Courier, monospace',
              fontSize: 13,
              color: 'var(--text-primary, #2c2416)',
            }}
          />
          <button
            className="text-edit-btn text-edit-btn-done"
            onClick={() => {
              onSave(obj.id, text.trim() || 'Frame');
              onCancel();
            }}
            title="Save and close"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

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
    // Persist draft only; do not save to server or close. User can click Done to save.
    if (draftDebounceRef.current) {
      clearTimeout(draftDebounceRef.current);
      draftDebounceRef.current = null;
    }
    onDraftChange?.(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setText(obj.text ?? '');
      onCancel();
    }
  };

  const handleDone = () => {
    onSave(obj.id, text);
    onCancel();
  };

  const textAreaW = Math.max(1, screenW - screenPadding * 2);
  const textAreaH = Math.max(1, screenH - screenPadding * 2);
  const inset = 8;
  // Bottom-right corner inside the textarea (anchor at corner, then shift so button sits inside)
  const doneAnchorX = screenX + screenPadding + textAreaW - inset;
  const doneAnchorY = screenY + screenPadding + textAreaH - inset;

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
      <textarea
        ref={inputRef}
        className="text-editing-input"
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          if (latestDraftRef) latestDraftRef.current = next;
        }}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        style={{
          position: 'absolute',
          left: screenX + screenPadding,
          top: screenY + screenPadding,
          width: textAreaW,
          height: textAreaH,
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
      <div
        ref={toolbarRef}
        className="text-edit-toolbar"
        style={{
          position: 'absolute',
          left: doneAnchorX,
          top: doneAnchorY,
          transform: 'translate(-100%, -100%)',
          pointerEvents: 'auto',
        }}
        onMouseDown={(e) => e.preventDefault()}
      >
        <button
          className="text-edit-btn text-edit-btn-done"
          onClick={handleDone}
          title="Save and close"
        >
          Done
        </button>
      </div>
    </div>
  );
}
