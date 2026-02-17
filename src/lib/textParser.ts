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

const LINE_HEIGHT_RATIO = 1.3;
const CHAR_ASPECT = 0.6; // monospace width vs height

/**
 * Computes fontSize and padding so text fills the box: uses actual line count
 * and max line length. Smaller boxes get proportionally smaller text.
 */
export function computeAutoFitFontSize(
  text: string,
  width: number,
  height: number,
): { fontSize: number; padding: number } {
  const minDim = Math.min(width, height);
  const padding = Math.max(2, minDim * 0.06);
  const availW = width - padding * 2;
  const availH = height - padding * 2;

  if (availW <= 0 || availH <= 0) {
    const fallback = Math.max(6, minDim * 0.08);
    return { fontSize: fallback, padding };
  }

  const lines = parseLines(text ?? '');
  const lineTexts = lines.map((l) => l.text);
  const numLines = Math.max(1, lineTexts.length);
  const maxLineLen = Math.max(1, ...lineTexts.map((s) => s.length));

  // Font size that fits by height (all lines)
  const fontSizeByHeight = availH / (numLines * LINE_HEIGHT_RATIO);
  // Font size that fits by width (longest line in monospace)
  const fontSizeByWidth = availW / (maxLineLen * CHAR_ASPECT);

  let fontSize = Math.min(fontSizeByHeight, fontSizeByWidth);

  // Clamp: small boxes get proportionally smaller min; cap max so text doesn't blow up
  const minFont = Math.max(6, minDim * 0.06);
  const maxFont = Math.min(minDim * 0.28, availH * 0.5);
  fontSize = Math.max(minFont, Math.min(maxFont, fontSize));

  return { fontSize, padding };
}
