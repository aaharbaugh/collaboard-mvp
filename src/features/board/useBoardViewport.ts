import { useCallback, useRef } from 'react';
import type Konva from 'konva';
import { useBoardStore, type ToolMode } from '../../lib/store';

const ZOOM_SENSITIVITY = 0.001;
const PAN_THRESHOLD = 3;

export function useBoardViewport(
  containerRef: React.RefObject<HTMLDivElement | null>,
  toolMode: ToolMode = 'select'
) {
  const { viewport, setViewport } = useBoardStore();
  const isPanning = useRef(false);
  const didPan = useRef(false);
  const startPointer = useRef({ x: 0, y: 0 });
  const lastPointer = useRef({ x: 0, y: 0 });

  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const scaleBy = 1 + Math.abs(e.evt.deltaY) * ZOOM_SENSITIVITY;
      const newScale =
        e.evt.deltaY > 0 ? viewport.scale / scaleBy : viewport.scale * scaleBy;

      const mousePointTo = {
        x: (e.evt.clientX - rect.left - viewport.x) / viewport.scale,
        y: (e.evt.clientY - rect.top - viewport.y) / viewport.scale,
      };
      const newPos = {
        x: e.evt.clientX - rect.left - mousePointTo.x * newScale,
        y: e.evt.clientY - rect.top - mousePointTo.y * newScale,
      };

      setViewport({ x: newPos.x, y: newPos.y, scale: newScale });
    },
    [viewport, setViewport, containerRef]
  );

  const handleStageMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (toolMode === 'move' || e.evt.button === 1) {
        isPanning.current = true;
        didPan.current = false;
        startPointer.current = { x: e.evt.clientX, y: e.evt.clientY };
        lastPointer.current = { x: e.evt.clientX, y: e.evt.clientY };
      }
    },
    [toolMode]
  );

  const handleStageMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!isPanning.current) return;
      const dx = e.evt.clientX - lastPointer.current.x;
      const dy = e.evt.clientY - lastPointer.current.y;
      setViewport({ x: viewport.x + dx, y: viewport.y + dy });
      lastPointer.current = { x: e.evt.clientX, y: e.evt.clientY };

      // Mark as a real pan if moved beyond threshold
      const totalDx = e.evt.clientX - startPointer.current.x;
      const totalDy = e.evt.clientY - startPointer.current.y;
      if (Math.abs(totalDx) > PAN_THRESHOLD || Math.abs(totalDy) > PAN_THRESHOLD) {
        didPan.current = true;
      }
    },
    [viewport, setViewport]
  );

  const handleStageMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

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
