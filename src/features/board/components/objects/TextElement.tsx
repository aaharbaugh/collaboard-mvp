import { Group, Rect, Text } from 'react-konva';
import type { BoardObject } from '../../../../types/board';
import { CURSOR_COLORS, DEFAULT_OBJECT_COLORS, MIN_RENDER_SCREEN_PX } from '../../../../lib/constants';
import { computeTextLayout, LINE_HEIGHT_RATIO } from '../../../../lib/textParser';
import { PillOverlays } from '../../../wiring/PillOverlays';

interface TextElementProps {
  obj: BoardObject;
  isSelected: boolean;
  showSelectionBorder?: boolean;
  remoteSelectedBy?: string;
  zoomScale?: number;
}

/** Text element: same as sticky note but with transparent background. No heading/extra features. */
export function TextElement({
  obj,
  isSelected,
  showSelectionBorder = true,
  remoteSelectedBy,
  zoomScale = 1,
}: TextElementProps) {
  if (obj.type !== 'text') return null;

  const remoteColor = remoteSelectedBy
    ? CURSOR_COLORS[remoteSelectedBy.length % CURSOR_COLORS.length]
    : undefined;

  const sw = 2 / zoomScale;
  const hasStroke = (showSelectionBorder && isSelected) || !!remoteSelectedBy;

  const pills = obj.pills ?? [];
  const isPromptNode = pills.length > 0 || !!obj.promptTemplate;
  // Prompt nodes show their template text. Output always goes to a separate result sticky.
  // Non-prompt nodes show promptOutput if they received one via a wire.
  const displayText = isPromptNode ? (obj.text ?? '') : (obj.promptOutput ?? obj.text ?? '');
  const rawText = displayText;
  const w = Math.max(0, obj.width);
  const h = Math.max(0, obj.height);
  const screenW = w * zoomScale;

  const layout = computeTextLayout(rawText, Math.max(1, w), Math.max(1, h), { maxFontSize: 20 });
  const { fontSize, padding, wrappedLines } = layout;
  const lineHeight = fontSize * LINE_HEIGHT_RATIO;

  const hasContent = rawText.length > 0;
  const showText = w >= 1 && h >= 1 && hasContent && Number.isFinite(fontSize) && fontSize > 0;

  const textColor = obj.color ?? DEFAULT_OBJECT_COLORS.text;

  return (
    <Group
      x={0}
      y={0}
      width={w}
      height={h}
      clipX={0}
      clipY={0}
      clipWidth={w}
      clipHeight={h}
    >
      <Rect
        width={w}
        height={h}
        fill="transparent"
        stroke={showSelectionBorder && isSelected ? '#4a7c59' : remoteColor ?? undefined}
        strokeWidth={hasStroke ? sw : 0}
        dash={showSelectionBorder && isSelected ? [6 / zoomScale, 3 / zoomScale] : undefined}
        cornerRadius={2 / zoomScale}
      />
      {showText && (
        <>
          {wrappedLines.map((lineText, i) => (
            <Text
              key={i}
              x={padding}
              y={padding + i * lineHeight}
              width={Math.max(1, w - padding * 2)}
              text={lineText}
              fontSize={fontSize}
              fontFamily='"Courier New", Courier, monospace'
              fill={textColor}
              wrap="none"
              listening={false}
            />
          ))}
          {pills.length > 0 && (
            <PillOverlays
              wrappedLines={wrappedLines}
              pills={pills}
              fontSize={fontSize}
              padding={padding}
              lineHeight={lineHeight}
              objectId={obj.id}
            />
          )}
        </>
      )}
      {/* Smart node: top accent bar */}
      {isPromptNode && screenW >= MIN_RENDER_SCREEN_PX && (
        <Rect
          x={0}
          y={0}
          width={w}
          height={Math.max(3 / zoomScale, 3)}
          fill="#6b8e9b"
          cornerRadius={[2 / zoomScale, 2 / zoomScale, 0, 0]}
          listening={false}
        />
      )}
      {/* Smart node: bottom accent bar */}
      {isPromptNode && screenW >= MIN_RENDER_SCREEN_PX && (
        <Rect
          x={0}
          y={h - Math.max(3 / zoomScale, 3)}
          width={w}
          height={Math.max(3 / zoomScale, 3)}
          fill="#6b8e9b"
          cornerRadius={[0, 0, 2 / zoomScale, 2 / zoomScale]}
          listening={false}
        />
      )}
      {/* Running indicator: pulsing border */}
      {isPromptNode && obj.lastRunStatus === 'running' && screenW >= MIN_RENDER_SCREEN_PX && (
        <Rect
          x={-1 / zoomScale}
          y={-1 / zoomScale}
          width={w + 2 / zoomScale}
          height={h + 2 / zoomScale}
          stroke="#6b8e9b"
          strokeWidth={2 / zoomScale}
          dash={[6 / zoomScale, 4 / zoomScale]}
          listening={false}
        />
      )}
      {remoteSelectedBy && (
        <Text
          x={0}
          y={-(16 / zoomScale)}
          text={remoteSelectedBy}
          fontSize={10 / zoomScale}
          fontFamily='"Courier New", Courier, monospace'
          fill={remoteColor}
          listening={false}
        />
      )}
    </Group>
  );
}
