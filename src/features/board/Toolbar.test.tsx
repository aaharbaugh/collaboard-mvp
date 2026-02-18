import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toolbar } from './Toolbar';
import { useBoardStore } from '../../lib/store';

describe('Toolbar', () => {
  beforeEach(() => {
    useBoardStore.setState({ toolMode: 'select' });
  });

  it('renders all tool buttons', () => {
    render(<Toolbar />);
    expect(screen.getByRole('button', { name: /\[1\]/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sticky note/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /\[3\]/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /text/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /frame/i })).toBeInTheDocument();
  });

  it('pointer button [1] cycles select <-> move', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    const pointerBtn = screen.getByRole('button', { name: /\[1\]/ });
    expect(useBoardStore.getState().toolMode).toBe('select');
    await user.click(pointerBtn);
    expect(useBoardStore.getState().toolMode).toBe('move');
    await user.click(pointerBtn);
    expect(useBoardStore.getState().toolMode).toBe('select');
  });

  it('switches to text tool on button click', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: /text/i }));
    expect(useBoardStore.getState().toolMode).toBe('text');
  });

  it('switches to text tool on hotkey 4', () => {
    render(<Toolbar />);
    expect(useBoardStore.getState().toolMode).toBe('select');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '4', bubbles: true }));
    });
    expect(useBoardStore.getState().toolMode).toBe('text');
  });

  it('marks current tool as active', () => {
    useBoardStore.setState({ toolMode: 'stickyNote' });
    render(<Toolbar />);
    const stickyBtn = screen.getByRole('button', { name: /sticky note/i });
    expect(stickyBtn).toHaveClass('active');
  });

  it('shape button [3] cycles star -> circle -> rectangle', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    const shapeBtn = screen.getByRole('button', { name: /\[3\]/ });
    await user.click(shapeBtn);
    expect(useBoardStore.getState().toolMode).toBe('star');
    await user.click(shapeBtn);
    expect(useBoardStore.getState().toolMode).toBe('circle');
    await user.click(shapeBtn);
    expect(useBoardStore.getState().toolMode).toBe('rectangle');
    await user.click(shapeBtn);
    expect(useBoardStore.getState().toolMode).toBe('star');
  });
});
