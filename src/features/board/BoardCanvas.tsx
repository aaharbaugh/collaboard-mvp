import { useCallback, useEffect, useRef, useState } from 'react';
import type Konva from 'konva';
import { Stage, Layer, Group, Arrow, Rect } from 'react-konva';
import { useContainerSize } from '../../hooks/useContainerSize';
import { useBoardSync } from '../sync/useBoardSync';
import { useCursorSync } from '../sync/useCursorSync';
import { useBoardViewport } from './useBoardViewport';
import { useBoardStore } from '../../lib/store';
import { GridLayer } from './components/GridLayer';
import { BoardObject } from './components/BoardObject';
import { AnchorPoints } from './components/objects/AnchorPoints';
import { ResizeHandles } from './components/objects/ResizeHandles';
import { ConnectionLine } from './components/ConnectionLine';
import {
  STICKY_NOTE_DEFAULTS,
  SHAPE_DEFAULTS,
  DEFAULT_OBJECT_COLORS,
} from '../../lib/constants';
import type { BoardObject as BoardObjectType, AnchorPosition } from '../../types/board';

function getAnchorWorldPoint(obj: BoardObjectType, anchor: AnchorPosition): { x: number; y: number } {
  const { x, y, width: w, height: h } = obj;
  switch (anchor) {
    case 'top': return { x: x + w / 2, y };
    case 'bottom': return { x: x + w / 2, y: y + h };
    case 'left': return { x, y: y + h / 2 };
    case 'right': return { x: x + w, y: y + h / 2 };
    case 'top-left': return { x, y };
    case 'top-right': return { x: x + w, y };
    case 'bottom-left': return { x, y: y + h };
    case 'bottom-right': return { x: x + w, y: y + h };
  }
}

interface BoardCanvasProps {
  boardId: string;
  userId: string;
  userName: string;
  onStickyNoteDoubleClick?: (id: string) => void;
}

export function BoardCanvas({
  boardId,
  userId,
  userName,
  onStickyNoteDoubleClick,
}: BoardCanvasProps) {
  const { ref: containerRef, width, height } = useContainerSize();
  const {
    objects,
    connections,
    createObject,
    updateObject,
    deleteObject,
    createConnection,
    updateConnection,
    deleteConnection,
    deleteConnectionsForObject,
  } = useBoardSync(boardId);
  const { updateCursor } = useCursorSync(boardId, userId, userName);

  const { toolMode, selectedIds, setSelection } = useBoardStore();

  const {
    viewport,
    handleWheel,
    handleStageMouseDown,
    handleStageMouseMove,
    handleStageMouseUp,
    getPointerPosition,
    didPan,
  } = useBoardViewport(containerRef, toolMode);

  const [selectionRect, setSelectionRect] = useState<{
    startX: number; startY: number; endX: number; endY: number;
  } | null>(null);
  const [hoveredObjectId, setHoveredObjectId] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [drawingConnection, setDrawingConnection] = useState<{
    fromId: string;
    fromAnchor: AnchorPosition;
    waypoints: number[];
    currentPoint: { x: number; y: number };
  } | null>(null);

  const drawingConnectionRef = useRef(drawingConnection);
  drawingConnectionRef.current = drawingConnection;

  const clipboardRef = useRef<BoardObjectType[]>([]);
  const didAreaSelect = useRef(false);
  const groupDragStartPositions = useRef<Map<string, { x: number; y: number }>>(new Map());
  const objectNodeRefs = useRef<Map<string, Konva.Group>>(new Map());
  const resizeStart = useRef<{ objId: string; x: number; y: number; w: number; h: number } | null>(null);
  const connectionJustCompleted = useRef(false);

  const allObjects = Object.values(objects);
  const backObjects = allObjects.filter((obj) => obj.sentToBack === true);
  const frontObjects = allObjects.filter((obj) => obj.sentToBack !== true);

  const isMultiSelect = selectedIds.length > 1;
  const selectionBounds = isMultiSelect
    ? (() => {
        const selected = selectedIds.map((id) => objects[id]).filter(Boolean) as BoardObjectType[];
        if (selected.length === 0) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const obj of selected) {
          const w = obj.width;
          const h = obj.height;
          if (obj.type === 'circle') {
            const size = Math.min(w, h);
            const cx = obj.x + w / 2;
            const cy = obj.y + h / 2;
            minX = Math.min(minX, cx - size / 2);
            minY = Math.min(minY, cy - size / 2);
            maxX = Math.max(maxX, cx + size / 2);
            maxY = Math.max(maxY, cy + size / 2);
          } else {
            minX = Math.min(minX, obj.x);
            minY = Math.min(minY, obj.y);
            maxX = Math.max(maxX, obj.x + w);
            maxY = Math.max(maxY, obj.y + h);
          }
        }
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
      })()
    : null;

  const clearSelection = useCallback(() => {
    const ids = useBoardStore.getState().selectedIds;
    ids.forEach((id) => {
      updateObject(id, { selectedBy: null, selectedByName: null });
    });
    setSelection([]);
    setSelectedConnectionId(null);
  }, [updateObject, setSelection]);

  const handleStageClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (didPan.current) {
        didPan.current = false;
        return;
      }
      if (didAreaSelect.current) {
        didAreaSelect.current = false;
        return;
      }

      if (e.target === e.target.getStage()) {
        // If drawing a connection, clicking empty stage adds a waypoint
        if (drawingConnection) {
          const pos = getPointerPosition(e);
          if (!pos) return;
          setDrawingConnection((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              waypoints: [...prev.waypoints, pos.x, pos.y],
            };
          });
          return;
        }

        clearSelection();

        if (toolMode === 'select' || toolMode === 'move') return;

        const pos = getPointerPosition(e);
        if (!pos) return;

        const scale = viewport.scale;
        const id = crypto.randomUUID();
        const base = {
          id,
          x: pos.x,
          y: pos.y,
          createdBy: userId,
          createdAt: Date.now(),
        };

        if (toolMode === 'stickyNote') {
          createObject({
            ...base,
            type: 'stickyNote',
            width: STICKY_NOTE_DEFAULTS.width / scale,
            height: STICKY_NOTE_DEFAULTS.height / scale,
            color: DEFAULT_OBJECT_COLORS.stickyNote,
            text: 'New note',
          });
        } else if (toolMode === 'rectangle') {
          createObject({
            ...base,
            type: 'rectangle',
            width: SHAPE_DEFAULTS.width / scale,
            height: SHAPE_DEFAULTS.height / scale,
            color: DEFAULT_OBJECT_COLORS.rectangle,
          });
        } else if (toolMode === 'circle') {
          createObject({
            ...base,
            type: 'circle',
            width: SHAPE_DEFAULTS.width / scale,
            height: SHAPE_DEFAULTS.height / scale,
            color: DEFAULT_OBJECT_COLORS.circle,
          });
        }
        updateObject(id, { selectedBy: userId, selectedByName: userName });
        setSelection([id]);
        useBoardStore.getState().setToolMode('select');
      }
    },
    [toolMode, createObject, userId, userName, getPointerPosition, setSelection, clearSelection, updateObject, viewport.scale, didPan, drawingConnection]
  );

  const handleObjectClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>, id: string) => {
      e.cancelBubble = true;
      if (drawingConnection) return;
      if (toolMode === 'move') return;
      if (didPan.current) return;
      const prevIds = useBoardStore.getState().selectedIds;
      const nativeEvent = e.evt as MouseEvent;
      if (nativeEvent.shiftKey) {
        // Toggle object in/out of selection
        if (prevIds.includes(id)) {
          updateObject(id, { selectedBy: null, selectedByName: null });
          setSelection(prevIds.filter((pid) => pid !== id));
        } else {
          updateObject(id, { selectedBy: userId, selectedByName: userName });
          setSelection([...prevIds, id]);
        }
      } else {
        prevIds.forEach((prevId) => {
          if (prevId !== id) {
            updateObject(prevId, { selectedBy: null, selectedByName: null });
          }
        });
        updateObject(id, { selectedBy: userId, selectedByName: userName });
        setSelection([id]);
      }
      setSelectedConnectionId(null);
    },
    [setSelection, updateObject, userId, userName, drawingConnection, toolMode, didPan]
  );

  const handleObjectDoubleClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>, obj: BoardObjectType) => {
      e.cancelBubble = true;
      if (obj.type === 'stickyNote') {
        onStickyNoteDoubleClick?.(obj.id);
      }
    },
    [onStickyNoteDoubleClick]
  );

  const handleObjectDragStart = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>, id: string) => {
      const currentSelectedIds = useBoardStore.getState().selectedIds;
      if (!currentSelectedIds.includes(id)) return;
      // Snapshot start positions for all selected objects
      const positions = new Map<string, { x: number; y: number }>();
      currentSelectedIds.forEach((sid) => {
        const obj = objects[sid];
        if (obj) positions.set(sid, { x: obj.x, y: obj.y });
      });
      // Also record the dragged node's starting position
      positions.set(id, { x: e.target.x(), y: e.target.y() });
      groupDragStartPositions.current = positions;
    },
    [objects]
  );

  const handleObjectDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>, id: string) => {
      const startPositions = groupDragStartPositions.current;
      if (startPositions.size <= 1) return;
      const startPos = startPositions.get(id);
      if (!startPos) return;
      const dx = e.target.x() - startPos.x;
      const dy = e.target.y() - startPos.y;

      startPositions.forEach((pos, sid) => {
        if (sid === id) return;
        const node = objectNodeRefs.current.get(sid);
        if (node) {
          node.x(pos.x + dx);
          node.y(pos.y + dy);
        }
      });
    },
    []
  );

  const handleObjectDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>, id: string) => {
      const startPositions = groupDragStartPositions.current;
      if (startPositions.size > 1) {
        const startPos = startPositions.get(id);
        if (startPos) {
          const dx = e.target.x() - startPos.x;
          const dy = e.target.y() - startPos.y;
          startPositions.forEach((pos, sid) => {
            updateObject(sid, { x: pos.x + dx, y: pos.y + dy });
          });
        }
      } else {
        updateObject(id, { x: e.target.x(), y: e.target.y() });
      }
      groupDragStartPositions.current = new Map();
    },
    [updateObject]
  );

  const handleResizeStart = useCallback(
    (objId: string, _corner: string) => {
      const obj = objects[objId];
      if (!obj) return;
      resizeStart.current = { objId, x: obj.x, y: obj.y, w: obj.width, h: obj.height };
    },
    [objects]
  );

  const handleResizeMove = useCallback(
    (objId: string, corner: string, e: Konva.KonvaEventObject<DragEvent>) => {
      const start = resizeStart.current;
      if (!start || start.objId !== objId) return;

      // Use absolute world position of the pointer to avoid feedback loops
      const stage = e.target.getStage();
      if (!stage) return;
      const pointerPos = stage.getPointerPosition();
      if (!pointerPos) return;
      const transform = stage.getAbsoluteTransform().copy().invert();
      const worldPos = transform.point(pointerPos);

      let newX = start.x;
      let newY = start.y;
      let newW = start.w;
      let newH = start.h;
      const minSize = 20 / viewport.scale;

      if (corner === 'bottom-right') {
        newW = Math.max(minSize, worldPos.x - start.x);
        newH = Math.max(minSize, worldPos.y - start.y);
      } else if (corner === 'bottom-left') {
        newW = Math.max(minSize, start.x + start.w - worldPos.x);
        newH = Math.max(minSize, worldPos.y - start.y);
        newX = start.x + start.w - newW;
      } else if (corner === 'top-right') {
        newW = Math.max(minSize, worldPos.x - start.x);
        newH = Math.max(minSize, start.y + start.h - worldPos.y);
        newY = start.y + start.h - newH;
      } else if (corner === 'top-left') {
        newW = Math.max(minSize, start.x + start.w - worldPos.x);
        newH = Math.max(minSize, start.y + start.h - worldPos.y);
        newX = start.x + start.w - newW;
        newY = start.y + start.h - newH;
      }

      // Reset the handle node position to prevent Konva from accumulating drag offset
      const half = (8 / viewport.scale) / 2;
      const node = e.target;
      if (corner === 'bottom-right') { node.x(newW - half); node.y(newH - half); }
      else if (corner === 'bottom-left') { node.x(-half); node.y(newH - half); }
      else if (corner === 'top-right') { node.x(newW - half); node.y(-half); }
      else if (corner === 'top-left') { node.x(-half); node.y(-half); }

      updateObject(objId, { x: newX, y: newY, width: newW, height: newH });
    },
    [updateObject, viewport.scale]
  );

  const handleResizeEnd = useCallback(
    (objId: string, corner: string, e: Konva.KonvaEventObject<DragEvent>) => {
      handleResizeMove(objId, corner, e);
      resizeStart.current = null;
    },
    [handleResizeMove]
  );

  const handleMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      const pos = getPointerPosition(e);
      if (pos) {
        updateCursor(pos.x, pos.y);
        if (drawingConnection) {
          setDrawingConnection((prev) => prev ? { ...prev, currentPoint: pos } : null);
        }
        if (selectionRect) {
          setSelectionRect((prev) => prev ? { ...prev, endX: pos.x, endY: pos.y } : null);
        }
      }
    },
    [getPointerPosition, updateCursor, drawingConnection, selectionRect]
  );

  const handleAnchorMouseDown = useCallback(
    (_objectId: string, _anchor: AnchorPosition) => {
      // No longer start drawing on mousedown; we start on click (mouseup) so user can click start, then click waypoints/destination
    },
    []
  );

  const handleAnchorMouseUp = useCallback(
    (objectId: string, anchor: AnchorPosition) => {
      const dc = drawingConnectionRef.current;
      const obj = objects[objectId];
      if (!obj) return;

      if (dc) {
        // Already drawing: complete connection to this anchor (or cancel if same anchor as start)
        if (dc.fromId === objectId && dc.fromAnchor === anchor) {
          setDrawingConnection(null);
          drawingConnectionRef.current = null;
          return;
        }
        connectionJustCompleted.current = true;
        drawingConnectionRef.current = null;
        createConnection({
          id: crypto.randomUUID(),
          fromId: dc.fromId,
          fromAnchor: dc.fromAnchor,
          toId: objectId,
          toAnchor: anchor,
          points: dc.waypoints.length > 0 ? dc.waypoints : [],
          createdBy: userId,
          createdAt: Date.now(),
        });
        setDrawingConnection(null);
      } else {
        // Not drawing: this click starts a new connection from this anchor
        const point = getAnchorWorldPoint(obj, anchor);
        const newDC = { fromId: objectId, fromAnchor: anchor, waypoints: [], currentPoint: point };
        drawingConnectionRef.current = newDC;
        setDrawingConnection(newDC);
      }
    },
    [objects, userId, createConnection]
  );

  const handleStageMouseUpWithConnection = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      handleStageMouseUp();

      // Complete connection if pointer is over an object
      const dc = drawingConnectionRef.current;
      if (dc && !connectionJustCompleted.current) {
        const stage = e.target.getStage();
        if (stage) {
          const pointerPos = stage.getPointerPosition();
          if (pointerPos) {
            const transform = stage.getAbsoluteTransform().copy().invert();
            const worldPos = transform.point(pointerPos);
            // Hit test: find object under pointer
            for (const obj of allObjects) {
              if (worldPos.x >= obj.x && worldPos.x <= obj.x + obj.width &&
                  worldPos.y >= obj.y && worldPos.y <= obj.y + obj.height) {
                // Find nearest anchor
                const anchorPositions: AnchorPosition[] = ['top', 'bottom', 'left', 'right'];
                let bestAnchor: AnchorPosition = 'top';
                let bestDist = Infinity;
                for (const anchor of anchorPositions) {
                  const pt = getAnchorWorldPoint(obj, anchor);
                  const d = (pt.x - worldPos.x) ** 2 + (pt.y - worldPos.y) ** 2;
                  if (d < bestDist) { bestDist = d; bestAnchor = anchor; }
                }
                createConnection({
                  id: crypto.randomUUID(),
                  fromId: dc.fromId,
                  fromAnchor: dc.fromAnchor,
                  toId: obj.id,
                  toAnchor: bestAnchor,
                  points: dc.waypoints.length > 0 ? dc.waypoints : [],
                  createdBy: userId,
                  createdAt: Date.now(),
                });
                setDrawingConnection(null);
                connectionJustCompleted.current = true;
                break;
              }
            }
          }
        }
      }

      // Finalize area selection
      if (selectionRect) {
        const rect = selectionRect;
        const minX = Math.min(rect.startX, rect.endX);
        const maxX = Math.max(rect.startX, rect.endX);
        const minY = Math.min(rect.startY, rect.endY);
        const maxY = Math.max(rect.startY, rect.endY);

        const dragDist = Math.abs(rect.endX - rect.startX) + Math.abs(rect.endY - rect.startY);
        if (dragDist > 5 / viewport.scale) {
          didAreaSelect.current = true;
          const hitIds = allObjects
            .filter((obj) => {
              const objRight = obj.x + obj.width;
              const objBottom = obj.y + obj.height;
              return obj.x < maxX && objRight > minX && obj.y < maxY && objBottom > minY;
            })
            .map((obj) => obj.id);

          hitIds.forEach((id) => {
            updateObject(id, { selectedBy: userId, selectedByName: userName });
          });
          setSelection(hitIds);
        }
        setSelectionRect(null);
      }
    },
    [handleStageMouseUp, selectionRect, allObjects, updateObject, userId, userName, setSelection, viewport.scale, createConnection]
  );

  // Connection selection handlers
  const handleConnectionSelect = useCallback(
    (connId: string) => {
      clearSelection();
      setSelectedConnectionId(connId);
    },
    [clearSelection]
  );

  const handleConnectionWaypointDrag = useCallback(
    (connId: string, waypointIndex: number, x: number, y: number) => {
      const conn = connections[connId];
      if (!conn || !conn.points) return;
      const newPoints = [...conn.points];
      newPoints[waypointIndex] = x;
      newPoints[waypointIndex + 1] = y;
      // Local update for responsiveness — will sync on drag end
      updateConnection(connId, { points: newPoints });
    },
    [connections, updateConnection]
  );

  const handleConnectionWaypointDragEnd = useCallback(
    (connId: string, points: number[]) => {
      updateConnection(connId, { points });
    },
    [updateConnection]
  );

  const handleConnectionDoubleClick = useCallback(
    (connId: string, x: number, y: number) => {
      const conn = connections[connId];
      if (!conn) return;
      // Insert a new waypoint at the clicked position
      const currentPoints = conn.points ?? [];
      const newPoints = [...currentPoints, x, y];
      updateConnection(connId, { points: newPoints });
      setSelectedConnectionId(connId);
    },
    [connections, updateConnection]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape or right-click cancels drawing
      if (e.key === 'Escape' && drawingConnection) {
        setDrawingConnection(null);
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const active = document.activeElement?.tagName;
        if (active === 'INPUT' || active === 'TEXTAREA') return;

        // Delete selected connection
        if (selectedConnectionId) {
          deleteConnection(selectedConnectionId);
          setSelectedConnectionId(null);
          return;
        }

        selectedIds.forEach((id) => {
          deleteConnectionsForObject(id);
          deleteObject(id);
        });
        setSelection([]);
      }

      // Ctrl+C: copy selected objects (only objects we selected; store snapshot so clipboard isn't affected by others' edits)
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        if (selectedIds.length === 0) return;
        clipboardRef.current = selectedIds
          .filter((id) => {
            const obj = objects[id];
            return obj && obj.selectedBy === userId;
          })
          .map((id) => ({ ...objects[id]! }));
      }

      // Ctrl+V: paste copied objects
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if (clipboardRef.current.length === 0) return;
        const active = document.activeElement?.tagName;
        if (active === 'INPUT' || active === 'TEXTAREA') return;

        // Clear current selection
        selectedIds.forEach((id) => {
          updateObject(id, { selectedBy: null, selectedByName: null });
        });

        const newIds: string[] = [];
        clipboardRef.current.forEach((obj) => {
          const newId = crypto.randomUUID();
          createObject({
            ...obj,
            id: newId,
            x: obj.x + 20,
            y: obj.y + 20,
            createdBy: userId,
            createdAt: Date.now(),
            selectedBy: userId,
            selectedByName: userName,
          });
          newIds.push(newId);
        });
        // Update clipboard to point at the new copies (for repeated paste)
        clipboardRef.current = clipboardRef.current.map((obj) => ({
          ...obj,
          x: obj.x + 20,
          y: obj.y + 20,
        }));
        setSelection(newIds);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, deleteObject, deleteConnectionsForObject, setSelection, drawingConnection, selectedConnectionId, deleteConnection, objects, createObject, updateObject, userId, userName]);

  // Cancel drawing on right-click
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      if (drawingConnection) {
        e.preventDefault();
        setDrawingConnection(null);
      }
    };
    window.addEventListener('contextmenu', handleContextMenu);
    return () => window.removeEventListener('contextmenu', handleContextMenu);
  }, [drawingConnection]);

  // Paste image from clipboard
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            const img = new window.Image();
            img.onload = () => {
              const scale = viewport.scale;
              const cx = (-viewport.x + (width || window.innerWidth) / 2) / scale;
              const cy = (-viewport.y + (height || window.innerHeight) / 2) / scale;
              const id = crypto.randomUUID();
              createObject({
                id,
                type: 'image',
                x: cx - img.width / 2,
                y: cy - img.height / 2,
                width: img.width,
                height: img.height,
                imageData: dataUrl,
                createdBy: userId,
                createdAt: Date.now(),
              });
              setSelection([id]);
            };
            img.src = dataUrl;
          };
          reader.readAsDataURL(file);
          break;
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [createObject, userId, viewport, width, height, setSelection]);

  // Compute the in-progress arrow points
  let drawingArrowPoints: number[] | null = null;
  if (drawingConnection) {
    const fromObj = objects[drawingConnection.fromId];
    if (fromObj) {
      const from = getAnchorWorldPoint(fromObj, drawingConnection.fromAnchor);
      drawingArrowPoints = [
        from.x, from.y,
        ...drawingConnection.waypoints,
        drawingConnection.currentPoint.x, drawingConnection.currentPoint.y,
      ];
    }
  }

  return (
    <div ref={containerRef} className="board-container">
      <Stage
        width={width || window.innerWidth}
        height={height || window.innerHeight}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        x={viewport.x}
        y={viewport.y}
        onWheel={handleWheel}
        onMouseDown={(e) => {
          connectionJustCompleted.current = false;
          handleStageMouseDown(e);
          // Start area selection in select mode
          if (toolMode === 'select' && e.target === e.target.getStage() && !drawingConnection) {
            const pos = getPointerPosition(e);
            if (pos) {
              setSelectionRect({ startX: pos.x, startY: pos.y, endX: pos.x, endY: pos.y });
            }
          }
        }}
        onMouseMove={(e) => {
          handleStageMouseMove(e);
          handleMouseMove(e);
        }}
        onMouseUp={handleStageMouseUpWithConnection}
        onMouseLeave={handleStageMouseUpWithConnection}
        onClick={handleStageClick}
        onTap={handleStageClick}
        style={{
          cursor: drawingConnection ? 'crosshair' : toolMode === 'move' ? 'grab' : toolMode === 'select' ? 'default' : 'crosshair',
        }}
      >
        <GridLayer />

        <Layer>
          {/* Objects sent to back (behind arrows) */}
          {backObjects.map((obj) => {
            const isSelected = selectedIds.includes(obj.id);
            const showAnchors = (hoveredObjectId === obj.id || isSelected) && !isMultiSelect;
            const showSelectionBorder = isSelected && !isMultiSelect;
            return (
              <Group
                key={obj.id}
                ref={(node) => {
                  if (node) objectNodeRefs.current.set(obj.id, node);
                  else objectNodeRefs.current.delete(obj.id);
                }}
                x={obj.x}
                y={obj.y}
                draggable={toolMode === 'select' && isSelected && !drawingConnection}
                onClick={(e) => handleObjectClick(e, obj.id)}
                onTap={(e) => handleObjectClick(e, obj.id)}
                onDblClick={(e) => handleObjectDoubleClick(e, obj)}
                onDblTap={(e) => handleObjectDoubleClick(e, obj)}
                onDragStart={(e) => handleObjectDragStart(e, obj.id)}
                onDragMove={(e) => handleObjectDragMove(e, obj.id)}
                onDragEnd={(e) => handleObjectDragEnd(e, obj.id)}
                onMouseEnter={() => setHoveredObjectId(obj.id)}
                onMouseLeave={() => setHoveredObjectId((prev) => prev === obj.id ? null : prev)}
              >
                <BoardObject
                  obj={{ ...obj, x: 0, y: 0 }}
                  isSelected={isSelected}
                  showSelectionBorder={showSelectionBorder}
                  remoteSelectedBy={obj.selectedBy && obj.selectedBy !== userId ? (obj.selectedByName ?? undefined) : undefined}
                  zoomScale={viewport.scale}
                />
                <AnchorPoints
                  width={obj.width}
                  height={obj.height}
                  visible={showAnchors}
                  zoomScale={viewport.scale}
                  objectType={obj.type}
                  onAnchorMouseDown={(anchor) => handleAnchorMouseDown(obj.id, anchor)}
                  onAnchorMouseUp={(anchor) => handleAnchorMouseUp(obj.id, anchor)}
                />
                {isSelected && !isMultiSelect && (
                  <ResizeHandles
                    width={obj.width}
                    height={obj.height}
                    zoomScale={viewport.scale}
                    objectType={obj.type}
                    onResizeStart={(corner) => handleResizeStart(obj.id, corner)}
                    onResizeMove={(corner, e) => handleResizeMove(obj.id, corner, e)}
                    onResizeEnd={(corner, e) => handleResizeEnd(obj.id, corner, e)}
                  />
                )}
              </Group>
            );
          })}

          {/* Connections (arrows) */}
          {Object.values(connections).map((conn) => (
            <ConnectionLine
              key={conn.id}
              connection={conn}
              objects={objects}
              zoomScale={viewport.scale}
              isSelected={selectedConnectionId === conn.id}
              onSelect={handleConnectionSelect}
              onWaypointDrag={handleConnectionWaypointDrag}
              onWaypointDragEnd={handleConnectionWaypointDragEnd}
              onDoubleClick={handleConnectionDoubleClick}
            />
          ))}

          {/* In-progress drawing arrow */}
          {drawingArrowPoints && (
            <Arrow
              points={drawingArrowPoints}
              tension={0}
              stroke="#4a7c59"
              fill="#4a7c59"
              strokeWidth={2 / viewport.scale}
              pointerLength={10 / viewport.scale}
              pointerWidth={8 / viewport.scale}
              dash={[6 / viewport.scale, 3 / viewport.scale]}
              listening={false}
            />
          )}

          {/* Objects in front (above arrows) */}
          {frontObjects.map((obj) => {
            const isSelected = selectedIds.includes(obj.id);
            const showAnchors = (hoveredObjectId === obj.id || isSelected) && !isMultiSelect;
            const showSelectionBorder = isSelected && !isMultiSelect;
            return (
              <Group
                key={obj.id}
                ref={(node) => {
                  if (node) objectNodeRefs.current.set(obj.id, node);
                  else objectNodeRefs.current.delete(obj.id);
                }}
                x={obj.x}
                y={obj.y}
                draggable={toolMode === 'select' && isSelected && !drawingConnection}
                onClick={(e) => handleObjectClick(e, obj.id)}
                onTap={(e) => handleObjectClick(e, obj.id)}
                onDblClick={(e) => handleObjectDoubleClick(e, obj)}
                onDblTap={(e) => handleObjectDoubleClick(e, obj)}
                onDragStart={(e) => handleObjectDragStart(e, obj.id)}
                onDragMove={(e) => handleObjectDragMove(e, obj.id)}
                onDragEnd={(e) => handleObjectDragEnd(e, obj.id)}
                onMouseEnter={() => setHoveredObjectId(obj.id)}
                onMouseLeave={() => setHoveredObjectId((prev) => prev === obj.id ? null : prev)}
              >
                <BoardObject
                  obj={{ ...obj, x: 0, y: 0 }}
                  isSelected={isSelected}
                  showSelectionBorder={showSelectionBorder}
                  remoteSelectedBy={obj.selectedBy && obj.selectedBy !== userId ? (obj.selectedByName ?? undefined) : undefined}
                  zoomScale={viewport.scale}
                />
                <AnchorPoints
                  width={obj.width}
                  height={obj.height}
                  visible={showAnchors}
                  zoomScale={viewport.scale}
                  objectType={obj.type}
                  onAnchorMouseDown={(anchor) => handleAnchorMouseDown(obj.id, anchor)}
                  onAnchorMouseUp={(anchor) => handleAnchorMouseUp(obj.id, anchor)}
                />
                {isSelected && !isMultiSelect && (
                  <ResizeHandles
                    width={obj.width}
                    height={obj.height}
                    zoomScale={viewport.scale}
                    objectType={obj.type}
                    onResizeStart={(corner) => handleResizeStart(obj.id, corner)}
                    onResizeMove={(corner, e) => handleResizeMove(obj.id, corner, e)}
                    onResizeEnd={(corner, e) => handleResizeEnd(obj.id, corner, e)}
                  />
                )}
              </Group>
            );
          })}

          {/* Multi-select: single bounding box around entire selection */}
          {selectionBounds && (
            <Rect
              x={selectionBounds.x}
              y={selectionBounds.y}
              width={selectionBounds.width}
              height={selectionBounds.height}
              fill="rgba(74, 124, 89, 0.06)"
              stroke="#4a7c59"
              strokeWidth={2 / viewport.scale}
              dash={[6 / viewport.scale, 3 / viewport.scale]}
              listening={false}
            />
          )}

          {/* Area selection rectangle */}
          {selectionRect && (
            <Rect
              x={Math.min(selectionRect.startX, selectionRect.endX)}
              y={Math.min(selectionRect.startY, selectionRect.endY)}
              width={Math.abs(selectionRect.endX - selectionRect.startX)}
              height={Math.abs(selectionRect.endY - selectionRect.startY)}
              fill="rgba(74, 124, 89, 0.1)"
              stroke="#4a7c59"
              strokeWidth={1 / viewport.scale}
              dash={[4 / viewport.scale, 4 / viewport.scale]}
              listening={false}
            />
          )}
        </Layer>
      </Stage>
    </div>
  );
}
