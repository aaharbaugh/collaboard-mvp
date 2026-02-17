import { useAuth } from './useAuth';

interface AuthGateProps {
  children: React.ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const { user, loading, signIn, signInAnonymously } = useAuth();

  if (loading) {
    return (
      <div className="auth-loading">
        <div className="auth-loading-spinner" />
        <p>Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="auth-sign-in">
        <div className="auth-sign-in-card">
          <h1>CollabBoard</h1>
          <p>Real-time collaborative whiteboard</p>
          <div className="auth-sign-in-buttons">
            <button className="btn-primary" onClick={signIn}>
              Sign in with Google
            </button>
            <button type="button" className="btn-secondary" onClick={signInAnonymously}>
              Sign in anonymously
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
