import { Group, Rect, Text } from 'react-konva';
import type { BoardObject } from '../../../../types/board';
import { CURSOR_COLORS } from '../../../../lib/constants';
import { parseLines, computeAutoFitFontSize } from '../../../../lib/textParser';

const TEXT_HIDE_SCALE = 0.05;
const MIN_SCREEN_FONT_PX = 10;
const MIN_FONT_TO_SHOW = 0.2;

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

  const showText = zoomScale >= TEXT_HIDE_SCALE;
  const sw = 2 / zoomScale;
  const hasStroke = (showSelectionBorder && isSelected) || !!remoteSelectedBy;

  const rawText = obj.text ?? '';
  const { fontSize, padding } = computeAutoFitFontSize(rawText, obj.width, obj.height);
  const availW = Math.max(0, obj.width - padding * 2);
  const lines = parseLines(rawText);
  const effectiveFontSize = Math.max(MIN_SCREEN_FONT_PX / zoomScale, fontSize);
  const textFits = effectiveFontSize >= MIN_FONT_TO_SHOW && availW > 0;

  return (
    <Group
      x={obj.x}
      y={obj.y}
      width={obj.width}
      height={obj.height}
      rotation={obj.rotation ?? 0}
      clipX={0}
      clipY={0}
      clipWidth={obj.width}
      clipHeight={obj.height}
    >
      <Rect
        width={obj.width}
        height={obj.height}
        fill={color}
        stroke={showSelectionBorder && isSelected ? '#4a7c59' : remoteColor ?? undefined}
        strokeWidth={hasStroke ? sw : 0}
        dash={showSelectionBorder && isSelected ? [6 / zoomScale, 3 / zoomScale] : undefined}
        cornerRadius={2 / zoomScale}
      />
      {showText && textFits && lines.map((line, i) => (
        <Text
          key={i}
          x={padding}
          y={padding + i * effectiveFontSize * 1.3}
          width={availW}
          text={line.text}
          fontSize={effectiveFontSize}
          fontStyle={line.fontStyle}
          fontFamily='"Courier New", Courier, monospace'
          fill="#2c2416"
          wrap="word"
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
        />
      )}
    </Group>
  );
}
