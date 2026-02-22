import React from 'react';
import { Group, Text } from 'react-konva';
import type { BoardObject, PillRef } from '../../types/board';
import { getPillWorldPoint } from '../board/utils/anchorPoint';

interface NodeLabelsProps {
  obj: BoardObject;
  pills: PillRef[];
  zoomScale: number;
}

/**
 * Renders small text labels at each pill's position.
 * Input pills on left edge (label to the left), output pills on right edge (label to the right).
 */
export const NodeLabels = React.memo(function NodeLabels({ obj, pills, zoomScale }: NodeLabelsProps) {
  if (pills.length === 0) return null;

  return (
    <Group listening={false}>
      {pills.map((pill) => {
        const pos = getPillWorldPoint(obj, pills, pill.node);
        const color = pill.direction === 'in' ? '#4a6e7a' : '#8b6914';
        // Position label outward: left of dot for inputs, right of dot for outputs
        const offsetX = pill.direction === 'in' ? -(pill.label.length * 5.4 + 10) / zoomScale : 8 / zoomScale;
        return (
          <Text
            key={pill.id}
            x={pos.x + offsetX}
            y={pos.y - 4 / zoomScale}
            text={pill.label}
            fontSize={9 / zoomScale}
            fontFamily='"Courier New", Courier, monospace'
            fill={color}
            listening={false}
          />
        );
      })}
    </Group>
  );
});
