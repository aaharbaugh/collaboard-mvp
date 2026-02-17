import { Group, Rect, Text } from 'react-konva';
import type { BoardObject } from '../../../../types/board';
import { CURSOR_COLORS } from '../../../../lib/constants';
import { parseLines, computeAutoFitFontSize } from '../../../../lib/textParser';

const TEXT_HIDE_SCALE = 0.15;

interface StickyNoteProps {
  obj: BoardObject;
  isSelected: boolean;
  remoteSelectedBy?: string;
  zoomScale?: number;
}

export function StickyNote({ obj, isSelected, remoteSelectedBy, zoomScale = 1 }: StickyNoteProps) {
  const color = obj.color ?? '#f5e6ab';
  const remoteColor = remoteSelectedBy
    ? CURSOR_COLORS[remoteSelectedBy.length % CURSOR_COLORS.length]
    : undefined;

  const showText = zoomScale >= TEXT_HIDE_SCALE;
  const sw = 2 / zoomScale;
  const hasStroke = isSelected || !!remoteSelectedBy;

  const rawText = obj.text ?? '';
  const { fontSize, padding } = computeAutoFitFontSize(rawText, obj.width, obj.height);
  const availW = obj.width - padding * 2;

  const lines = parseLines(rawText);

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
        stroke={isSelected ? '#4a7c59' : remoteColor ?? undefined}
        strokeWidth={hasStroke ? sw : 0}
        dash={isSelected ? [6 / zoomScale, 3 / zoomScale] : undefined}
        cornerRadius={2 / zoomScale}
      />
      {showText && lines.map((line, i) => (
        <Text
          key={i}
          x={padding}
          y={padding + i * fontSize * 1.3}
          width={availW}
          text={line.text}
          fontSize={fontSize}
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
