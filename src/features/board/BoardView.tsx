import { useRef, useState, useEffect, useCallback } from 'react';
import { useAuth } from '../auth/useAuth';
import { useBoardId } from './hooks/useBoardId';
import { BoardCanvas } from './BoardCanvas';
import { Toolbar } from './Toolbar';
import { CursorOverlay } from '../../components/CursorOverlay';
import { PresenceList } from '../../components/PresenceList';
import { useBoardStore } from '../../lib/store';
import { useCursorSync } from '../sync/useCursorSync';
import { useBoardSync } from '../sync/useBoardSync';
import { TextEditingOverlay } from '../../components/TextEditingOverlay';
import { ColorPicker } from './components/ColorPicker';
import { AgentPanel } from '../agent/AgentPanel';
import { UserBoardsPanel } from './components/UserBoardsPanel';
import {
  getPersistedEditState,
  setPersistedEditState,
  clearPersistedEditState,
} from '../../lib/editStatePersistence';
import { usePromptRunner } from '../wiring/usePromptRunner';
import { getExecutionChain, getExecutionLevels } from '../wiring/wireGraph';
import type { PillRef } from '../../types/board';
import type { PromptDataSnapshot } from '../wiring/PillEditor';
import { ApiLookupDropdown } from '../apiLookup/ApiLookupDropdown';
import type { ApiDefinition } from '../apiLookup/apiRegistry';

export function BoardView() {
  const { user, signOut } = useAuth();
  const { boardId: defaultBoardId, loading: boardLoading, error: boardError } = useBoardId(user?.uid);
  const [boardIdOverride, setBoardIdOverride] = useState<string | null>(null);
  const boardId = boardIdOverride ?? defaultBoardId;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAiOpen, setIsAiOpen] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState<string | null>(null);
  const hasRestoredRef = useRef(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const editOverlayContainerRef = useRef<HTMLDivElement>(null);
  const latestDraftRef = useRef<string>('');
  const latestPromptDataRef = useRef<PromptDataSnapshot | null>(null);

  const {
    objects,
    connections,
    wires,
    updateObject,
    createObject,
    deleteObject,
    createConnection,
    updateConnection,
    deleteConnection,
    deleteConnectionsForObject,
    createWire,
    updateWire,
    deleteWire,
    deleteWiresForObject,
  } = useBoardSync(boardId);
  const { runPrompt } = usePromptRunner(boardId);
  const { cursors } = useCursorSync(
    boardId,
    user?.uid,
    user?.displayName ?? 'Anonymous'
  );
  const viewport    = useBoardStore((s) => s.viewport);
  const setViewport = useBoardStore((s) => s.setViewport);
  const selectedIds = useBoardStore((s) => s.selectedIds);
  const setSelection = useBoardStore((s) => s.setSelection);
  const pushUndo    = useBoardStore((s) => s.pushUndo);
  const apiChangeRequest = useBoardStore((s) => s.apiChangeRequest);
  const setApiChangeRequest = useBoardStore((s) => s.setApiChangeRequest);

  const selectedObject = selectedIds.length === 1 ? objects[selectedIds[0]] : null;

  // Restore edit state from localStorage when board and objects are ready.
  // Do not clear persisted state when object is missing—objects may not have loaded yet.
  useEffect(() => {
    if (!boardId || hasRestoredRef.current) return;
    const persisted = getPersistedEditState(boardId);
    if (!persisted) return;
    const obj = objects[persisted.editingId];
    if (obj && (obj.type === 'stickyNote' || obj.type === 'text' || obj.type === 'frame')) {
      hasRestoredRef.current = true;
      if (
        persisted.viewport &&
        Number.isFinite(persisted.viewport.x) &&
        Number.isFinite(persisted.viewport.y) &&
        Number.isFinite(persisted.viewport.scale) &&
        persisted.viewport.scale > 0
      ) {
        setViewport(persisted.viewport);
      }
      setEditingId(persisted.editingId);
      setRestoredDraft(persisted.draftText);
      latestDraftRef.current = persisted.draftText;
    }
  }, [boardId, objects, setViewport]);

  // If we're "editing" but the object is missing (deleted or wrong board), clear state
  useEffect(() => {
    if (!boardId || !editingId) return;
    const obj = objects[editingId];
    if (!obj) {
      setEditingId(null);
      setRestoredDraft(null);
      clearPersistedEditState(boardId);
    }
  }, [boardId, editingId, objects]);

  // Clear restored draft after overlay has consumed it (one tick)
  useEffect(() => {
    if (editingId && restoredDraft != null) {
      const t = setTimeout(() => setRestoredDraft(null), 0);
      return () => clearTimeout(t);
    }
  }, [editingId, restoredDraft]);

  const handleStickyNoteDoubleClick = (id: string) => {
    const obj = objects[id];
    if (obj?.type !== 'stickyNote' && obj?.type !== 'text' && obj?.type !== 'frame') return;
    if (boardId) clearPersistedEditState(boardId);
    const isPromptNode = (obj.pills?.length ?? 0) > 0 || !!obj.promptTemplate;
    const displayText = obj?.type === 'frame'
      ? (obj?.text?.trim() ?? 'Frame')
      : isPromptNode
        ? (obj?.text ?? '')
        : (obj?.promptOutput ?? obj?.text ?? '');
    latestDraftRef.current = displayText;
    latestPromptDataRef.current = null;
    setEditingId(id);
    setRestoredDraft(null);
  };

  const handleTextSave = (id: string, text: string, headingLevel?: number) => {
    const prev = objects[id];
    const prevText = prev?.text;
    const prevPromptOutput = prev?.promptOutput;
    const prevHeadingLevel = prev?.headingLevel;
    // Result stickies (non-prompt nodes with promptOutput) edit promptOutput, not text
    const isPromptNode = (prev?.pills?.length ?? 0) > 0 || !!prev?.promptTemplate;
    const isResultSticky = !isPromptNode && !!prev?.promptOutput;
    if (isResultSticky) {
      updateObject(id, { promptOutput: text });
      pushUndo({
        description: 'Edit text',
        undo: () => updateObject(id, { promptOutput: prevPromptOutput }),
      });
    } else {
      updateObject(id, headingLevel !== undefined ? { text, headingLevel } : { text });
      pushUndo({
        description: 'Edit text',
        undo: () => updateObject(id, { text: prevText, headingLevel: prevHeadingLevel }),
      });
    }
    if (boardId) clearPersistedEditState(boardId);
    setEditingId(null);
    setRestoredDraft(null);
  };

  const handleColorChange = (color: string) => {
    const prevColors = selectedIds.map((id) => ({ id, color: objects[id]?.color }));
    selectedIds.forEach((id) => {
      updateObject(id, { color });
    });
    pushUndo({
      description: 'Change color',
      undo: () => prevColors.forEach(({ id, color: prev }) => updateObject(id, { color: prev })),
    });
  };

  const clearSelectionOnHotkey = () => {
    const ids = useBoardStore.getState().selectedIds;
    ids.forEach((id) => updateObject(id, { selectedBy: null, selectedByName: null }));
    setSelection([]);
  };

  const handleEditCancel = () => {
    if (boardId) clearPersistedEditState(boardId);
    setEditingId(null);
    setRestoredDraft(null);
  };

  const handleSendToBack = () => {
    const prev = selectedIds.map((id) => ({ id, sentToBack: objects[id]?.sentToBack }));
    selectedIds.forEach((id) => updateObject(id, { sentToBack: true }));
    pushUndo({
      description: 'Send to back',
      undo: () => prev.forEach(({ id, sentToBack }) => updateObject(id, { sentToBack: sentToBack ?? false })),
    });
  };

  const handleBringToFront = () => {
    const prev = selectedIds.map((id) => ({ id, sentToBack: objects[id]?.sentToBack }));
    selectedIds.forEach((id) => updateObject(id, { sentToBack: false }));
    pushUndo({
      description: 'Bring to front',
      undo: () => prev.forEach(({ id, sentToBack }) => updateObject(id, { sentToBack: sentToBack ?? false })),
    });
  };

  const handleBoardSwitch = (id: string) => {
    setSelection([]);
    setEditingId(null);
    setRestoredDraft(null);
    hasRestoredRef.current = false;
    if (boardId) clearPersistedEditState(boardId);
    useBoardStore.getState().clearUndoStack();
    setBoardIdOverride(id);
    // Update URL so refresh returns to this board
    const url = new URL(window.location.href);
    url.searchParams.set('board', id);
    window.history.replaceState({}, '', url.toString());
  };

  const handleSavePromptData = useCallback((id: string, data: { text: string; promptTemplate: string; pills: PillRef[] }) => {
    const prev = objects[id];
    const prevText = prev?.text;
    const prevTemplate = prev?.promptTemplate;
    const prevPills = prev?.pills;
    const prevPromptOutput = prev?.promptOutput;
    const prevApiConfig = prev?.apiConfig;
    const hasPills = data.pills.length > 0;
    // If pills still contain API-group pills, preserve apiConfig; otherwise clear it
    const hasApiPills = data.pills.some((p) => p.apiGroup);
    updateObject(id, {
      text: data.text,
      promptTemplate: hasPills ? data.promptTemplate : undefined,
      pills: hasPills ? data.pills : undefined,
      // Clear promptOutput so display switches to text for prompt nodes;
      // also avoids stale data when a result sticky is converted to a prompt node.
      promptOutput: undefined,
      // Preserve apiConfig when API pills exist; clear when they've been removed
      apiConfig: hasApiPills ? prev?.apiConfig : undefined,
    });
    pushUndo({
      description: 'Edit prompt',
      undo: () => updateObject(id, { text: prevText, promptTemplate: prevTemplate, pills: prevPills, promptOutput: prevPromptOutput, apiConfig: prevApiConfig }),
    });
    if (boardId) clearPersistedEditState(boardId);
    setEditingId(null);
    setRestoredDraft(null);
  }, [objects, updateObject, pushUndo, boardId]);

  // Left-side nodes for inputs, right-side nodes for outputs (same as PillEditor)
  const INPUT_NODES  = [8, 7, 6, 1, 5];
  const OUTPUT_NODES = [2, 3, 4, 1, 5];
  const nextFreeNode = (pills: PillRef[], direction: 'in' | 'out'): number => {
    const used = new Set(pills.map((p) => p.node));
    const preferred = direction === 'in' ? INPUT_NODES : OUTPUT_NODES;
    for (const n of preferred) {
      if (!used.has(n)) return n;
    }
    return preferred[preferred.length - 1];
  };

  /** Handle API change from the double-click dropdown */
  const handleApiChange = useCallback((newApi: ApiDefinition) => {
    if (!apiChangeRequest) return;
    const { objectId } = apiChangeRequest;
    const obj = objects[objectId];
    if (!obj) { setApiChangeRequest(null); return; }

    const oldApiId = obj.apiConfig?.apiId;
    const prevPills = obj.pills ?? [];
    const prevText = obj.text ?? '';
    const prevTemplate = obj.promptTemplate;
    const prevApiConfig = obj.apiConfig;

    // Remove old API pills, keep non-API pills
    const keptPills = prevPills.filter((p) => p.apiGroup !== oldApiId);

    // Create new input pills
    const newPills: PillRef[] = [...keptPills];
    const inputPills: PillRef[] = [];
    for (const param of newApi.params) {
      const node = nextFreeNode(newPills, 'in');
      const pill: PillRef = { id: crypto.randomUUID(), label: param.name, node, direction: 'in', apiGroup: newApi.id };
      newPills.push(pill);
      inputPills.push(pill);
    }
    // Create new output pill
    const outNode = nextFreeNode(newPills, 'out');
    const outPill: PillRef = { id: crypto.randomUUID(), label: 'result', node: outNode, direction: 'out', apiGroup: newApi.id };
    newPills.push(outPill);

    // Update text and template: replace [API:oldId] marker with [API:newId]
    const newMarker = `[API:${newApi.id}]`;
    let newText = prevText;
    let newTemplate = prevTemplate;
    if (oldApiId) {
      const oldMarker = `[API:${oldApiId}]`;
      newText = newText.replace(oldMarker, newMarker);
      newTemplate = newTemplate?.replace(oldMarker, newMarker);
    } else {
      // No old marker — append the new one
      newText = newMarker;
      newTemplate = newMarker;
    }

    updateObject(objectId, {
      text: newText,
      promptTemplate: newTemplate,
      pills: newPills,
      apiConfig: { apiId: newApi.id },
    });
    pushUndo({
      description: 'Change API',
      undo: () => updateObject(objectId, {
        text: prevText,
        promptTemplate: prevTemplate,
        pills: prevPills,
        apiConfig: prevApiConfig,
      }),
    });
    setApiChangeRequest(null);
  }, [apiChangeRequest, objects, updateObject, pushUndo, setApiChangeRequest]);

  const setChainRunning = useBoardStore((s) => s.setChainRunning);
  const setChainRunningParallel = useBoardStore((s) => s.setChainRunningParallel);
  const clearChainRunning = useBoardStore((s) => s.clearChainRunning);

  const handleRunNow = useCallback(async (objectId: string) => {
    // Save current prompt data first, then run after a short delay so
    // Firebase write lands before the backend reads the object.
    const promptSnap = latestPromptDataRef.current;
    const obj = objects[objectId];
    if (promptSnap && promptSnap.pills.length > 0) {
      // Only write pill data when there ARE pills — never clear them during a run
      updateObject(objectId, {
        text: promptSnap.text,
        promptTemplate: promptSnap.promptTemplate,
        pills: promptSnap.pills,
        ...(obj?.apiConfig ? { apiConfig: obj.apiConfig } : {}),
      });
      // Wait for Firebase write to propagate
      await new Promise((r) => setTimeout(r, 500));
    } else {
      // No pill data to save — just ensure apiConfig is present before running
      if (obj?.apiConfig) {
        updateObject(objectId, { apiConfig: obj.apiConfig });
      }
    }

    // Build execution chain (traces upstream to roots)
    const chain = getExecutionChain(objectId, objects, wires);
    console.log('[chain] target:', objectId, 'chain length:', chain.length,
      'order:', chain.map((id) => objects[id]?.text?.slice(0, 25) ?? objects[id]?.apiConfig?.apiId ?? id.slice(0, 8)));

    if (chain.length <= 1) {
      // Single prompt — run directly (existing behavior)
      void runPrompt(objectId);
      return;
    }

    // Parallel chain execution: run independent nodes concurrently within each depth level.
    const levels = getExecutionLevels(objectId, objects, wires);
    const allIds = levels.flat();
    setChainRunningParallel(allIds, levels[0] ?? []);
    let aborted = false;
    for (const level of levels) {
      if (aborted) break;
      console.log('[chain] running level:', level.map((id) => objects[id]?.text?.slice(0, 25) ?? objects[id]?.apiConfig?.apiId));
      setChainRunningParallel(allIds, level);
      const results = await Promise.all(level.map((id) => runPrompt(id)));
      for (const result of results) {
        if (!result.success) { aborted = true; break; }
      }
      // Brief pause to let Firebase listeners propagate the write to other clients
      await new Promise((r) => setTimeout(r, 500));
    }
    clearChainRunning();
  }, [objects, wires, updateObject, runPrompt, setChainRunning, setChainRunningParallel, clearChainRunning]);

  const handleDraftChange = (text: string) => {
    latestDraftRef.current = text;
    if (boardId && editingId) {
      setPersistedEditState(boardId, {
        editingId,
        draftText: text,
        viewport: { x: viewport.x, y: viewport.y, scale: viewport.scale },
      });
    }
  };

  // Click outside the edit overlay (canvas, empty area, etc.) → save and close.
  // Listener on document so we always receive the event (Konva canvas can consume it on the wrapper).
  // Applies to both sticky notes and text fields.
  useEffect(() => {
    if (!editingId) return;
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = (e.target as Node) ?? null;
      const container = editOverlayContainerRef.current;
      if (container && target && container.contains(target)) return;
      const obj = objects[editingId];
      const savedId = editingId;

      // PillEditor path: save prompt data (text + template + pills)
      const promptSnap = latestPromptDataRef.current;
      if (promptSnap) {
        handleSavePromptData(savedId, promptSnap);
        latestPromptDataRef.current = null;
        return;
      }

      // Regular textarea path: save plain text (or promptOutput for result stickies)
      const isPromptNode = (obj?.pills?.length ?? 0) > 0 || !!obj?.promptTemplate;
      const isResultSticky = !isPromptNode && !!obj?.promptOutput;
      const raw = latestDraftRef.current ?? (isResultSticky ? (obj?.promptOutput ?? '') : (obj?.text ?? ''));
      if (isResultSticky) {
        const prevOutput = obj?.promptOutput;
        updateObject(editingId, { promptOutput: raw });
        pushUndo({
          description: 'Edit text',
          undo: () => updateObject(savedId, { promptOutput: prevOutput }),
        });
      } else {
        const prevText = obj?.text;
        const prevHeadingLevel = obj?.headingLevel;
        const text = obj?.type === 'frame' ? (raw.trim() || 'Frame') : raw;
        updateObject(editingId, { text });
        pushUndo({
          description: 'Edit text',
          undo: () => updateObject(savedId, { text: prevText, headingLevel: prevHeadingLevel }),
        });
      }
      clearPersistedEditState(boardId ?? '');
      setEditingId(null);
      setRestoredDraft(null);
    };
    document.addEventListener('mousedown', handlePointerDown as (e: MouseEvent) => void, true);
    document.addEventListener('touchstart', handlePointerDown as (e: TouchEvent) => void, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown as (e: MouseEvent) => void, true);
      document.removeEventListener('touchstart', handlePointerDown as (e: TouchEvent) => void, true);
    };
  }, [editingId, boardId, objects, updateObject, pushUndo, handleSavePromptData]);

  if (!user) {
    return null;
  }

  if (boardError && !boardLoading) {
    return (
      <div className="board-loading">
        <p className="board-error-message">Could not load board</p>
        <p className="board-error-detail">{boardError}</p>
        <button
          type="button"
          className="btn-primary"
          onClick={() => window.location.reload()}
        >
          Retry
        </button>
      </div>
    );
  }

  if (boardLoading || !boardId) {
    return (
      <div className="board-loading">
        <div className="auth-loading-spinner" />
        <p>Loading board...</p>
      </div>
    );
  }

  return (
    <div className="board-layout">
      <header className="board-header">
        <div className="board-header-left">
          <h1 className="board-title">LiveWire</h1>
          <span className="board-object-count" title="Objects on board">
            {Object.keys(objects).length} object{Object.keys(objects).length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="board-header-right">
          <PresenceList cursors={cursors} />
          <div className="user-menu">
            {boardId && (
              <UserBoardsPanel
                userId={user.uid}
                currentBoardId={boardId}
                onBoardSwitch={handleBoardSwitch}
              />
            )}
            <button className="btn-sign-out" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <div className="board-main">
        <div className="board-canvas-wrapper" ref={wrapperRef}>
          <BoardCanvas
            boardId={boardId}
            userId={user.uid}
            userName={user.displayName ?? 'Anonymous'}
            onStickyNoteDoubleClick={handleStickyNoteDoubleClick}
            onRunPrompt={handleRunNow}
            objects={objects}
            updateObject={updateObject}
            createObject={createObject}
            deleteObject={deleteObject}
            connections={connections}
            createConnection={createConnection}
            updateConnection={updateConnection}
            deleteConnection={deleteConnection}
            deleteConnectionsForObject={deleteConnectionsForObject}
            wires={wires}
            createWire={createWire}
            updateWire={updateWire}
            deleteWire={deleteWire}
            deleteWiresForObject={deleteWiresForObject}
          />
          <div ref={editOverlayContainerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <TextEditingOverlay
              obj={editingId ? objects[editingId] ?? null : null}
              viewport={viewport}
              initialDraft={editingId && restoredDraft != null ? restoredDraft : undefined}
              onSave={handleTextSave}
              onCancel={handleEditCancel}
              onDraftChange={handleDraftChange}
              latestDraftRef={latestDraftRef}
              wires={wires}
              objects={objects}
              onSavePromptData={handleSavePromptData}
              latestPromptDataRef={latestPromptDataRef}
              onSetApiConfig={(id, apiId) => updateObject(id, { apiConfig: { apiId } })}
              boardId={boardId}
              userId={user.uid}
            />
          </div>
          {apiChangeRequest && (
            <ApiLookupDropdown
              position={apiChangeRequest.position}
              onSelect={handleApiChange}
              onClose={() => setApiChangeRequest(null)}
            />
          )}
          <CursorOverlay
            cursors={cursors}
            viewport={viewport}
            excludeUserId={user.uid}
          />
          <div className="toolbar-area">
            {selectedIds.length > 0 && (
              <div className="selection-tools">
                <ColorPicker
                  currentColor={selectedObject?.color}
                  onColorChange={handleColorChange}
                />
                <div className="object-order-buttons">
                  <button
                    type="button"
                    className="toolbar-btn"
                    title="Send behind arrows"
                    onClick={handleSendToBack}
                  >
                    Send to back
                  </button>
                  <button
                    type="button"
                    className="toolbar-btn"
                    title="Bring in front of arrows"
                    onClick={handleBringToFront}
                  >
                    Bring to front
                  </button>
                </div>
              </div>
            )}
            <AgentPanel
              boardId={boardId}
              isOpen={isAiOpen}
              onClose={() => setIsAiOpen(false)}
              selectedIds={selectedIds}
              viewport={{
                ...viewport,
                width: wrapperRef.current?.offsetWidth,
                height: wrapperRef.current?.offsetHeight,
              }}
            />
            <Toolbar
              onHotkeyPress={clearSelectionOnHotkey}
              onAiToggle={() => setIsAiOpen((v) => !v)}
              isAiOpen={isAiOpen}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
