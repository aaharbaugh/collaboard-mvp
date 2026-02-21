export interface ParsedLine {
  text: string;
  fontStyle: string;
}

export function parseLines(raw: string): ParsedLine[] {
  return raw.split('\n').map((line) => ({ text: line, fontStyle: 'normal' }));
}

export const LINE_HEIGHT_RATIO = 1.3;
const CHAR_ASPECT = 0.6; // monospace width vs height

/**
 * Same wrapping model as computeAutoFitFontSize. Returns lines so view and edit
 * use identical line breaks when width/font are in the same units.
 * Wraps only at spaces — never breaks within a word.
 */
export function getWrappedLines(
  text: string,
  widthPx: number,
  fontSizePx: number
): string[] {
  if (!text || widthPx <= 0 || fontSizePx <= 0) return [];
  const charWidth = fontSizePx * CHAR_ASPECT;
  const maxCharsPerLine = Math.max(1, Math.floor(widthPx / charWidth));
  const lines: string[] = [];
  const paragraphs = (text ?? '').split('\n');
  for (const para of paragraphs) {
    const words = para.split(/(\s+)/);
    let line = '';
    let lineLen = 0;
    for (const word of words) {
      const isSpace = /^\s+$/.test(word);
      if (isSpace) {
        line += word;
        lineLen += word.length;
        continue;
      }
      // Wrap only at spaces: if word fits on current line, add it; else start new line
      const fitsOnCurrentLine = lineLen + word.length <= maxCharsPerLine;
      if (fitsOnCurrentLine && lineLen > 0) {
        line += word;
        lineLen += word.length;
      } else if (fitsOnCurrentLine) {
        line = word;
        lineLen = word.length;
      } else {
        if (line.trim().length > 0) lines.push(line.trimEnd());
        line = word;
        lineLen = word.length;
      }
    }
    if (line.trim().length > 0) lines.push(line.trimEnd());
  }
  return lines.length > 0 ? lines : [''];
}

/**
 * Computes fontSize and padding so text fits the given box with wrapping.
 * Width/height are in whatever units the caller uses (e.g. screen px or world units).
 * Returns fontSize and padding in the same units. Text is wrapped to fit width,
 * and font size is chosen so that all wrapped lines fit within the box height.
 *
 * Uses getWrappedLines iteratively so the chosen fontSize guarantees the entire
 * text field is visible (no clipping).
 */
export function computeAutoFitFontSize(
  text: string,
  width: number,
  height: number,
): { fontSize: number; padding: number } {
  const w = Math.max(0.5, Number.isFinite(width) ? width : 1);
  const h = Math.max(0.5, Number.isFinite(height) ? height : 1);
  const minDim = Math.min(w, h);
  const padding = Math.min(minDim * 0.5, Math.max(minDim * 0.02, minDim * 0.06));
  const availW = Math.max(0.5, w - padding * 2);
  const availH = Math.max(0.5, h - padding * 2);

  const lines = parseLines(text ?? '');
  const lineTexts = lines.map((l) => l.text);
  const paragraphText = lineTexts.join('\n');
  if (!paragraphText.trim()) {
    const minFont = Math.max(minDim * 0.04, minDim * 0.1);
    return { fontSize: minFont, padding };
  }

  const minFont = minDim * 0.04;
  // Start from height: one line of text uses this font. Only shrink when wrapped lines exceed height.
  const maxFontByHeight = availH / LINE_HEIGHT_RATIO;
  const maxFontByWidth = availW / CHAR_ASPECT; // one character fits in width (long words wrap)
  let fontSize = Math.min(maxFontByHeight, maxFontByWidth);
  fontSize = Math.max(minFont, fontSize);

  // Iterate: at current fontSize, get actual wrapped line count; shrink font only so those lines fit in height
  const maxIterations = 15;
  for (let i = 0; i < maxIterations; i++) {
    const wrapped = getWrappedLines(paragraphText, availW, fontSize);
    const lineCount = Math.max(1, wrapped.length);
    const maxFontForHeight = availH / (lineCount * LINE_HEIGHT_RATIO);
    const nextFont = Math.min(fontSize, maxFontForHeight);
    const nextFontClamped = Math.max(minFont, nextFont);
    if (Math.abs(nextFontClamped - fontSize) < 0.5) {
      fontSize = nextFontClamped;
      break;
    }
    fontSize = nextFontClamped;
  }

  const safeFont = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : minDim * 0.1;
  const safePadding = Number.isFinite(padding) && padding >= 0 ? padding : minDim * 0.06;
  return { fontSize: safeFont, padding: safePadding };
}

export interface TextLayoutResult {
  fontSize: number;
  padding: number;
  wrappedLines: string[];
}

/**
 * Single cohesive text layout for both edit and render: same wrapping, same units.
 * Width/height are in caller units (screen px for overlay, world for Konva).
 * All text stays visible inside the box (no spill, no clipping).
 *
 * - minFontSize (optional): Use when it still fits all content.
 * - floorFontSize (optional): When min doesn't fit, try this next so text isn't tiny; only use
 *   auto-fit when floor doesn't fit.
 * - Fill height: When we have few lines, scale font up to use vertical space.
 */
export function computeTextLayout(
  text: string,
  width: number,
  height: number,
  options?: { minFontSize?: number; floorFontSize?: number }
): TextLayoutResult {
  const w = Math.max(0.5, Number.isFinite(width) ? width : 1);
  const h = Math.max(0.5, Number.isFinite(height) ? height : 1);
  const minDim = Math.min(w, h);
  const padding = Math.min(minDim * 0.5, Math.max(minDim * 0.02, minDim * 0.06));
  const availW = Math.max(0.5, w - padding * 2);
  const availH = Math.max(0.5, h - padding * 2);

  const { fontSize: autoFitFont, padding: outPadding } = computeAutoFitFontSize(text, w, h);
  const minFont = options?.minFontSize ?? 0;
  const floorFont = options?.floorFontSize ?? 0;

  // 1) Prefer min font, then floor, then auto-fit — so we only go tiny when nothing else fits (no spill)
  let fontSize = autoFitFont;
  if (minFont > 0 && autoFitFont < minFont) {
    const wrappedAtMin = getWrappedLines(text ?? '', availW, minFont);
    if (wrappedAtMin.length * minFont * LINE_HEIGHT_RATIO <= availH) {
      fontSize = minFont;
    } else if (floorFont > 0 && floorFont > autoFitFont) {
      const wrappedAtFloor = getWrappedLines(text ?? '', availW, floorFont);
      if (wrappedAtFloor.length * floorFont * LINE_HEIGHT_RATIO <= availH) {
        fontSize = floorFont;
      }
    }
  }
  let wrappedLines = getWrappedLines(text ?? '', availW, fontSize);

  // 2) Fill height when we have few lines: scale font up so text uses vertical space
  const hasContent = (text ?? '').trim().length > 0;
  const lineCount = Math.max(1, wrappedLines.length);
  const fillHeightFont = availH / (lineCount * LINE_HEIGHT_RATIO);
  if (hasContent && fillHeightFont > fontSize) {
    // Cap by width so longest line still fits (avoid extra wrapping)
    const maxLineLen = Math.max(1, ...wrappedLines.map((l) => l.length));
    const maxFontByWidth = availW / (maxLineLen * CHAR_ASPECT);
    const fillFont = Math.min(fillHeightFont, maxFontByWidth);
    if (fillFont > fontSize) {
      const newWrapped = getWrappedLines(text ?? '', availW, fillFont);
      const needH = newWrapped.length * fillFont * LINE_HEIGHT_RATIO;
      if (needH <= availH) {
        // Re-wrap can produce longer lines (e.g. one line "One liners"); cap font so they fit in width
        const newMaxLen = Math.max(1, ...newWrapped.map((l) => l.length));
        const fontCapForNewLines = availW / (newMaxLen * CHAR_ASPECT);
        fontSize = Math.min(fillFont, fontCapForNewLines);
        wrappedLines = getWrappedLines(text ?? '', availW, fontSize);
      }
    }
  }

  let safeFont = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : minDim * 0.1;
  let finalWrapped = getWrappedLines(text ?? '', availW, safeFont);

  // 3) Final guarantees so nothing is ever clipped
  const TOLERANCE = 0.5;
  // Width: no line may exceed availW (long words get their own line; cap font so they fit)
  const maxLen = Math.max(1, ...finalWrapped.map((l) => l.length));
  const maxFontByWidth = availW / (maxLen * CHAR_ASPECT);
  if (safeFont > maxFontByWidth) {
    safeFont = maxFontByWidth;
    finalWrapped = getWrappedLines(text ?? '', availW, safeFont);
  }
  // Height: leave small margin so render path’s floor(availH/lineHeight) never drops a line
  const minFontFinal = minDim * 0.04;
  for (let iter = 0; iter < 5; iter++) {
    const needH = finalWrapped.length * safeFont * LINE_HEIGHT_RATIO;
    if (needH <= availH - TOLERANCE || finalWrapped.length === 0) break;
    safeFont = Math.max(minFontFinal, (availH - TOLERANCE) / (finalWrapped.length * LINE_HEIGHT_RATIO));
    finalWrapped = getWrappedLines(text ?? '', availW, safeFont);
  }

  return { fontSize: safeFont, padding: outPadding, wrappedLines: finalWrapped };
}
