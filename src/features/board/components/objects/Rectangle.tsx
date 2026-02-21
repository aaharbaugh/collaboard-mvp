import { Group, Rect, Text } from 'react-konva';
import type { BoardObject } from '../../../../types/board';
import { CURSOR_COLORS, DEFAULT_OBJECT_COLORS } from '../../../../lib/constants';

interface RectangleProps {
  obj: BoardObject;
  isSelected: boolean;
  showSelectionBorder?: boolean;
  remoteSelectedBy?: string;
  zoomScale?: number;
}

export function Rectangle({ obj, isSelected, showSelectionBorder = true, remoteSelectedBy, zoomScale = 1 }: RectangleProps) {
  const color = obj.color ?? DEFAULT_OBJECT_COLORS.rectangle;
  const remoteColor = remoteSelectedBy
    ? CURSOR_COLORS[remoteSelectedBy.length % CURSOR_COLORS.length]
    : undefined;

  const sw = 2 / zoomScale;
  const hasStroke = (showSelectionBorder && isSelected) || !!remoteSelectedBy;

  return (
    <Group>
      <Rect
        x={obj.x}
        y={obj.y}
        width={obj.width}
        height={obj.height}
        fill={color}
        stroke={showSelectionBorder && isSelected ? '#4a7c59' : remoteColor ?? undefined}
        strokeWidth={hasStroke ? sw : 0}
        dash={showSelectionBorder && isSelected ? [6 / zoomScale, 3 / zoomScale] : undefined}
      />
      {remoteSelectedBy && (
        <Text
          x={obj.x}
          y={obj.y - 16 / zoomScale}
          text={remoteSelectedBy}
          fontSize={10 / zoomScale}
          fontFamily='"Courier New", Courier, monospace'
          fill={remoteColor}
        />
      )}
    </Group>
  );
}
