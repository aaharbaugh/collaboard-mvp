import { Group, Rect, Text } from 'react-konva';
import type { BoardObject } from '../../../../types/board';
import { CURSOR_COLORS, MIN_READABLE_TEXT_SCREEN_PX } from '../../../../lib/constants';
import { parseLines, computeAutoFitFontSize, getWrappedLines, LINE_HEIGHT_RATIO } from '../../../../lib/textParser';

interface TextElementProps {
  obj: BoardObject;
  isSelected: boolean;
  showSelectionBorder?: boolean;
  remoteSelectedBy?: string;
  zoomScale?: number;
}

/** Text element: same as sticky note but with transparent background. No heading/extra features. */
export function TextElement({
  obj,
  isSelected,
  showSelectionBorder = true,
  remoteSelectedBy,
  zoomScale = 1,
}: TextElementProps) {
  if (obj.type !== 'text') return null;

  const remoteColor = remoteSelectedBy
    ? CURSOR_COLORS[remoteSelectedBy.length % CURSOR_COLORS.length]
    : undefined;

  const sw = 2 / zoomScale;
  const hasStroke = (showSelectionBorder && isSelected) || !!remoteSelectedBy;

  const rawText = obj.text ?? '';
  const w = Math.max(0, obj.width);
  const h = Math.max(0, obj.height);

  const { fontSize, padding } = computeAutoFitFontSize(
    rawText,
    Math.max(1, w),
    Math.max(1, h),
  );
  // Optional minimum screen size (0 = no minimum; text scales with zoom)
  const scale = Math.max(1e-10, zoomScale);
  const minWorldFont = MIN_READABLE_TEXT_SCREEN_PX > 0 ? MIN_READABLE_TEXT_SCREEN_PX / scale : 0;
  const displayFontSize = minWorldFont > 0 ? Math.max(fontSize, minWorldFont) : fontSize;
  const isClampedForReadability = displayFontSize > fontSize;

  const availW = Math.max(1, w - padding * 2);
  const availH = Math.max(1, h - padding * 2);
  const parsed = parseLines(rawText);
  const displayText = parsed.map((l) => l.text).join('\n');
  const wrappedLines = getWrappedLines(displayText, availW, displayFontSize);
  const hasContent = displayText.length > 0;
  const showText = w >= 1 && h >= 1 && hasContent && Number.isFinite(displayFontSize) && displayFontSize > 0;

  const lineHeight = displayFontSize * LINE_HEIGHT_RATIO;
  const maxLinesThatFit = lineHeight > 0 ? Math.max(1, Math.floor(availH / lineHeight)) : 1;
  const visibleLines = wrappedLines.slice(0, maxLinesThatFit);

  const textColor = obj.color ?? '#1a1a1a';

  // When text is clamped for readability at small zoom, don't clip so overflow is visible
  const clip = !isClampedForReadability;

  return (
    <Group
      x={obj.x}
      y={obj.y}
      width={w}
      height={h}
      rotation={obj.rotation ?? 0}
      clipX={clip ? 0 : undefined}
      clipY={clip ? 0 : undefined}
      clipWidth={clip ? w : undefined}
      clipHeight={clip ? h : undefined}
    >
      <Rect
        width={w}
        height={h}
        fill="transparent"
        stroke={showSelectionBorder && isSelected ? '#4a7c59' : remoteColor ?? undefined}
        strokeWidth={hasStroke ? sw : 0}
        dash={showSelectionBorder && isSelected ? [6 / zoomScale, 3 / zoomScale] : undefined}
        cornerRadius={2 / zoomScale}
      />
      {showText &&
        visibleLines.map((lineText, i) => (
          <Text
            key={i}
            x={padding}
            y={padding + i * lineHeight}
            width={availW}
            text={lineText}
            fontSize={displayFontSize}
            fontFamily='"Courier New", Courier, monospace'
            fill={textColor}
            listening={false}
          />
        ))}
      {remoteSelectedBy && (
        <Text
          x={0}
          y={-(16 / zoomScale)}
          text={remoteSelectedBy}
          fontSize={10 / zoomScale}
          fontFamily='"Courier New", Courier, monospace'
          fill={remoteColor}
          listening={false}
        />
      )}
    </Group>
  );
}
