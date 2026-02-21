import { Group, Rect, Text } from 'react-konva';
import type { BoardObject } from '../../../../types/board';
import { CURSOR_COLORS, FRAME_FILL, FRAME_STROKE, FRAME_TITLE_COLOR } from '../../../../lib/constants';

interface FrameProps {
  obj: BoardObject;
  isSelected: boolean;
  showSelectionBorder?: boolean;
  remoteSelectedBy?: string;
  zoomScale?: number;
}

/** Frame: grouping container. Simple design with dashed border and tinted fill for contrast vs solitary shapes. */
export function Frame({ obj, isSelected, showSelectionBorder = true, remoteSelectedBy, zoomScale = 1 }: FrameProps) {
  const remoteColor = remoteSelectedBy
    ? CURSOR_COLORS[remoteSelectedBy.length % CURSOR_COLORS.length]
    : undefined;

  const sw = 2 / zoomScale;
  const hasStroke = (showSelectionBorder && isSelected) || !!remoteSelectedBy;
  const cornerRadius = 8 / zoomScale;

  return (
    <Group>
      <Rect
        x={obj.x}
        y={obj.y}
        width={obj.width}
        height={obj.height}
        cornerRadius={cornerRadius}
        fill={FRAME_FILL}
        stroke={showSelectionBorder && isSelected ? '#2d5a3a' : remoteColor ?? FRAME_STROKE}
        strokeWidth={hasStroke ? sw : 1.5 / zoomScale}
        dash={[8 / zoomScale, 4 / zoomScale]}
        listening={true}
      />
      <Text
        x={obj.x + 4}
        y={obj.y - 20 / zoomScale}
        text={obj.text?.trim() || 'Frame'}
        fontSize={13 / zoomScale}
        fill={FRAME_TITLE_COLOR}
        fontFamily="system-ui, sans-serif"
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
