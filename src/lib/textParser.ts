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
 * Single source of truth for wrapping. Wrap only at spaces — never breaks within a word.
 * Same wrapping model for edit and render when width/font are in the same units.
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
 * Used internally by computeTextLayout for the fit iteration.
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
  const maxFontByHeight = availH / LINE_HEIGHT_RATIO;
  const maxFontByWidth = availW / CHAR_ASPECT;
  let fontSize = Math.min(maxFontByHeight, maxFontByWidth);
  fontSize = Math.max(minFont, fontSize);

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
 * Single layout API for edit and render. Guarantees:
 * - All returned lines fit in the box (no truncation).
 * - Wrap only at spaces (getWrappedLines).
 * - Optional minReadableFont used only when it fits everything.
 *
 * Caller passes width/height in same units (screen px for overlay, world for Konva).
 */
export function computeTextLayout(
  text: string,
  width: number,
  height: number,
  options?: { minReadableFont?: number }
): TextLayoutResult {
  const w = Math.max(0.5, Number.isFinite(width) ? width : 1);
  const h = Math.max(0.5, Number.isFinite(height) ? height : 1);
  const minDim = Math.min(w, h);
  const padding = Math.min(minDim * 0.5, Math.max(minDim * 0.02, minDim * 0.06));
  const availW = Math.max(0.5, w - padding * 2);
  const availH = Math.max(0.5, h - padding * 2);
  const minFontFloor = minDim * 0.04;

  const raw = text ?? '';
  if (!raw.trim()) {
    const font = Math.max(minFontFloor, minDim * 0.1);
    return { fontSize: font, padding, wrappedLines: [''] };
  }

  // Try optional min readable font only if it fits (all lines in height, each line in width)
  const minReadable = options?.minReadableFont ?? 0;
  if (minReadable > 0) {
    const wrapped = getWrappedLines(raw, availW, minReadable);
    const needH = wrapped.length * minReadable * LINE_HEIGHT_RATIO;
    const maxLen = Math.max(1, ...wrapped.map((l) => l.length));
    const fitsWidth = minReadable <= availW / (maxLen * CHAR_ASPECT);
    if (needH <= availH && fitsWidth) {
      return { fontSize: minReadable, padding, wrappedLines: wrapped };
    }
  }

  // Find largest font such that wrapped lines fit in availW x availH (no clipping)
  let fontSize = Math.min(availH / LINE_HEIGHT_RATIO, availW / CHAR_ASPECT);
  fontSize = Math.max(minFontFloor, fontSize);
  const maxIterations = 25;
  for (let i = 0; i < maxIterations; i++) {
    const wrapped = getWrappedLines(raw, availW, fontSize);
    const lineCount = Math.max(1, wrapped.length);
    const maxLineLen = Math.max(1, ...wrapped.map((l) => l.length));
    const capH = availH / (lineCount * LINE_HEIGHT_RATIO);
    const capW = availW / (maxLineLen * CHAR_ASPECT);
    const nextFont = Math.max(minFontFloor, Math.min(fontSize, capH, capW));
    if (Math.abs(nextFont - fontSize) < 0.5) {
      fontSize = nextFont;
      return { fontSize, padding, wrappedLines: getWrappedLines(raw, availW, fontSize) };
    }
    fontSize = nextFont;
  }
  const wrappedLines = getWrappedLines(raw, availW, fontSize);
  return { fontSize, padding, wrappedLines };
}
