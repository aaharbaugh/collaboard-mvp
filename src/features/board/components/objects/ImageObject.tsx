import { useEffect, useState } from 'react';
import { Group, Image as KonvaImage, Rect, Text } from 'react-konva';
import type { BoardObject } from '../../../../types/board';
import { CURSOR_COLORS } from '../../../../lib/constants';

interface ImageObjectProps {
  obj: BoardObject;
  isSelected: boolean;
  showSelectionBorder?: boolean;
  remoteSelectedBy?: string;
  zoomScale?: number;
}

export function ImageObject({ obj, isSelected, showSelectionBorder = true, remoteSelectedBy, zoomScale = 1 }: ImageObjectProps) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!obj.imageData) return;
    const img = new window.Image();
    img.onload = () => setImage(img);
    img.src = obj.imageData;
  }, [obj.imageData]);

  const remoteColor = remoteSelectedBy
    ? CURSOR_COLORS[remoteSelectedBy.length % CURSOR_COLORS.length]
    : undefined;

  const sw = 2 / zoomScale;
  const hasStroke = (showSelectionBorder && isSelected) || !!remoteSelectedBy;

  return (
    <Group>
      {image && (
        <KonvaImage
          x={obj.x}
          y={obj.y}
          width={obj.width}
          height={obj.height}
          image={image}
        />
      )}
      {hasStroke && (
        <Rect
          x={obj.x}
          y={obj.y}
          width={obj.width}
          height={obj.height}
          stroke={showSelectionBorder && isSelected ? '#4a7c59' : remoteColor ?? undefined}
          strokeWidth={sw}
          dash={showSelectionBorder && isSelected ? [6 / zoomScale, 3 / zoomScale] : undefined}
          fill="transparent"
        />
      )}
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
