import { useCallback, useRef } from 'react';
import type React from 'react';
import type Konva from 'konva';
import { useBoardStore, type ToolMode } from '../../lib/store';

const ZOOM_SENSITIVITY = 0.001;
const PAN_THRESHOLD = 3;
/** ms of wheel-idle before Konva + React state are committed */
const ZOOM_COMMIT_DELAY = 80;

export function useBoardViewport(
  containerRef: React.RefObject<HTMLDivElement | null>,
  toolMode: ToolMode = 'select',
  /** Konva stage ref — enables CSS-transform zoom (zero canvas redraws during wheel gesture) */
  stageRef?: React.RefObject<Konva.Stage | null>
) {
  const viewport    = useBoardStore((s) => s.viewport);
  const setViewport = useBoardStore((s) => s.setViewport);

  const isPanning = useRef(false);
  const didPan = useRef(false);
  const startPointer = useRef({ x: 0, y: 0 });
  const lastPointer = useRef({ x: 0, y: 0 });

  // Zoom gesture state
  const pendingWheel = useRef<{ newScale: number; newPos: { x: number; y: number } } | null>(null);
  const wheelTimerId = useRef<number | null>(null);
  /** Throttle CSS transform updates to once per frame during rapid wheel events */
  const wheelRAFId = useRef<number | null>(null);

  /**
   * Commit any in-flight zoom gesture synchronously.
   * Called on every Stage mousedown so interactions always use the final canvas state.
   */
  const commitZoom = useCallback(() => {
    const p = pendingWheel.current;
    if (!p) return;
    if (wheelTimerId.current !== null) { window.clearTimeout(wheelTimerId.current); wheelTimerId.current = null; }
    if (wheelRAFId.current !== null) { cancelAnimationFrame(wheelRAFId.current); wheelRAFId.current = null; }
    pendingWheel.current = null;

    const stageNode = stageRef?.current;
    const cont = stageNode?.container();
    if (stageNode) {
      stageNode.scaleX(p.newScale);
      stageNode.scaleY(p.newScale);
      stageNode.x(p.newPos.x);
      stageNode.y(p.newPos.y);
    }
    if (cont) { cont.style.transform = ''; cont.style.transformOrigin = ''; }
    if (stageNode) stageNode.batchDraw();
    setViewport({ x: p.newPos.x, y: p.newPos.y, scale: p.newScale });
  }, [stageRef, setViewport]);

  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      const container = containerRef.current;
      if (!container) return;

      const stage = stageRef?.current;

      // Committed Konva state — stable during the gesture (we don't call stage.scaleX() mid-gesture).
      const committedScale = stage ? stage.scaleX() : useBoardStore.getState().viewport.scale;
      const committedX     = stage ? stage.x()      : useBoardStore.getState().viewport.x;
      const committedY     = stage ? stage.y()      : useBoardStore.getState().viewport.y;

      // Compound across multiple wheel events within the same gesture.
      const prevPending  = pendingWheel.current;
      const currentScale = prevPending?.newScale  ?? committedScale;
      const currentX     = prevPending?.newPos.x  ?? committedX;
      const currentY     = prevPending?.newPos.y  ?? committedY;

      const rect    = container.getBoundingClientRect();
      const scaleBy = 1 + Math.abs(e.evt.deltaY) * ZOOM_SENSITIVITY;
      const newScale = e.evt.deltaY > 0 ? currentScale / scaleBy : currentScale * scaleBy;

      const mousePointTo = {
        x: (e.evt.clientX - rect.left - currentX) / currentScale,
        y: (e.evt.clientY - rect.top  - currentY) / currentScale,
      };
      const newPos = {
        x: e.evt.clientX - rect.left - mousePointTo.x * newScale,
        y: e.evt.clientY - rect.top  - mousePointTo.y * newScale,
      };

      // Accumulate desired state; apply CSS transform at most once per animation frame.
      pendingWheel.current = { newScale, newPos };
      if (wheelRAFId.current == null) {
        wheelRAFId.current = requestAnimationFrame(() => {
          wheelRAFId.current = null;
          const p = pendingWheel.current;
          if (!p || !stage) return;
          // CSS matrix: maps committed canvas pixels to their new visual positions.
          // Committed state hasn't changed (we're not calling stage.scaleX() during gesture).
          const cssScale = p.newScale / committedScale;
          const tx = p.newPos.x - committedX * cssScale;
          const ty = p.newPos.y - committedY * cssScale;
          const cont = stage.container();
          if (cont) {
            cont.style.transformOrigin = '0 0';
            cont.style.transform = `matrix(${cssScale},0,0,${cssScale},${tx},${ty})`;
          }
        });
      }

      // Commit Konva + React state once the wheel gesture has been idle for ZOOM_COMMIT_DELAY ms.
      if (wheelTimerId.current !== null) window.clearTimeout(wheelTimerId.current);
      wheelTimerId.current = window.setTimeout(() => {
        wheelTimerId.current = null;
        const p = pendingWheel.current;
        if (!p) return;
        pendingWheel.current = null;
        if (wheelRAFId.current !== null) { cancelAnimationFrame(wheelRAFId.current); wheelRAFId.current = null; }

        const stageNode = stageRef?.current;
        const cont = stageNode?.container();
        if (stageNode) {
          stageNode.scaleX(p.newScale);
          stageNode.scaleY(p.newScale);
          stageNode.x(p.newPos.x);
          stageNode.y(p.newPos.y);
        }
        if (cont) { cont.style.transform = ''; cont.style.transformOrigin = ''; }
        if (stageNode) stageNode.batchDraw();
        setViewport({ x: p.newPos.x, y: p.newPos.y, scale: p.newScale });
      }, ZOOM_COMMIT_DELAY);
    },
    [setViewport, containerRef, stageRef]
  );

  const handleStageMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // Always commit any pending zoom before processing interactions — keeps hit testing correct.
      commitZoom();
      if (toolMode === 'move' || e.evt.button === 1) {
        isPanning.current = true;
        didPan.current = false;
        startPointer.current = { x: e.evt.clientX, y: e.evt.clientY };
        lastPointer.current  = { x: e.evt.clientX, y: e.evt.clientY };
      }
    },
    [toolMode, commitZoom]
  );

  // Pan uses standard RAF-throttled setViewport (no CSS transform).
  // CSS transform pan caused rendering glitches: hover events fired at stale Konva positions
  // during the gesture, which triggered React re-renders that wrote old viewport.x back to Stage.
  const pendingUpdate = useRef<{ dx: number; dy: number } | null>(null);
  const rafId = useRef<number | null>(null);

  const flushViewportUpdate = useCallback(() => {
    rafId.current = null;
    const pending = pendingUpdate.current;
    if (!pending) return;
    pendingUpdate.current = null;
    const { viewport: prev } = useBoardStore.getState();
    setViewport({ x: prev.x + pending.dx, y: prev.y + pending.dy });
  }, [setViewport]);

  const handleStageMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!isPanning.current) return;
      const dx = e.evt.clientX - lastPointer.current.x;
      const dy = e.evt.clientY - lastPointer.current.y;
      lastPointer.current = { x: e.evt.clientX, y: e.evt.clientY };

      const totalDx = e.evt.clientX - startPointer.current.x;
      const totalDy = e.evt.clientY - startPointer.current.y;
      if (Math.abs(totalDx) > PAN_THRESHOLD || Math.abs(totalDy) > PAN_THRESHOLD) {
        didPan.current = true;
      }

      if (pendingUpdate.current) {
        pendingUpdate.current.dx += dx;
        pendingUpdate.current.dy += dy;
      } else {
        pendingUpdate.current = { dx, dy };
        rafId.current = requestAnimationFrame(flushViewportUpdate);
      }
    },
    [flushViewportUpdate]
  );

  const handleStageMouseUp = useCallback(() => {
    isPanning.current = false;
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    const pending = pendingUpdate.current;
    if (pending) {
      pendingUpdate.current = null;
      const { viewport: prev } = useBoardStore.getState();
      setViewport({ x: prev.x + pending.dx, y: prev.y + pending.dy });
    }
  }, [setViewport]);

  const getPointerPosition = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      const stage = e.target.getStage();
      if (!stage) return null;
      const transform = stage.getAbsoluteTransform().copy().invert();
      const pos = stage.getPointerPosition();
      if (!pos) return null;
      return transform.point(pos);
    },
    []
  );

  return {
    viewport,
    handleWheel,
    handleStageMouseDown,
    handleStageMouseMove,
    handleStageMouseUp,
    getPointerPosition,
    didPan,
  };
}
