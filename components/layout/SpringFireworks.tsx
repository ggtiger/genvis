'use client';

import { useTheme } from '@/contexts/ThemeContext';
import { useEffect, useRef } from 'react';

/**
 * 新春烟花效果 — Canvas 粒子动画
 * 每隔几秒自动在随机位置绽放烟花
 */
export default function SpringFireworks() {
  const { theme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    if (theme !== 'spring') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = window.innerWidth;
    let h = window.innerHeight;
    canvas.width = w;
    canvas.height = h;

    const onResize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w;
      canvas.height = h;
    };
    window.addEventListener('resize', onResize);

    const colors = [
      '#ffd700', '#ff6b6b', '#ff4757', '#ffa502',
      '#ff6348', '#ffbe76', '#f9ca24', '#e056fd',
      '#7bed9f', '#70a1ff', '#ff7979', '#badc58',
    ];

    interface Particle {
      x: number; y: number;
      vx: number; vy: number;
      alpha: number; decay: number;
      color: string; size: number;
      trail: { x: number; y: number; alpha: number }[];
    }

    const particles: Particle[] = [];

    function burst(cx: number, cy: number) {
      const count = 20 + Math.random() * 15;
      const baseColor = colors[Math.floor(Math.random() * colors.length)];
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.3;
        const speed = 2 + Math.random() * 4;
        particles.push({
          x: cx, y: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          alpha: 1,
          decay: 0.012 + Math.random() * 0.01,
          color: Math.random() > 0.3 ? baseColor : colors[Math.floor(Math.random() * colors.length)],
          size: 1.5 + Math.random() * 2,
          trail: [],
        });
      }
    }

    // Auto-launch fireworks
    let timer = 0;
    const autoLaunch = () => {
      burst(w * 0.15 + Math.random() * w * 0.7, h * 0.1 + Math.random() * h * 0.5);
      timer = window.setTimeout(autoLaunch, 3000 + Math.random() * 4000);
    };
    timer = window.setTimeout(autoLaunch, 800);

    const FRAME_MS = 42; // ~24fps
    let lastFrame = 0;
    function animate(now: number) {
      if (now - lastFrame < FRAME_MS) {
        animRef.current = requestAnimationFrame(animate);
        return;
      }
      lastFrame = now;
      ctx!.clearRect(0, 0, w, h);

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.trail.push({ x: p.x, y: p.y, alpha: p.alpha * 0.5 });
        if (p.trail.length > 6) p.trail.shift();

        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.04; // gravity
        p.vx *= 0.99;
        p.alpha -= p.decay;

        // Draw trail
        for (const t of p.trail) {
          ctx!.beginPath();
          ctx!.arc(t.x, t.y, p.size * 0.5, 0, Math.PI * 2);
          ctx!.fillStyle = p.color;
          ctx!.globalAlpha = t.alpha * 0.3;
          ctx!.fill();
        }

        // Draw particle (no glow gradient for GPU perf)
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx!.fillStyle = p.color;
        ctx!.globalAlpha = p.alpha;
        ctx!.fill();

        if (p.alpha <= 0) particles.splice(i, 1);
      }

      ctx!.globalAlpha = 1;
      animRef.current = requestAnimationFrame(animate);
    }

    animRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animRef.current);
      clearTimeout(timer);
      window.removeEventListener('resize', onResize);
      particles.length = 0;
    };
  }, [theme]);

  if (theme !== 'spring') return null;

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 9997 }}
    />
  );
}
