import { useEffect, useRef } from 'react';
import { useAuth } from './useAuth';

interface AuthGateProps {
  children: React.ReactNode;
}

const SHORTCUTS_COL1: [string, string][] = [
  ['[1]', 'Pointer'],
  ['[2]', 'Sticky note'],
  ['[3]', 'Shapes'],
  ['[4]', 'Text'],
  ['[5]', 'Frame'],
  ['[6]', 'AI mode'],
];

const SHORTCUTS_COL2: [string, string][] = [
  ['>>', 'API lookup'],
  ['{}', 'Create pill'],
  ['[W]', 'Wire mode'],
  ['Dbl-click', 'Edit'],
];

const SHORTCUTS_COL3: [string, string][] = [
  ['Ctrl+Z', 'Undo'],
  ['Del', 'Delete'],
  ['Ctrl+C', 'Copy'],
  ['Ctrl+V', 'Paste'],
];


function RainBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    let W = window.innerWidth;
    let H = window.innerHeight;
    canvas.width = W;
    canvas.height = H;

    const onResize = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = W;
      canvas.height = H;
      // Redistribute drops across new size
      for (const drop of drops) {
        drop.x = Math.random() * W;
        drop.y = Math.random() * H;
      }
    };
    window.addEventListener('resize', onResize);

    // Rain drops — scale count with viewport area
    const drift = 0.35; // horizontal drift ratio
    const dropCount = Math.floor((W * H) / 2500);
    const drops: { x: number; y: number; speed: number; len: number }[] = [];
    for (let i = 0; i < dropCount; i++) {
      const speed = 1.5 + Math.random() * 3;
      drops.push({
        x: Math.random() * (W + W * drift) - W * drift,
        y: Math.random() * H,
        speed,
        len: 8 + speed * 4,
      });
    }

    // Build a lightning bolt with branches
    function buildBolt(targetX: number): { x: number; y: number }[][] {
      const main: { x: number; y: number }[] = [];
      const branches: { x: number; y: number }[][] = [];
      let x = targetX + (Math.random() - 0.5) * 80;
      let y = 0;
      main.push({ x, y });
      while (y < H) {
        const stepY = 12 + Math.random() * 22;
        const stepX = (Math.random() - 0.5) * 35;
        y = Math.min(y + stepY, H);
        const pull = (targetX - x) * 0.1;
        x += stepX + pull;
        main.push({ x, y });
        // Chance to spawn a branch that fans out
        if (y > H * 0.1 && y < H * 0.8 && Math.random() < 0.35) {
          const branch: { x: number; y: number }[] = [{ x, y }];
          let bx = x;
          let by = y;
          const dir = Math.random() < 0.5 ? -1 : 1;
          const steps = 3 + Math.floor(Math.random() * 5);
          for (let s = 0; s < steps; s++) {
            bx += dir * (15 + Math.random() * 30) + (Math.random() - 0.5) * 10;
            by += 6 + Math.random() * 12;
            branch.push({ x: bx, y: by });
          }
          branches.push(branch);
        }
      }
      return [main, ...branches];
    }

    let bolt: { x: number; y: number }[][] | null = null;
    let boltFlash = 0;
    let boltTimer = 0;
    let nextStrike = 100 + Math.random() * 150;

    let rafId: number;

    function draw() {
      ctx.clearRect(0, 0, W, H);

      // Rain — angled streaks
      for (const drop of drops) {
        const alpha = 0.15 + drop.speed * 0.08;
        const dx = drop.len * drift;
        const dy = drop.len;
        ctx.beginPath();
        ctx.moveTo(drop.x, drop.y);
        ctx.lineTo(drop.x + dx, drop.y + dy);
        ctx.strokeStyle = `rgba(74, 124, 89, ${alpha})`;
        ctx.lineWidth = 0.8;
        ctx.stroke();
        drop.y += drop.speed;
        drop.x += drop.speed * drift;
        if (drop.y > H + 20 || drop.x > W + 20) {
          drop.y = -(10 + Math.random() * 30);
          drop.x = Math.random() * (W + W * drift) - W * drift;
        }
      }

      // Lightning timing
      boltTimer++;
      if (boltTimer >= nextStrike) {
        // Strike toward the edges, not the center
        const targetX = Math.random() < 0.5
          ? Math.random() * W * 0.3            // left edge
          : W - Math.random() * W * 0.3;       // right edge
        bolt = buildBolt(targetX);
        boltFlash = 24;
        boltTimer = 0;
        nextStrike = 120 + Math.random() * 180;
      }

      // Draw lightning (main + branches)
      if (bolt && boltFlash > 0) {
        const alpha = boltFlash / 24;
        for (let b = 0; b < bolt.length; b++) {
          const seg = bolt[b];
          const isMain = b === 0;
          // Glow
          ctx.beginPath();
          ctx.moveTo(seg[0].x, seg[0].y);
          for (let i = 1; i < seg.length; i++) {
            ctx.lineTo(seg[i].x, seg[i].y);
          }
          ctx.strokeStyle = `rgba(74, 124, 89, ${alpha * (isMain ? 0.6 : 0.35)})`;
          ctx.lineWidth = isMain ? 3 : 1.5;
          ctx.shadowColor = 'rgba(74, 124, 89, 0.8)';
          ctx.shadowBlur = (isMain ? 16 : 8) * alpha;
          ctx.stroke();
          ctx.shadowBlur = 0;

          // Bright core
          ctx.beginPath();
          ctx.moveTo(seg[0].x, seg[0].y);
          for (let i = 1; i < seg.length; i++) {
            ctx.lineTo(seg[i].x, seg[i].y);
          }
          ctx.strokeStyle = `rgba(130, 195, 145, ${alpha * (isMain ? 0.7 : 0.4)})`;
          ctx.lineWidth = isMain ? 1 : 0.5;
          ctx.stroke();
        }
        boltFlash--;
      }

      rafId = requestAnimationFrame(draw);
    }

    rafId = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return <canvas ref={canvasRef} className="auth-rain-canvas" />;
}

function ShortcutColumn({ items }: { items: [string, string][] }) {
  return (
    <div className="auth-shortcuts-col">
      {items.map(([key, action]) => (
        <div key={key} className="auth-shortcut">
          <kbd>{key}</kbd>
          <span>{action}</span>
        </div>
      ))}
    </div>
  );
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
        <RainBackground />
        <div className="auth-sign-in-wrapper">
          <div className="auth-sign-in-card">
            <h1 className="auth-title">LIVEWIRE</h1>
            <p className="auth-tagline">Draft. Wire. Run.</p>
            <div className="auth-sign-in-buttons">
              <button className="btn-primary" onClick={signIn}>
                Sign in with Google
              </button>
              <button type="button" className="btn-secondary" onClick={signInAnonymously}>
                Sign in anonymously
              </button>
            </div>
            <div className="auth-shortcuts">
              <div className="auth-shortcuts-divider">────── quick start ──────</div>
              <div className="auth-shortcuts-grid">
                <ShortcutColumn items={SHORTCUTS_COL1} />
                <ShortcutColumn items={SHORTCUTS_COL2} />
                <ShortcutColumn items={SHORTCUTS_COL3} />
              </div>
            </div>
          </div>
          <div className="auth-credit">
            created by <a href="https://www.linkedin.com/in/aaharbaugh/" target="_blank" rel="noopener noreferrer">Aaron Harbaugh</a>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
