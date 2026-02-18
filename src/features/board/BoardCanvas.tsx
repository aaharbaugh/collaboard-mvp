import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import { Stage, Layer, Group, Arrow, Rect, Transformer } from 'react-konva';
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
  TEXT_DEFAULTS,
  SHAPE_DEFAULTS,
  FRAME_DEFAULTS,
  DEFAULT_OBJECT_COLORS,
} from '../../lib/constants';
import type { BoardObject as BoardObjectType, AnchorPosition } from '../../types/board';
import { getAnchorWorldPoint } from './utils/anchorPoint';

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
  const frameDragFrameIdRef = useRef<string | null>(null);
  const frameDragRAFRef = useRef<number | null>(null);
  const frameDragDeltasRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const [frameDragPositions, setFrameDragPositions] = useState<Map<string, { x: number; y: number }> | null>(null);
  const objectNodeRefs = useRef<Map<string, Konva.Group>>(new Map());
  const resizeStart = useRef<{ objId: string; x: number; y: number; w: number; h: number } | null>(null);
  /** When resizing a frame, snapshot of children x,y,width,height at resize start */
  const resizeFrameChildrenStart = useRef<Map<string, { x: number; y: number; width: number; height: number }>>(new Map());
  const connectionJustCompleted = useRef(false);
  const transformerRef = useRef<Konva.Transformer>(null);
  const [transformVersion, setTransformVersion] = useState(0);
  const transformRAFRef = useRef<number | null>(null);

  const allObjects = useMemo(() => Object.values(objects), [objects]);
  const backObjects = useMemo(() => allObjects.filter((obj) => obj.sentToBack === true), [allObjects]);
  const frontObjects = useMemo(() => allObjects.filter((obj) => obj.sentToBack !== true), [allObjects]);

  const isMultiSelect = selectedIds.length > 1;
  /**
   * Bounding box for the multi-select highlight rect.
   *
   * Strategy: compute the AABB from STORED (Firebase) object positions so the
   * box center matches the Transformer's pivot point. Then read the live rotation
   * DELTA from one representative Konva node (all selected nodes rotate by the
   * same delta during a Transformer gesture) and apply only that delta as the
   * box rotation. This makes the dashed rect visually rotate in lock-step with
   * the Transformer, around the same center, without any double-rotation artifact.
   */
  const selectionBox = useMemo(() => {
    if (!isMultiSelect) return null;
    const selected = selectedIds.map((id) => objects[id]).filter(Boolean) as BoardObjectType[];
    if (selected.length === 0) return null;

    // AABB from stored positions/rotations (the "initial" box before any live delta)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const obj of selected) {
      const w = obj.width;
      const h = obj.height;
      const cx = obj.x + w / 2;
      const cy = obj.y + h / 2;
      const rot = obj.rotation ?? 0;
      const rad = (rot * Math.PI) / 180;
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      for (const p of [
        { x: -w / 2, y: -h / 2 },
        { x: w / 2, y: -h / 2 },
        { x: w / 2, y: h / 2 },
        { x: -w / 2, y: h / 2 },
      ]) {
        const wx = cx + p.x * c - p.y * s;
        const wy = cy + p.x * s + p.y * c;
        minX = Math.min(minX, wx);
        minY = Math.min(minY, wy);
        maxX = Math.max(maxX, wx);
        maxY = Math.max(maxY, wy);
      }
    }

    const width = maxX - minX;
    const height = maxY - minY;
    const x = minX;
    const y = minY;

    // Live rotation delta: all objects rotate by the same angle during a single
    // Transformer gesture, so use the first selected object as representative.
    const firstObj = selected[0];
    const firstNode = objectNodeRefs.current.get(firstObj.id);
    const storedRot = firstObj.rotation ?? 0;
    const liveRot = firstNode ? firstNode.rotation() : storedRot;
    const rotation = liveRot - storedRot;

    return { x, y, width, height, rotation };
  }, [isMultiSelect, selectedIds, objects, transformVersion]);

  /**
   * Objects with live positions/rotations read directly from Konva node refs.
   * Re-computed on every transformVersion bump (each RAF during rotation) so
   * ConnectionLine endpoints follow the object in real-time without waiting for
   * a Firebase round-trip. Falls back to store data for non-transformed objects.
   */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const liveObjects = useMemo(() => {
    const result: Record<string, BoardObjectType> = {};
    for (const [id, obj] of Object.entries(objects)) {
      const node = objectNodeRefs.current.get(id);
      if (node) {
        result[id] = {
          ...obj,
          x: node.x() - obj.width / 2,
          y: node.y() - obj.height / 2,
          rotation: node.rotation(),
        };
      } else {
        result[id] = obj;
      }
    }
    return result;
  // objectNodeRefs.current is a mutable ref read intentionally for live Konva node state
  }, [objects, transformVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearSelection = useCallback(() => {
    const ids = useBoardStore.getState().selectedIds;
    ids.forEach((id) => {
      updateObject(id, { selectedBy: null, selectedByName: null });
    });
    setSelection([]);
    setSelectedConnectionId(null);
    if (transformRAFRef.current != null) {
      cancelAnimationFrame(transformRAFRef.current);
      transformRAFRef.current = null;
    }
    setTransformVersion(0);
  }, [updateObject, setSelection]);

  // Drop selector/transform state when no longer multi-select (deselect or single selection)
  useEffect(() => {
    if (selectedIds.length <= 1) {
      if (transformRAFRef.current != null) {
        cancelAnimationFrame(transformRAFRef.current);
        transformRAFRef.current = null;
      }
      setTransformVersion(0);
    }
  }, [selectedIds.length]);

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
        } else if (toolMode === 'text') {
          createObject({
            ...base,
            type: 'text',
            width: TEXT_DEFAULTS.width / scale,
            height: TEXT_DEFAULTS.height / scale,
            color: DEFAULT_OBJECT_COLORS.text,
            text: 'Text',
            headingLevel: 1,
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
        } else if (toolMode === 'star') {
          createObject({
            ...base,
            type: 'star',
            width: SHAPE_DEFAULTS.width / scale,
            height: SHAPE_DEFAULTS.height / scale,
            color: DEFAULT_OBJECT_COLORS.star,
          });
        } else if (toolMode === 'frame') {
          createObject({
            ...base,
            type: 'frame',
            width: FRAME_DEFAULTS.width / scale,
            height: FRAME_DEFAULTS.height / scale,
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
      if (obj.type === 'stickyNote' || obj.type === 'text') {
        onStickyNoteDoubleClick?.(obj.id);
      }
    },
    [onStickyNoteDoubleClick]
  );

  const handleObjectDragStart = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>, id: string) => {
      const currentSelectedIds = useBoardStore.getState().selectedIds;
      if (!currentSelectedIds.includes(id)) return;
      const draggedObj = objects[id];
      // Snapshot start center positions (groups use center for position when rotating)
      const positions = new Map<string, { x: number; y: number }>();
      currentSelectedIds.forEach((sid) => {
        const obj = objects[sid];
        if (obj) positions.set(sid, { x: obj.x + obj.width / 2, y: obj.y + obj.height / 2 });
      });
      if (draggedObj?.type === 'frame') {
        allObjects.forEach((obj) => {
          if (obj.frameId === id && !positions.has(obj.id)) {
            positions.set(obj.id, { x: obj.x + obj.width / 2, y: obj.y + obj.height / 2 });
          }
        });
      }
      positions.set(id, { x: e.target.x(), y: e.target.y() });
      // Use actual node positions when refs exist so we stay in sync with what's on screen (avoids store/Firebase lag)
      positions.forEach((_pos, sid) => {
        const node = objectNodeRefs.current.get(sid);
        if (node) positions.set(sid, { x: node.x(), y: node.y() });
      });
      groupDragStartPositions.current = positions;
      const isFrameDrag = draggedObj?.type === 'frame';
      frameDragFrameIdRef.current = isFrameDrag ? id : null;
      if (isFrameDrag) {
        setFrameDragPositions(new Map(positions));
      } else {
        setFrameDragPositions(null);
      }
    },
    [objects, allObjects]
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

      if (frameDragFrameIdRef.current) {
        frameDragDeltasRef.current = { dx, dy };
        if (frameDragRAFRef.current == null) {
          frameDragRAFRef.current = requestAnimationFrame(() => {
            frameDragRAFRef.current = null;
            const { dx: ddx, dy: ddy } = frameDragDeltasRef.current;
            const next = new Map<string, { x: number; y: number }>();
            startPositions.forEach((pos, sid) => {
              next.set(sid, { x: pos.x + ddx, y: pos.y + ddy });
            });
            setFrameDragPositions(next);
          });
        }
      }
    },
    []
  );

  const handleObjectDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>, id: string) => {
      const startPositions = groupDragStartPositions.current;
      const dx = startPositions.get(id)
        ? e.target.x() - startPositions.get(id)!.x
        : 0;
      const dy = startPositions.get(id)
        ? e.target.y() - startPositions.get(id)!.y
        : 0;

      if (startPositions.size > 1) {
        const draggedObj = objects[id];
        const isFrameDrag = draggedObj?.type === 'frame';

        startPositions.forEach((pos, sid) => {
          const newCenterX = pos.x + dx;
          const newCenterY = pos.y + dy;
          const obj = objects[sid];
          if (!obj) return;
          const newX = newCenterX - obj.width / 2;
          const newY = newCenterY - obj.height / 2;
          let patch: { x: number; y: number; frameId?: string } = { x: newX, y: newY };

          if (isFrameDrag) {
            if (obj.type === 'frame') {
              // Frame itself: only position
            } else if (obj.frameId === id) {
              patch.frameId = id;
            }
          } else if (obj.type !== 'frame') {
            const objRight = newX + obj.width;
            const objBottom = newY + obj.height;
            const overlapsFrame = (o: BoardObjectType) =>
              o.type === 'frame' &&
              o.id !== sid &&
              newX < o.x + o.width &&
              objRight > o.x &&
              newY < o.y + o.height &&
              objBottom > o.y;
            const overlappingFrames = allObjects.filter(overlapsFrame);
            const stillInCurrentFrame = obj.frameId && overlappingFrames.some((f) => f.id === obj.frameId);
            if (stillInCurrentFrame) {
              patch.frameId = obj.frameId;
            } else if (obj.frameId && !overlappingFrames.some((f) => f.id === obj.frameId)) {
              patch.frameId = undefined;
            } else if (overlappingFrames.length > 0) {
              patch.frameId = overlappingFrames[0].id;
            } else {
              patch.frameId = undefined;
            }
          }
          updateObject(sid, patch);
        });
      } else {
        const newCenterX = e.target.x();
        const newCenterY = e.target.y();
        const obj = objects[id];
        if (!obj) return;
        const newX = newCenterX - obj.width / 2;
        const newY = newCenterY - obj.height / 2;
        if (obj.type !== 'frame') {
          const objRight = newX + obj.width;
          const objBottom = newY + obj.height;
          const overlapsFrame = (o: BoardObjectType) =>
            o.type === 'frame' &&
            o.id !== id &&
            newX < o.x + o.width &&
            objRight > o.x &&
            newY < o.y + o.height &&
            objBottom > o.y;
          const overlappingFrames = allObjects.filter(overlapsFrame);
          const stillInCurrentFrame = obj.frameId && overlappingFrames.some((f) => f.id === obj.frameId);
          const patch: { x: number; y: number; frameId?: string } = { x: newX, y: newY };
          if (stillInCurrentFrame) {
            patch.frameId = obj.frameId;
          } else if (obj.frameId && !overlappingFrames.some((f) => f.id === obj.frameId)) {
            patch.frameId = undefined;
          } else if (overlappingFrames.length > 0) {
            patch.frameId = overlappingFrames[0].id;
          } else {
            patch.frameId = undefined;
          }
          updateObject(id, patch);
        } else {
          updateObject(id, { x: newX, y: newY });
        }
      }
      groupDragStartPositions.current = new Map();
      frameDragFrameIdRef.current = null;
      if (frameDragRAFRef.current != null) {
        cancelAnimationFrame(frameDragRAFRef.current);
        frameDragRAFRef.current = null;
      }
      setFrameDragPositions(null);
    },
    [updateObject, objects, allObjects]
  );

  const handleResizeStart = useCallback(
    (objId: string, _corner: string) => {
      const obj = objects[objId];
      if (!obj) return;
      const frameNode = objectNodeRefs.current.get(objId);
      const frameX = frameNode ? frameNode.x() - obj.width / 2 : obj.x;
      const frameY = frameNode ? frameNode.y() - obj.height / 2 : obj.y;
      resizeStart.current = { objId, x: frameX, y: frameY, w: obj.width, h: obj.height };
      if (obj.type === 'frame') {
        const children = new Map<string, { x: number; y: number; width: number; height: number }>();
        allObjects.forEach((o) => {
          if (o.frameId === objId) {
            const node = objectNodeRefs.current.get(o.id);
            const x = node ? node.x() - o.width / 2 : o.x;
            const y = node ? node.y() - o.height / 2 : o.y;
            children.set(o.id, { x, y, width: o.width, height: o.height });
          }
        });
        resizeFrameChildrenStart.current = children;
      } else {
        resizeFrameChildrenStart.current = new Map();
      }
    },
    [objects, allObjects]
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

      // When resizing a frame, scale children so they move and resize with the frame
      const obj = objects[objId];
      if (obj?.type === 'frame' && start.w > 0 && start.h > 0) {
        resizeFrameChildrenStart.current.forEach((childStart, childId) => {
          const relX = (childStart.x - start.x) / start.w;
          const relY = (childStart.y - start.y) / start.h;
          const relW = childStart.width / start.w;
          const relH = childStart.height / start.h;
          updateObject(childId, {
            x: newX + relX * newW,
            y: newY + relY * newH,
            width: relW * newW,
            height: relH * newH,
          });
        });
      }
    },
    [updateObject, viewport.scale, objects]
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

  // Attach Konva Transformer to selected node(s) for rotation (defer so refs are set after paint)
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    const raf = requestAnimationFrame(() => {
      const nodes = selectedIds
        .map((id) => objectNodeRefs.current.get(id))
        .filter((n): n is Konva.Group => n != null);
      tr.nodes(nodes);
    });
    return () => cancelAnimationFrame(raf);
  }, [selectedIds]);

  const handleTransformerTransform = useCallback(() => {
    if (transformRAFRef.current != null) return;
    transformRAFRef.current = requestAnimationFrame(() => {
      setTransformVersion((v) => v + 1);
      transformRAFRef.current = null;
    });
  }, []);

  const handleTransformerTransformEnd = useCallback(
    (_e: Konva.KonvaEventObject<Event>) => {
      const tr = transformerRef.current;
      if (!tr) return;
      const nodes = tr.nodes();
      nodes.forEach((node) => {
        const id = selectedIds.find((sid) => objectNodeRefs.current.get(sid) === node);
        if (!id) return;
        const obj = objects[id];
        if (!obj) return;
        const cx = node.x();
        const cy = node.y();
        updateObject(id, {
          x: cx - obj.width / 2,
          y: cy - obj.height / 2,
          rotation: node.rotation(),
        });
      });
      setTransformVersion((v) => v + 1);
    },
    [selectedIds, objects, updateObject]
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
                // Find nearest anchor (star has 5 points; circle 4; rect 8)
                const anchorPositions: AnchorPosition[] =
                  obj.type === 'star'
                    ? ['star-0', 'star-1', 'star-2', 'star-3', 'star-4']
                    : obj.type === 'circle'
                      ? ['top', 'bottom', 'left', 'right']
                      : ['top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
                let bestAnchor: AnchorPosition = anchorPositions[0];
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
          const obj = objects[id];
          if (obj?.type === 'frame') {
            allObjects.forEach((o) => {
              if (o.frameId === id) updateObject(o.id, { frameId: undefined });
            });
          }
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
          const { frameId: _f, ...rest } = obj;
          createObject({
            ...rest,
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

  // Compute the in-progress arrow points (use liveObjects so the start anchor
  // stays glued to the object edge even while that object is being rotated)
  let drawingArrowPoints: number[] | null = null;
  if (drawingConnection) {
    const fromObj = liveObjects[drawingConnection.fromId];
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
            const dragPos = frameDragPositions?.get(obj.id);
            const cx = dragPos ? dragPos.x : obj.x + obj.width / 2;
            const cy = dragPos ? dragPos.y : obj.y + obj.height / 2;
            return (
              <Group
                key={obj.id}
                ref={(node) => {
                  if (node) objectNodeRefs.current.set(obj.id, node);
                  else objectNodeRefs.current.delete(obj.id);
                }}
                x={cx}
                y={cy}
                offsetX={obj.width / 2}
                offsetY={obj.height / 2}
                rotation={obj.rotation ?? 0}
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
              objects={liveObjects}
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
            const dragPos = frameDragPositions?.get(obj.id);
            const cx = dragPos ? dragPos.x : obj.x + obj.width / 2;
            const cy = dragPos ? dragPos.y : obj.y + obj.height / 2;
            return (
              <Group
                key={obj.id}
                ref={(node) => {
                  if (node) objectNodeRefs.current.set(obj.id, node);
                  else objectNodeRefs.current.delete(obj.id);
                }}
                x={cx}
                y={cy}
                offsetX={obj.width / 2}
                offsetY={obj.height / 2}
                rotation={obj.rotation ?? 0}
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

          {/* Rotation handle: fixed screen pixels so it stays same size at any zoom (Transformer uses screen space for anchors) */}
          {selectedIds.length > 0 && (
            <Transformer
              ref={transformerRef}
              resizeEnabled={false}
              rotateEnabled={true}
              rotateAnchorCursor="grab"
              rotateLineVisible={false}
              rotateAnchorOffset={8}
              borderStrokeWidth={0}
              anchorSize={10}
              anchorStroke="#fff"
              anchorFill="#4a7c59"
              anchorStrokeWidth={1}
              onTransform={handleTransformerTransform}
              onTransformEnd={handleTransformerTransformEnd}
            />
          )}

          {/* Multi-select: temporary “selector” object – same Group/offset/rotation as real objects so it’s centered and rotates */}
          {selectionBox && (
            <Group
              x={selectionBox.x + selectionBox.width / 2}
              y={selectionBox.y + selectionBox.height / 2}
              offsetX={selectionBox.width / 2}
              offsetY={selectionBox.height / 2}
              rotation={selectionBox.rotation}
              listening={false}
            >
              <Rect
                x={0}
                y={0}
                width={selectionBox.width}
                height={selectionBox.height}
                fill="rgba(74, 124, 89, 0.06)"
                stroke="#4a7c59"
                strokeWidth={2 / viewport.scale}
                dash={[6 / viewport.scale, 3 / viewport.scale]}
                listening={false}
              />
            </Group>
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
