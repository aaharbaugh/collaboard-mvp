interface ColorPickerProps {
  currentColor?: string;
  onColorChange: (color: string) => void;
}

/** Palette tuned for contrast on light-tan board (--bg-board #eee9e2). */
const PALETTE = [
  '#e6d070', // golden yellow (sticky default – distinct from tan)
  '#a8c888', // sage green
  '#98b8d8', // soft blue
  '#d8a0a0', // dusty rose
  '#b8a0d8', // lavender
  '#90d8b0', // mint
  '#d8b898', // peach
  '#d0c4b0', // warm cream (distinct from board tan)
];

export function ColorPicker({ currentColor, onColorChange }: ColorPickerProps) {
  return (
    <div className="color-picker">
      {PALETTE.map((color) => (
        <button
          key={color}
          className={`color-swatch${currentColor === color ? ' active' : ''}`}
          style={{ background: color }}
          onClick={() => onColorChange(color)}
          aria-label={`Set color to ${color}`}
        />
      ))}
    </div>
  );
}
