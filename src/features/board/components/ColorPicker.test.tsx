import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ColorPicker } from './ColorPicker';

describe('ColorPicker', () => {
  it('renders palette swatches', () => {
    render(<ColorPicker onColorChange={() => {}} />);
    const swatches = screen.getAllByRole('button', { name: /set color to/i });
    expect(swatches.length).toBeGreaterThanOrEqual(1);
  });

  it('calls onColorChange when a swatch is clicked', async () => {
    const user = userEvent.setup();
    const onColorChange = vi.fn();
    render(<ColorPicker onColorChange={onColorChange} />);
    const firstSwatch = screen.getAllByRole('button', { name: /set color to/i })[0];
    const color = firstSwatch.getAttribute('aria-label')?.replace('Set color to ', '') ?? '';
    await user.click(firstSwatch);
    expect(onColorChange).toHaveBeenCalledWith(color);
  });

  it('marks current color as active', () => {
    const currentColor = '#d4e4bc';
    render(<ColorPicker currentColor={currentColor} onColorChange={() => {}} />);
    const activeSwatch = screen.getByLabelText(`Set color to ${currentColor}`);
    expect(activeSwatch).toHaveClass('active');
  });
});
