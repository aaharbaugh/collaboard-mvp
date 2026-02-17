import { Layer, Line } from 'react-konva';

const GRID_SIZE = 50;
const GRID_EXTENT = 2000;

const GRID_LINES = (() => {
  const lines: Array<{ id: string; points: number[] }> = [];
  for (let i = -GRID_EXTENT; i <= GRID_EXTENT; i += GRID_SIZE) {
    lines.push({
      id: `v-${i}`,
      points: [i, -GRID_EXTENT, i, GRID_EXTENT],
    });
    lines.push({
      id: `h-${i}`,
      points: [-GRID_EXTENT, i, GRID_EXTENT, i],
    });
  }
  return lines;
})();

export function GridLayer() {
  const lines = GRID_LINES;

  return (
    <Layer listening={false}>
      {lines.map((line) => (
        <Line
          key={line.id}
          points={line.points}
          stroke="rgba(80, 70, 55, 0.12)"
          strokeWidth={1}
        />
      ))}
    </Layer>
  );
}
