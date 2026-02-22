import { useRef, useEffect } from 'react';
import { Group, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import type { BoardObject } from '../../../../types/board';
import { CURSOR_COLORS, DEFAULT_OBJECT_COLORS, MIN_RENDER_SCREEN_PX } from '../../../../lib/constants';
import { computeTextLayout, LINE_HEIGHT_RATIO } from '../../../../lib/textParser';
import { PillOverlays } from '../../../wiring/PillOverlays';

interface StickyNoteProps {
  obj: BoardObject;
  isSelected: boolean;
  showSelectionBorder?: boolean;
  remoteSelectedBy?: string;
  zoomScale?: number;
  chainStatus?: 'queued' | 'running' | null;
}

export function StickyNote({ obj, isSelected, showSelectionBorder = true, remoteSelectedBy, zoomScale = 1, chainStatus }: StickyNoteProps) {
  const color = obj.color ?? DEFAULT_OBJECT_COLORS.stickyNote;
  const remoteColor = remoteSelectedBy
    ? CURSOR_COLORS[remoteSelectedBy.length % CURSOR_COLORS.length]
    : undefined;

  const sw = 2 / zoomScale;
  const hasStroke = (showSelectionBorder && isSelected) || !!remoteSelectedBy;

  const pills = obj.pills ?? [];
  const isPromptNode = pills.length > 0 || !!obj.promptTemplate;
  const isApiNode = !!obj.apiConfig;
  const accentColor = isApiNode ? '#4a7c59' : '#6b8e9b';
  // Prompt nodes show their template text. Output always goes to a separate result sticky.
  // Non-prompt nodes show promptOutput if they received one via a wire.
  const displayText = isPromptNode ? (obj.text ?? '') : (obj.promptOutput ?? obj.text ?? '');
  const rawText = displayText;
  const w = Math.max(0, obj.width);
  const h = Math.max(0, obj.height);
  const screenW = w * zoomScale;

  const layout = computeTextLayout(rawText, Math.max(1, w), Math.max(1, h), { maxFontSize: 16 });
  const { fontSize, padding, wrappedLines } = layout;
  const lineHeight = fontSize * LINE_HEIGHT_RATIO;

  const hasContent = rawText.length > 0;
  const showText = w >= 1 && h >= 1 && hasContent && Number.isFinite(fontSize) && fontSize > 0;

  // Animated shimmer: marching-ants dashOffset + pulsing overlay
  const isRunning = obj.lastRunStatus === 'running' || chainStatus === 'running';
  const isQueued = chainStatus === 'queued';
  const needsAnimation = isRunning || isQueued;

  const shimmerBorderRef = useRef<Konva.Rect>(null);
  const shimmerOverlayRef = useRef<Konva.Rect>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!needsAnimation) {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    let startTime: number | null = null;
    const animate = (time: number) => {
      if (startTime === null) startTime = time;
      const elapsed = time - startTime;

      const borderNode = shimmerBorderRef.current;
      if (borderNode) {
        // Marching ants: rotate dashOffset over time
        const speed = isRunning ? 40 : 20;
        borderNode.dashOffset(-(elapsed / 1000) * speed / zoomScale);
        borderNode.getLayer()?.batchDraw();
      }

      const overlayNode = shimmerOverlayRef.current;
      if (overlayNode) {
        // Pulsing opacity sweep
        const pulse = isRunning
          ? 0.06 + 0.06 * Math.sin(elapsed / 300)
          : 0.03 + 0.03 * Math.sin(elapsed / 500);
        overlayNode.opacity(pulse);
        overlayNode.getLayer()?.batchDraw();
      }

      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [needsAnimation, isRunning, zoomScale]);

  return (
    <Group
      x={0}
      y={0}
      width={w}
      height={h}
      clipX={needsAnimation ? -4 / zoomScale : 0}
      clipY={needsAnimation ? -4 / zoomScale : 0}
      clipWidth={needsAnimation ? w + 8 / zoomScale : w}
      clipHeight={needsAnimation ? h + 8 / zoomScale : h}
    >
      <Rect
        width={w}
        height={h}
        fill={color}
        stroke={showSelectionBorder && isSelected ? '#4a7c59' : remoteColor ?? undefined}
        strokeWidth={hasStroke ? sw : 0}
        dash={showSelectionBorder && isSelected ? [6 / zoomScale, 3 / zoomScale] : undefined}
      />
      {showText && (
        <>
          {wrappedLines.map((lineText, i) => (
            <Text
              key={i}
              x={padding}
              y={padding + i * lineHeight}
              width={Math.max(1, w - padding * 2)}
              text={lineText}
              fontSize={fontSize}
              fontFamily='"Courier New", Courier, monospace'
              fill="#2c2416"
              wrap="none"
              listening={false}
            />
          ))}
          {pills.length > 0 && (
            <PillOverlays
              wrappedLines={wrappedLines}
              pills={pills}
              fontSize={fontSize}
              padding={padding}
              lineHeight={lineHeight}
              bgColor={color}
              stickyWidth={w}
              stickyHeight={h}
            />
          )}
        </>
      )}
      {/* Smart sticky: top accent bar */}
      {isPromptNode && screenW >= MIN_RENDER_SCREEN_PX && (
        <Rect
          x={0}
          y={0}
          width={w}
          height={Math.max(3 / zoomScale, 3)}
          fill={accentColor}
          cornerRadius={[2 / zoomScale, 2 / zoomScale, 0, 0]}
          listening={false}
        />
      )}
      {/* Smart sticky: bottom accent bar */}
      {isPromptNode && screenW >= MIN_RENDER_SCREEN_PX && (
        <Rect
          x={0}
          y={h - Math.max(3 / zoomScale, 3)}
          width={w}
          height={Math.max(3 / zoomScale, 3)}
          fill={accentColor}
          cornerRadius={[0, 0, 2 / zoomScale, 2 / zoomScale]}
          listening={false}
        />
      )}
      {/* Animated shimmer border: marching-ants for running, subtle for queued */}
      {needsAnimation && screenW >= MIN_RENDER_SCREEN_PX && (
        <Rect
          ref={shimmerBorderRef}
          x={-2 / zoomScale}
          y={-2 / zoomScale}
          width={w + 4 / zoomScale}
          height={h + 4 / zoomScale}
          stroke={isRunning ? '#6b8e9b' : 'rgba(107,142,155,0.6)'}
          strokeWidth={(isRunning ? 2.5 : 1.5) / zoomScale}
          dash={isRunning ? [8 / zoomScale, 4 / zoomScale] : [4 / zoomScale, 4 / zoomScale]}
          listening={false}
        />
      )}
      {/* Pulsing translucent overlay for shimmer effect */}
      {needsAnimation && screenW >= MIN_RENDER_SCREEN_PX && (
        <Rect
          ref={shimmerOverlayRef}
          x={0}
          y={0}
          width={w}
          height={h}
          fill={isRunning ? '#6b8e9b' : '#6b8e9b'}
          opacity={0}
          listening={false}
        />
      )}
      {remoteSelectedBy && (
        <Text
          x={0}
          y={-(16 / zoomScale)}
          text={remoteSelectedBy}
          fontSize={10 / zoomScale}
          fontFamily='"Courier New", Courier, monospace'
          fill={remoteColor}
        />
      )}
    </Group>
  );
}
