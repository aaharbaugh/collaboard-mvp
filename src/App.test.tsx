import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

vi.mock('./features/auth/AuthGate', () => ({
  AuthGate: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="auth-gate">{children}</div>
  ),
}));

vi.mock('./features/board/BoardView', () => ({
  BoardView: () => <div data-testid="board-view">BoardView</div>,
}));

describe('App', () => {
  it('renders AuthGate wrapping BoardView', () => {
    render(<App />);
    expect(screen.getByTestId('auth-gate')).toBeInTheDocument();
    expect(screen.getByTestId('board-view')).toBeInTheDocument();
    expect(screen.getByText('BoardView')).toBeInTheDocument();
  });
});
