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
      const wordLen = word.length;
      if (lineLen + wordLen <= maxCharsPerLine || lineLen === 0) {
        line += word;
        lineLen += wordLen;
      } else {
        if (line.trim().length > 0) lines.push(line.trimEnd());
        if (isSpace) {
          line = '';
          lineLen = 0;
        } else {
          line = word;
          lineLen = wordLen;
        }
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

  const maxLineLen = Math.max(1, ...lineTexts.map((s) => s.length));
  const fontSizeByWidth = availW / (maxLineLen * CHAR_ASPECT);
  const minFont = minDim * 0.04;
  let fontSize = Math.min(fontSizeByWidth, availH / LINE_HEIGHT_RATIO);
  fontSize = Math.max(minFont, fontSize);

  // Iterate: at current fontSize, get actual wrapped line count; shrink font so those lines fit in height
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
