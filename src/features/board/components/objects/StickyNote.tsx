import { Group, Rect, Text } from 'react-konva';
import type { BoardObject } from '../../../../types/board';
import { CURSOR_COLORS } from '../../../../lib/constants';
import { parseLines, computeAutoFitFontSize, getWrappedLines, LINE_HEIGHT_RATIO } from '../../../../lib/textParser';

interface StickyNoteProps {
  obj: BoardObject;
  isSelected: boolean;
  showSelectionBorder?: boolean;
  remoteSelectedBy?: string;
  zoomScale?: number;
}

export function StickyNote({ obj, isSelected, showSelectionBorder = true, remoteSelectedBy, zoomScale = 1 }: StickyNoteProps) {
  const color = obj.color ?? '#f5e6ab';
  const remoteColor = remoteSelectedBy
    ? CURSOR_COLORS[remoteSelectedBy.length % CURSOR_COLORS.length]
    : undefined;

  const sw = 2 / zoomScale;
  const hasStroke = (showSelectionBorder && isSelected) || !!remoteSelectedBy;

  const rawText = obj.text ?? '';
  const w = Math.max(0, obj.width);
  const h = Math.max(0, obj.height);
  const scale = Math.max(1e-10, zoomScale);

  // Compute in screen pixels — identical to TextEditingOverlay.
  const screenW = w * scale;
  const screenH = h * scale;
  const { fontSize: screenFontSize, padding: screenPadding } = computeAutoFitFontSize(
    rawText,
    Math.max(1, screenW),
    Math.max(1, screenH),
  );
  const screenAvailW = Math.max(1, screenW - screenPadding * 2);
  const screenAvailH = Math.max(1, screenH - screenPadding * 2);
  const parsed = parseLines(rawText);
  const displayText = parsed.map((l) => l.text).join('\n');
  const wrappedLines = getWrappedLines(displayText, screenAvailW, screenFontSize);
  const hasContent = displayText.length > 0;
  const showText = screenW >= 1 && screenH >= 1 && hasContent && Number.isFinite(screenFontSize) && screenFontSize > 0;

  const screenLineHeight = screenFontSize * LINE_HEIGHT_RATIO;
  const maxLinesThatFit = screenLineHeight > 0 ? Math.max(1, Math.floor(screenAvailH / screenLineHeight)) : 1;
  const visibleLines = wrappedLines.slice(0, maxLinesThatFit);

  // Inverse scale factor: text Group renders in screen pixels so canvas gets a real font size,
  // then this inverse scale converts back to world coords for the stage transform.
  const invScale = 1 / scale;

  return (
    <Group
      x={obj.x}
      y={obj.y}
      width={w}
      height={h}
      rotation={obj.rotation ?? 0}
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
        cornerRadius={2 / zoomScale}
      />
      {showText && (
        <Group x={0} y={0} scaleX={invScale} scaleY={invScale}>
          {visibleLines.map((lineText, i) => (
            <Text
              key={i}
              x={screenPadding}
              y={screenPadding + i * screenLineHeight}
              width={screenAvailW}
              text={lineText}
              fontSize={screenFontSize}
              fontFamily='"Courier New", Courier, monospace'
              fill="#2c2416"
            />
          ))}
        </Group>
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
