import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthGate } from './AuthGate';

vi.mock('./useAuth', () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from './useAuth';

describe('AuthGate', () => {
  it('shows loading state when loading is true', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      loading: true,
      signIn: vi.fn(),
      signInAnonymously: vi.fn(),
      signOut: vi.fn(),
    } as ReturnType<typeof useAuth>);

    render(<AuthGate><span>Child</span></AuthGate>);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByText('Child')).not.toBeInTheDocument();
  });

  it('shows sign-in UI when not loading and no user', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      loading: false,
      signIn: vi.fn(),
      signInAnonymously: vi.fn(),
      signOut: vi.fn(),
    } as ReturnType<typeof useAuth>);

    render(<AuthGate><span>Child</span></AuthGate>);
    expect(screen.getByRole('heading', { name: 'CollabBoard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in anonymously/i })).toBeInTheDocument();
    expect(screen.queryByText('Child')).not.toBeInTheDocument();
  });

  it('renders children when user is signed in', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { uid: 'u1' } as import('firebase/auth').User,
      loading: false,
      signIn: vi.fn(),
      signInAnonymously: vi.fn(),
      signOut: vi.fn(),
    } as ReturnType<typeof useAuth>);

    render(<AuthGate><span>Child content</span></AuthGate>);
    expect(screen.getByText('Child content')).toBeInTheDocument();
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'CollabBoard' })).not.toBeInTheDocument();
  });
});
