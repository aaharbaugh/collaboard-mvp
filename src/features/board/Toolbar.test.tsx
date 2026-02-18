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
    expect(screen.getByRole('button', { name: /select/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /move/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sticky/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /text/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /rect/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /circle/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /frame/i })).toBeInTheDocument();
  });

  it('switches to text tool on button click', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: /text/i }));
    expect(useBoardStore.getState().toolMode).toBe('text');
  });

  it('switches to text tool on hotkey 6', () => {
    render(<Toolbar />);
    expect(useBoardStore.getState().toolMode).toBe('select');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '6', bubbles: true }));
    });
    expect(useBoardStore.getState().toolMode).toBe('text');
  });

  it('marks current tool as active', () => {
    useBoardStore.setState({ toolMode: 'stickyNote' });
    render(<Toolbar />);
    const stickyBtn = screen.getByRole('button', { name: /sticky/i });
    expect(stickyBtn).toHaveClass('active');
  });

  it('switches tool on button click', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: /circle/i }));
    expect(useBoardStore.getState().toolMode).toBe('circle');
  });
});
