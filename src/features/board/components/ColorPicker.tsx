interface ColorPickerProps {
  currentColor?: string;
  onColorChange: (color: string) => void;
}

const PALETTE = [
  '#f5e6ab', // warm yellow
  '#d4e4bc', // sage green
  '#c5d5e8', // soft blue
  '#e8c5c5', // dusty rose
  '#d4c5e8', // lavender
  '#c5e8d4', // mint
  '#e8d4c5', // peach
  '#e0e0d0', // light grey
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
