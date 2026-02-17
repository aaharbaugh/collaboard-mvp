export interface ParsedLine {
  text: string;
  fontStyle: string;
}

export function parseLines(raw: string): ParsedLine[] {
  return raw.split('\n').map((line) => {
    let text = line;
    let fontStyle = 'normal';

    // List items
    if (text.startsWith('- ')) {
      text = '• ' + text.slice(2);
    }

    // Bold (detect **...**)
    if (text.includes('**')) {
      text = text.replace(/\*\*(.*?)\*\*/g, '$1');
      fontStyle = 'bold';
    }

    // Italic (detect *...* — must run after bold stripping)
    if (text.includes('*')) {
      text = text.replace(/\*(.*?)\*/g, '$1');
      fontStyle = fontStyle === 'bold' ? 'bold italic' : 'italic';
    }

    return { text, fontStyle };
  });
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
 * Computes fontSize and padding so text fits the given box.
 * Width/height are in whatever units the caller uses (e.g. screen px or world units).
 * Returns fontSize and padding in the same units. No hardcoded minimums — purely
 * based on the box size so it works with infinite zoom (caller passes visible size).
 *
 * For tall/narrow boxes, estimates wrapped line count so text shrinks and wraps
 * to fit both dimensions. Other objects (handles, strokes, anchors) should follow
 * the same approach: size from viewport/visible dimensions, not fixed px.
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
  const maxLineLen = Math.max(1, ...lineTexts.map((s) => s.length));

  const fontSizeByWidth = availW / (maxLineLen * CHAR_ASPECT);

  const charsPerLineAtWidth = Math.max(1, fontSizeByWidth > 0 ? availW / (fontSizeByWidth * CHAR_ASPECT) : 1);
  const wrappedLineCount = lineTexts.reduce(
    (sum, line) => sum + Math.max(1, Math.ceil(line.length / charsPerLineAtWidth)),
    0
  );
  const fontSizeByHeightWrapped = wrappedLineCount > 0 ? availH / (wrappedLineCount * LINE_HEIGHT_RATIO) : fontSizeByWidth;

  let fontSize = Math.min(fontSizeByWidth, fontSizeByHeightWrapped);
  const maxFontByContent = (availH * 0.92) / (wrappedLineCount * LINE_HEIGHT_RATIO);
  fontSize = Math.min(fontSize, maxFontByContent);
  const minFont = minDim * 0.04;
  fontSize = Math.max(minFont, fontSize);

  const safeFont = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : minDim * 0.1;
  const safePadding = Number.isFinite(padding) && padding >= 0 ? padding : minDim * 0.06;

  return { fontSize: safeFont, padding: safePadding };
}
