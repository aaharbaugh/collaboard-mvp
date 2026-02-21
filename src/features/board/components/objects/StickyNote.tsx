import { Group, Rect, Text } from 'react-konva';
import type { BoardObject } from '../../../../types/board';
import { CURSOR_COLORS, DEFAULT_OBJECT_COLORS, MIN_RENDER_SCREEN_PX, MIN_READABLE_FONT_SCREEN_PX, FLOOR_READABLE_FONT_SCREEN_PX } from '../../../../lib/constants';
import { computeTextLayout, LINE_HEIGHT_RATIO } from '../../../../lib/textParser';

interface StickyNoteProps {
  obj: BoardObject;
  isSelected: boolean;
  showSelectionBorder?: boolean;
  remoteSelectedBy?: string;
  zoomScale?: number;
}

export function StickyNote({ obj, isSelected, showSelectionBorder = true, remoteSelectedBy, zoomScale = 1 }: StickyNoteProps) {
  const color = obj.color ?? DEFAULT_OBJECT_COLORS.stickyNote;
  const remoteColor = remoteSelectedBy
    ? CURSOR_COLORS[remoteSelectedBy.length % CURSOR_COLORS.length]
    : undefined;

  const sw = 2 / zoomScale;
  const hasStroke = (showSelectionBorder && isSelected) || !!remoteSelectedBy;

  const rawText = obj.text ?? '';
  const w = Math.max(0, obj.width);
  const h = Math.max(0, obj.height);
  const scale = Math.max(1e-10, zoomScale);
  const screenW = w * scale;
  const screenH = h * scale;

  const layout = computeTextLayout(
    rawText,
    Math.max(1, w),
    Math.max(1, h),
    {
      minFontSize: MIN_READABLE_FONT_SCREEN_PX / scale,
      floorFontSize: FLOOR_READABLE_FONT_SCREEN_PX / scale,
    },
  );
  const { fontSize, padding, wrappedLines } = layout;
  const lineHeight = fontSize * LINE_HEIGHT_RATIO;
  const availH = Math.max(1, h - padding * 2);
  // Use small tolerance so we don't drop the last line to floating-point (layout already fits all)
  const maxLinesThatFit =
    lineHeight > 0
      ? Math.min(wrappedLines.length, Math.max(1, Math.floor((availH + 0.5) / lineHeight)))
      : wrappedLines.length;
  const visibleLines = wrappedLines.slice(0, maxLinesThatFit);

  const bigEnoughToRender = screenW >= MIN_RENDER_SCREEN_PX && screenH >= MIN_RENDER_SCREEN_PX && fontSize >= 0.5;
  const hasContent = rawText.length > 0;
  const showText = bigEnoughToRender && w >= 1 && h >= 1 && hasContent && Number.isFinite(fontSize) && fontSize > 0;

  return (
    <Group
      x={0}
      y={0}
      width={w}
      height={h}
      clipX={0}
      clipY={0}
      clipWidth={w}
      clipHeight={h}
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
          {visibleLines.map((lineText, i) => (
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
        </>
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
