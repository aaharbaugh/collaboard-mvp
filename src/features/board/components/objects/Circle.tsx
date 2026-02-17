import { Group, Circle as KonvaCircle, Text } from 'react-konva';
import type { BoardObject } from '../../../../types/board';
import { CURSOR_COLORS } from '../../../../lib/constants';

interface CircleProps {
  obj: BoardObject;
  isSelected: boolean;
  showSelectionBorder?: boolean;
  remoteSelectedBy?: string;
  zoomScale?: number;
}

export function Circle({ obj, isSelected, showSelectionBorder = true, remoteSelectedBy, zoomScale = 1 }: CircleProps) {
  const color = obj.color ?? '#c5d5e8';
  const radius = Math.min(obj.width, obj.height) / 2;
  const remoteColor = remoteSelectedBy
    ? CURSOR_COLORS[remoteSelectedBy.length % CURSOR_COLORS.length]
    : undefined;

  const sw = 2 / zoomScale;
  const hasStroke = (showSelectionBorder && isSelected) || !!remoteSelectedBy;

  return (
    <Group>
      <KonvaCircle
        x={obj.x + obj.width / 2}
        y={obj.y + obj.height / 2}
        radius={radius}
        fill={color}
        stroke={showSelectionBorder && isSelected ? '#4a7c59' : remoteColor ?? undefined}
        strokeWidth={hasStroke ? sw : 0}
        dash={showSelectionBorder && isSelected ? [6 / zoomScale, 3 / zoomScale] : undefined}
      />
      {remoteSelectedBy && (
        <Text
          x={obj.x + obj.width / 2 - 20 / zoomScale}
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
