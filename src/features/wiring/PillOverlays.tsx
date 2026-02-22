import React from 'react';
import { Rect, Text } from 'react-konva';
import type { PillRef } from '../../types/board';
import { getApiById } from '../apiLookup/apiRegistry';

interface PillOverlaysProps {
  wrappedLines: string[];
  pills: PillRef[];
  fontSize: number;
  padding: number;
  lineHeight: number;
  /** Sticky note background color — used to opaquely cover [API:xxx] marker text */
  bgColor?: string;
  /** Total sticky note width — used to center API blocks horizontally */
  stickyWidth?: number;
  /** Total sticky note height — used to center API blocks vertically */
  stickyHeight?: number;
}

/**
 * Renders colored pill-chip backgrounds over `{label}` occurrences in Konva text.
 * API pills (those with apiGroup) are rendered as a grouped block with a green border.
 * Relies on monospace font (Courier New) so character width = fontSize * 0.6.
 */
export const PillOverlays = React.memo(function PillOverlays({
  wrappedLines,
  pills,
  fontSize,
  padding,
  lineHeight,
  bgColor,
  stickyWidth,
  stickyHeight,
}: PillOverlaysProps) {
  if (!pills || pills.length === 0) return null;

  const charWidth = fontSize * 0.6;
  const pillH = fontSize * 1.2;
  const pillRadius = fontSize * 0.3;
  const elements: React.ReactElement[] = [];

  // Separate API pills from regular pills
  const apiPills = pills.filter((p) => p.apiGroup);
  const regularPills = pills.filter((p) => !p.apiGroup);

  // Render regular pills as before
  for (let lineIdx = 0; lineIdx < wrappedLines.length; lineIdx++) {
    const line = wrappedLines[lineIdx];
    const lineY = padding + lineIdx * lineHeight;

    for (const pill of regularPills) {
      const pattern = `{${pill.label}}`;
      let searchFrom = 0;

      while (true) {
        const charIdx = line.indexOf(pattern, searchFrom);
        if (charIdx === -1) break;

        const pillX = padding + charIdx * charWidth;
        const pillW = pattern.length * charWidth;
        const isInput = pill.direction === 'in';
        const bgColor = isInput ? 'rgba(107,142,155,0.45)' : 'rgba(180,130,60,0.45)';

        elements.push(
          <Rect
            key={`pill-${lineIdx}-${charIdx}-${pill.id}`}
            x={pillX - 2}
            y={lineY - 1}
            width={pillW + 4}
            height={pillH}
            fill={bgColor}
            cornerRadius={pillRadius}
            listening={false}
          />
        );

        searchFrom = charIdx + pattern.length;
      }
    }
  }

  // Render API pills as a grouped block
  if (apiPills.length > 0) {
    // Group by apiGroup
    const groups = new Map<string, PillRef[]>();
    for (const pill of apiPills) {
      const group = pill.apiGroup!;
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(pill);
    }

    for (const [apiId, groupPills] of groups) {
      // Find the line containing [API:xxx] marker
      let blockLineIdx = -1;
      let blockCharIdx = -1;
      const marker = `[API:${apiId}]`;
      for (let lineIdx = 0; lineIdx < wrappedLines.length; lineIdx++) {
        const idx = wrappedLines[lineIdx].indexOf(marker);
        if (idx !== -1) {
          blockLineIdx = lineIdx;
          blockCharIdx = idx;
          break;
        }
      }

      if (blockLineIdx === -1) {
        // Fallback: render individual pill overlays with green color
        for (let lineIdx = 0; lineIdx < wrappedLines.length; lineIdx++) {
          const line = wrappedLines[lineIdx];
          const lineY = padding + lineIdx * lineHeight;
          for (const pill of groupPills) {
            const pattern = `{${pill.label}}`;
            let searchFrom = 0;
            while (true) {
              const charIdx = line.indexOf(pattern, searchFrom);
              if (charIdx === -1) break;
              const pillX = padding + charIdx * charWidth;
              const pillW = pattern.length * charWidth;
              elements.push(
                <Rect
                  key={`api-pill-${lineIdx}-${charIdx}-${pill.id}`}
                  x={pillX - 2}
                  y={lineY - 1}
                  width={pillW + 4}
                  height={pillH}
                  fill="rgba(74,124,89,0.4)"
                  cornerRadius={pillRadius}
                  listening={false}
                />
              );
              searchFrom = charIdx + pattern.length;
            }
          }
        }
        continue;
      }

      // Build API block content from pill data directly (not from text lines)
      const apiDef = getApiById(apiId);
      const apiName = apiDef?.name ?? apiId;
      const apiIcon = apiDef?.icon ?? '>';
      const apiLabelText = `${apiIcon} ${apiName}`;

      const inPills = groupPills.filter((p) => p.direction === 'in');
      const outPills = groupPills.filter((p) => p.direction === 'out');

      // Build rendered lines: label, then each input pill, then output
      const renderedLines: { text: string; isBold?: boolean; pillLabel?: string; pillDir?: 'in' | 'out' }[] = [];
      renderedLines.push({ text: apiLabelText, isBold: true });
      for (const pill of inPills) {
        renderedLines.push({ text: `{${pill.label}}`, pillLabel: pill.label, pillDir: 'in' });
      }
      for (const pill of outPills) {
        renderedLines.push({ text: `\u2192 {${pill.label}}`, pillLabel: pill.label, pillDir: 'out' });
      }

      // Compute block dimensions from rendered content
      let maxContentChars = 0;
      const labelChars = Math.ceil(apiLabelText.length * 0.85 / 0.6);
      maxContentChars = Math.max(maxContentChars, labelChars);
      for (const rl of renderedLines) {
        if (!rl.isBold) maxContentChars = Math.max(maxContentChars, rl.text.length);
      }
      const blockWidth = maxContentChars * charWidth + 12;

      // Compute block height: label line + content lines
      let blockHeight = lineHeight; // label line
      for (const rl of renderedLines) {
        if (rl.isBold) continue; // already counted
        blockHeight += lineHeight;
      }
      blockHeight += 6; // vertical padding

      // Center the block horizontally
      const availableWidth = stickyWidth ? stickyWidth - padding * 2 : 0;
      const blockX = (stickyWidth && availableWidth > blockWidth)
        ? Math.max(padding, padding + (availableWidth - blockWidth) / 2)
        : padding;

      // Center the block vertically
      let blockY: number;
      if (stickyHeight && stickyHeight > blockHeight + padding * 2) {
        blockY = Math.max(padding, (stickyHeight - blockHeight) / 2);
      } else {
        blockY = padding;
      }

      // -- Opaque cover: hide ALL original text across the entire sticky --
      const coverWidth = stickyWidth ?? (padding * 2 + maxContentChars * charWidth + 20);
      const coverHeight = stickyHeight ?? (padding * 2 + wrappedLines.length * lineHeight);
      elements.push(
        <Rect
          key={`api-block-cover-${apiId}`}
          x={0}
          y={0}
          width={coverWidth}
          height={coverHeight}
          fill={bgColor ?? '#e6d070'}
          listening={false}
        />
      );

      // -- Green background rect for the API block --
      elements.push(
        <Rect
          key={`api-block-bg-${apiId}`}
          x={blockX}
          y={blockY}
          width={blockWidth}
          height={blockHeight}
          fill="rgba(74,124,89,0.08)"
          stroke="rgba(74,124,89,0.35)"
          strokeWidth={1}
          cornerRadius={3}
          listening={false}
        />
      );

      // -- Render content lines --
      let curY = blockY + 2;
      const contentX = blockX + 4;

      for (const rl of renderedLines) {
        if (rl.isBold) {
          // API label
          elements.push(
            <Text
              key={`api-block-label-${apiId}`}
              x={contentX}
              y={curY}
              text={rl.text}
              fontSize={fontSize * 0.85}
              fontFamily='"Courier New", Courier, monospace'
              fontStyle="bold"
              fill="#4a7c59"
              listening={false}
            />
          );
          curY += lineHeight;
        } else {
          // Pill line — render text + highlight rect
          elements.push(
            <Text
              key={`api-line-${apiId}-${rl.text}`}
              x={contentX}
              y={curY}
              text={rl.text}
              fontSize={fontSize}
              fontFamily='"Courier New", Courier, monospace'
              fill="#2c2416"
              wrap="none"
              listening={false}
            />
          );
          // Draw pill highlight rect over the {label} token
          if (rl.pillLabel) {
            const token = `{${rl.pillLabel}}`;
            const tokenIdx = rl.text.indexOf(token);
            if (tokenIdx >= 0) {
              const pillX = contentX + tokenIdx * charWidth;
              const pillW = token.length * charWidth;
              elements.push(
                <Rect
                  key={`api-pill-hl-${apiId}-${rl.pillLabel}`}
                  x={pillX - 1}
                  y={curY - 1}
                  width={pillW + 2}
                  height={pillH}
                  fill={rl.pillDir === 'out' ? 'rgba(180,130,60,0.25)' : 'rgba(74,124,89,0.25)'}
                  cornerRadius={pillRadius}
                  listening={false}
                />
              );
            }
          }
          curY += lineHeight;
        }
      }
    }
  }

  return <>{elements}</>;
});
