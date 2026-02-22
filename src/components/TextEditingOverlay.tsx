import { useState, useEffect, useRef } from 'react';
import type { BoardObject, Wire, PillRef } from '../types/board';
import { computeTextLayout } from '../lib/textParser';
import { PillEditor } from '../features/wiring/PillEditor';
import type { PromptDataSnapshot } from '../features/wiring/PillEditor';

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
  /** Wires on the board (for pill context) */
  wires?: Record<string, Wire>;
  /** All board objects (for pill context) */
  objects?: Record<string, BoardObject>;
  /** Callback to save prompt data (template, pills) */
  onSavePromptData?: (id: string, data: { text: string; promptTemplate: string; pills: PillRef[] }) => void;
  /** Ref kept up-to-date with PillEditor's latest serialized content for save-on-click-outside */
  latestPromptDataRef?: React.MutableRefObject<PromptDataSnapshot | null>;
  /** Callback to set apiConfig on an object (triggered by >> API lookup in PillEditor) */
  onSetApiConfig?: (id: string, apiId: string) => void;
}

export function TextEditingOverlay({
  obj,
  viewport,
  initialDraft,
  onSave,
  onCancel,
  onDraftChange,
  latestDraftRef,
  wires,
  objects,
  onSavePromptData,
  latestPromptDataRef,
  onSetApiConfig,
}: TextEditingOverlayProps) {
  const isFrame = obj?.type === 'frame';
  // Non-prompt result stickies display promptOutput; use it as the editable text
  const getDisplayText = (o: BoardObject | null) => {
    if (!o) return '';
    if (o.type === 'frame') return o.text?.trim() ?? 'Frame';
    const isPrompt = (o.pills?.length ?? 0) > 0 || !!o.promptTemplate;
    return isPrompt ? (o.text ?? '') : (o.promptOutput ?? o.text ?? '');
  };
  const [text, setText] = useState(
    () => initialDraft !== undefined ? initialDraft : getDisplayText(obj)
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
      const next = initialDraft !== undefined ? initialDraft : getDisplayText(obj);
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
  const layout = computeTextLayout(text, Math.max(1, obj.width), Math.max(1, obj.height), { maxFontSize: 16 });
  const screenFontSize = layout.fontSize * scale;
  const screenPadding = layout.padding * scale;

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
      setText(getDisplayText(obj));
      onCancel();
    }
  };

  const handleDone = () => {
    onSave(obj.id, text);
    onCancel();
  };

  const inset = 8;
  // Bottom-right corner inside the sticky (anchor at corner, then shift so button sits inside)
  const doneAnchorX = screenX + screenW - inset;
  const doneAnchorY = screenY + screenH - inset;

  // Use PillEditor for all stickies/text so any sticky can become a smart sticky by typing {pill}.
  const usePillEditor = (obj.type === 'stickyNote' || obj.type === 'text') && !!onSavePromptData;

  if (usePillEditor) {
    // Cover the entire sticky note so Konva text underneath is hidden
    const bgColor = obj.type === 'stickyNote'
      ? (obj.color ?? '#e6d070')
      : obj.type === 'text'
        ? '#f4f0e8'
        : '#f4f0e8';
    const borderRadius = Math.max(0, Math.min(8, minScreenDim * 0.02));

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
            left: screenX,
            top: screenY,
            width: screenW,
            height: screenH,
            display: 'flex',
            flexDirection: 'column',
            pointerEvents: 'auto',
            background: bgColor,
            borderRadius,
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
        >
          <PillEditor
            initialText={getDisplayText(obj)}
            initialPills={obj.pills ?? []}
            objectId={obj.id}
            onSave={(result) => {
              onSavePromptData!(obj.id, result);
              onCancel();
            }}
            onCancel={onCancel}
            latestDataRef={latestPromptDataRef}
            onSetApiConfig={onSetApiConfig ? (apiId) => onSetApiConfig(obj.id, apiId) : undefined}
            style={{
              flex: 1,
              width: '100%',
              boxSizing: 'border-box',
              border: 'none',
              background: 'transparent',
              fontFamily: '"Courier New", Courier, monospace',
              fontSize: screenFontSize,
              lineHeight: 1.3,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordWrap: 'break-word',
              padding: `${screenPadding}px`,
              outline: 'none',
              color: '#2c2416',
            }}
          />
        </div>
      </div>
    );
  }

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
        ref={inputRef as React.RefObject<HTMLTextAreaElement>}
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
          left: screenX,
          top: screenY,
          width: screenW,
          height: screenH,
          boxSizing: 'border-box',
          padding: screenPadding,
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
          background: obj.type === 'stickyNote' ? (obj.color ?? '#e6d070') : 'transparent',
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
