import { Group, Star as KonvaStar, Text } from 'react-konva';
import type { BoardObject } from '../../../../types/board';
import { CURSOR_COLORS, DEFAULT_OBJECT_COLORS } from '../../../../lib/constants';

interface StarProps {
  obj: BoardObject;
  isSelected: boolean;
  showSelectionBorder?: boolean;
  remoteSelectedBy?: string;
  zoomScale?: number;
}

export function Star({ obj, isSelected, showSelectionBorder = true, remoteSelectedBy, zoomScale = 1 }: StarProps) {
  const color = obj.color ?? DEFAULT_OBJECT_COLORS.star;
  const size = Math.min(obj.width, obj.height) / 2;
  const cx = obj.x + obj.width / 2;
  const cy = obj.y + obj.height / 2;
  const outerRadius = size;
  const innerRadius = size * 0.4;
  const remoteColor = remoteSelectedBy
    ? CURSOR_COLORS[remoteSelectedBy.length % CURSOR_COLORS.length]
    : undefined;

  const sw = 2 / zoomScale;
  const hasStroke = (showSelectionBorder && isSelected) || !!remoteSelectedBy;

  return (
    <Group>
      <KonvaStar
        x={cx}
        y={cy}
        numPoints={5}
        innerRadius={innerRadius}
        outerRadius={outerRadius}
        fill={color}
        stroke={showSelectionBorder && isSelected ? '#4a7c59' : remoteColor ?? undefined}
        strokeWidth={hasStroke ? sw : 0}
        dash={showSelectionBorder && isSelected ? [6 / zoomScale, 3 / zoomScale] : undefined}
      />
      {remoteSelectedBy && (
        <Text
          x={cx - 20 / zoomScale}
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
