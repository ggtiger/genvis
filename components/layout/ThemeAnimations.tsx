'use client';

import { useEffect, useRef, memo } from 'react';
import { useTheme, type AnimationEffect } from '@/contexts/ThemeContext';

// ─── Snowflake: 6-armed crystal with branches ───
function drawSnowflake(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rotation: number, opacity: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(0.5, size * 0.1);
  for (let i = 0; i < 6; i++) {
    ctx.save();
    ctx.rotate((Math.PI * 2 * i) / 6);
    // Main arm
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(size, 0);
    ctx.stroke();
    // Branch pair at 60%
    const bx = size * 0.6, bl = size * 0.35;
    ctx.beginPath();
    ctx.moveTo(bx, 0);
    ctx.lineTo(bx + bl * 0.81, -bl * 0.59);
    ctx.moveTo(bx, 0);
    ctx.lineTo(bx + bl * 0.81, bl * 0.59);
    ctx.stroke();
    // Small branch at 35%
    const sx = size * 0.35, sl = size * 0.2;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx + sl * 0.71, -sl * 0.71);
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx + sl * 0.71, sl * 0.71);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

// ─── Sakura petal: single natural petal (teardrop with notch) ───
function drawSakuraPetal(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rotation: number, opacity: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.globalAlpha = opacity;

  const s = size;
  ctx.beginPath();
  // Start at the base (stem end)
  ctx.moveTo(0, s * 0.5);
  // Right side curve up to the tip area
  ctx.bezierCurveTo(s * 0.45, s * 0.3, s * 0.55, -s * 0.2, s * 0.2, -s * 0.5);
  // Notch at the top (the characteristic sakura petal indent)
  ctx.quadraticCurveTo(0, -s * 0.3, -s * 0.2, -s * 0.5);
  // Left side curve back down to base
  ctx.bezierCurveTo(-s * 0.55, -s * 0.2, -s * 0.45, s * 0.3, 0, s * 0.5);
  ctx.closePath();

  // Gradient fill for depth
  const grad = ctx.createLinearGradient(0, -s * 0.5, 0, s * 0.5);
  grad.addColorStop(0, color);
  grad.addColorStop(1, shiftColor(color, -15));
  ctx.fillStyle = grad;
  ctx.fill();

  // Subtle center vein
  ctx.strokeStyle = `rgba(255,255,255,${opacity * 0.25})`;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(0, s * 0.4);
  ctx.quadraticCurveTo(0, 0, 0, -s * 0.35);
  ctx.stroke();

  ctx.restore();
}

// Shift a hex/named color slightly darker
function shiftColor(color: string, amount: number): string {
  // Simple approach: darken by adjusting the rgb
  const m = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return color;
  const r = Math.max(0, Math.min(255, parseInt(m[1], 16) + amount));
  const g = Math.max(0, Math.min(255, parseInt(m[2], 16) + amount));
  const b = Math.max(0, Math.min(255, parseInt(m[3], 16) + amount));
  return `rgb(${r},${g},${b})`;
}

// ─── Confetti ribbon: 3D rotating rectangle ───
function drawRibbon(ctx: CanvasRenderingContext2D, x: number, y: number, rw: number, rh: number, rotation: number, tilt: number, opacity: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  const scaleX = Math.cos(tilt);
  ctx.scale(scaleX || 0.01, 1);
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  ctx.fillRect(-rw / 2, -rh / 2, rw, rh);
  ctx.fillStyle = `rgba(255,255,255,${opacity * 0.3})`;
  ctx.fillRect(-rw / 2, -rh / 2, rw, rh * 0.25);
  ctx.restore();
}

type Particle = {
  x: number; y: number; vx: number; vy: number;
  size: number; opacity: number; color: string;
  life: number; maxLife: number;
  rotation: number; vr: number;
  tilt?: number; vt?: number;
  phase?: number;
  landed?: boolean;
};

function AnimationCanvas({ effect }: { effect: AnimationEffect }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let w = window.innerWidth;
    let h = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.scale(dpr, dpr);

    // Snow accumulation height map (one value per pixel column)
    let snowGround: Float32Array = new Float32Array(w).fill(0);
    const MAX_SNOW_HEIGHT = h * 0.08; // max snow pile height

    const onResize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      // Resize snow ground
      const newGround = new Float32Array(w).fill(0);
      for (let i = 0; i < Math.min(snowGround.length, w); i++) newGround[i] = snowGround[i];
      snowGround = newGround;
    };
    window.addEventListener('resize', onResize);

    let particles: Particle[] = [];

    // ═══════════════ SNOW with accumulation ═══════════════
    function initSnow() {
      snowGround.fill(0);
      particles = Array.from({ length: 60 }, () => ({
        x: Math.random() * w,
        y: Math.random() * h * 0.8,
        vx: 0, vy: 0.3 + Math.random() * 0.8,
        size: 4 + Math.random() * 10,
        opacity: 0.5 + Math.random() * 0.5,
        color: '#fff', life: 0, maxLife: 1,
        rotation: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.008,
        phase: Math.random() * Math.PI * 2,
        landed: false,
      }));
    }

    function smoothGround() {
      // Simple box blur to keep the snow surface smooth
      const tmp = new Float32Array(w);
      const r = 3;
      for (let i = 0; i < w; i++) {
        let sum = 0, count = 0;
        for (let j = -r; j <= r; j++) {
          const idx = i + j;
          if (idx >= 0 && idx < w) { sum += snowGround[idx]; count++; }
        }
        tmp[i] = sum / count;
      }
      snowGround.set(tmp);
    }

    function drawSnowGround() {
      // Draw the accumulated snow as a smooth white mound at the bottom
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x < w; x += 2) {
        const sh = snowGround[Math.min(x, w - 1)];
        ctx.lineTo(x, h - sh);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      // Gradient: white on top, slightly blue-white at base
      const grad = ctx.createLinearGradient(0, h - MAX_SNOW_HEIGHT, 0, h);
      grad.addColorStop(0, 'rgba(255,255,255,0.95)');
      grad.addColorStop(0.5, 'rgba(240,245,255,0.9)');
      grad.addColorStop(1, 'rgba(220,230,245,0.85)');
      ctx.fillStyle = grad;
      ctx.fill();
      // Subtle top edge highlight
      ctx.beginPath();
      for (let x = 0; x < w; x += 2) {
        const sh = snowGround[Math.min(x, w - 1)];
        if (x === 0) ctx.moveTo(x, h - sh);
        else ctx.lineTo(x, h - sh);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    function drawSnowFrame(t: number) {
      ctx.clearRect(0, 0, w, h);
      // Draw ground first
      drawSnowGround();
      // Update & draw snowflakes
      for (const p of particles) {
        if (p.landed) continue;
        p.x += Math.sin(t * 0.0005 + (p.phase || 0)) * 0.4;
        p.y += p.vy;
        p.rotation += p.vr;
        if (p.x > w + 10) p.x = -10;
        if (p.x < -10) p.x = w + 10;
        // Check if snowflake hits the ground
        const col = Math.round(p.x);
        const groundY = col >= 0 && col < w ? h - snowGround[col] : h;
        if (p.y + p.size >= groundY) {
          // Land: add to snow pile
          const radius = Math.round(p.size * 1.5);
          for (let dx = -radius; dx <= radius; dx++) {
            const idx = col + dx;
            if (idx >= 0 && idx < w) {
              const dist = Math.abs(dx) / radius;
              const add = (1 - dist * dist) * p.size * 0.08;
              snowGround[idx] = Math.min(MAX_SNOW_HEIGHT, snowGround[idx] + add);
            }
          }
          smoothGround();
          // Reset snowflake to top
          p.y = -p.size * 2;
          p.x = Math.random() * w;
          continue;
        }
        drawSnowflake(ctx, p.x, p.y, p.size, p.rotation, p.opacity);
      }
    }

    // ═══════════════ SAKURA (proper 5-petal flowers + loose petals) ═══════════════
    const petalColors = ['#ffb7c5', '#ff91a4', '#ffc0cb', '#f8c8dc', '#ffa6c1'];
    function initSakura() {
      particles = Array.from({ length: 50 }, () => ({
        x: Math.random() * w * 1.2 - w * 0.1,
        y: Math.random() * h - h * 0.5,
        vx: 0.2 + Math.random() * 0.5,
        vy: 0.5 + Math.random() * 0.8,
        size: 8 + Math.random() * 10,
        opacity: 0.5 + Math.random() * 0.5,
        color: petalColors[Math.floor(Math.random() * petalColors.length)],
        life: 0, maxLife: 1,
        rotation: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.02,
        phase: Math.random() * Math.PI * 2,
        // tilt used to simulate 3D flip of the petal
        tilt: Math.random() * Math.PI * 2,
        vt: 0.01 + Math.random() * 0.03,
      }));
    }

    function drawSakuraFrame(t: number) {
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        // Natural floating motion
        const sway = Math.sin(t * 0.0005 + (p.phase || 0));
        p.x += p.vx + sway * 0.7;
        p.y += p.vy + Math.cos(t * 0.0007 + (p.phase || 0)) * 0.2;
        p.rotation += p.vr + sway * 0.005;
        p.tilt = (p.tilt || 0) + (p.vt || 0);
        if (p.y > h + 30) { p.y = -30; p.x = Math.random() * w; }
        if (p.x > w + 30) p.x = -30;

        // Simulate 3D flip: scale the petal width by cos(tilt)
        const flipScale = Math.cos(p.tilt);
        const effectiveOpacity = p.opacity * (0.6 + Math.abs(flipScale) * 0.4);

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.scale(flipScale || 0.01, 1);
        drawSakuraPetal(ctx, 0, 0, p.size, 0, effectiveOpacity, p.color);
        ctx.restore();
      }
    }

    // ═══════════════ WAVES ═══════════════
    function initWaves() { particles = []; }
    function drawWavesFrame(t: number) {
      ctx.clearRect(0, 0, w, h);
      const time = t * 0.001;
      const layers = [
        { baseY: 0.72, amp1: 18, amp2: 10, freq1: 0.006, freq2: 0.015, speed1: 0.7, speed2: 1.1, color: 'rgba(59,130,246,0.10)', highlight: 'rgba(120,180,255,0.06)' },
        { baseY: 0.78, amp1: 14, amp2: 8, freq1: 0.009, freq2: 0.02, speed1: 1.0, speed2: 0.6, color: 'rgba(59,130,246,0.08)', highlight: 'rgba(100,170,255,0.04)' },
        { baseY: 0.84, amp1: 22, amp2: 12, freq1: 0.005, freq2: 0.012, speed1: 0.5, speed2: 0.9, color: 'rgba(59,130,246,0.06)', highlight: 'rgba(80,160,255,0.03)' },
        { baseY: 0.90, amp1: 10, amp2: 6, freq1: 0.011, freq2: 0.025, speed1: 1.3, speed2: 0.8, color: 'rgba(59,130,246,0.05)', highlight: 'rgba(60,140,255,0.02)' },
      ];
      for (const layer of layers) {
        const baseY = h * layer.baseY;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += 2) {
          const y = baseY
            + Math.sin(x * layer.freq1 + time * layer.speed1) * layer.amp1
            + Math.sin(x * layer.freq2 + time * layer.speed2) * layer.amp2
            + Math.sin(x * 0.003 + time * 0.3) * 5;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fillStyle = layer.color;
        ctx.fill();
        ctx.beginPath();
        for (let x = 0; x <= w; x += 2) {
          const y = baseY
            + Math.sin(x * layer.freq1 + time * layer.speed1) * layer.amp1
            + Math.sin(x * layer.freq2 + time * layer.speed2) * layer.amp2
            + Math.sin(x * 0.003 + time * 0.3) * 5;
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = layer.highlight;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // ═══════════════ FIREWORKS ═══════════════
    type Rocket = { x: number; y: number; vx: number; vy: number; targetY: number; hue: number; trail: { x: number; y: number }[] };
    let rockets: Rocket[] = [];
    let lastLaunch = 0;

    function initFireworks() { particles = []; rockets = []; lastLaunch = 0; }
    function drawFireworksFrame(t: number) {
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      ctx.fillRect(0, 0, w, h);
      if (t - lastLaunch > 1000 + Math.random() * 1500) {
        lastLaunch = t;
        rockets.push({
          x: w * 0.15 + Math.random() * w * 0.7, y: h,
          vx: (Math.random() - 0.5) * 1.5, vy: -(7 + Math.random() * 4),
          targetY: h * 0.1 + Math.random() * h * 0.35,
          hue: Math.random() * 360, trail: [],
        });
      }
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.trail.push({ x: r.x, y: r.y });
        if (r.trail.length > 8) r.trail.shift();
        r.x += r.vx; r.y += r.vy; r.vy += 0.05;
        for (let j = 0; j < r.trail.length; j++) {
          const alpha = (j / r.trail.length) * 0.6;
          ctx.beginPath();
          ctx.arc(r.trail[j].x, r.trail[j].y, 1 + (j / r.trail.length) * 1.5, 0, Math.PI * 2);
          ctx.fillStyle = `hsla(${r.hue},80%,70%,${alpha})`;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(r.x, r.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = `hsl(${r.hue},80%,80%)`;
        ctx.fill();
        if (r.y <= r.targetY) {
          const count = 60 + Math.floor(Math.random() * 40);
          for (let j = 0; j < count; j++) {
            const angle = (Math.PI * 2 * j) / count + (Math.random() - 0.5) * 0.5;
            const speed = 1 + Math.random() * 4;
            particles.push({
              x: r.x, y: r.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
              size: 1.5 + Math.random() * 2, opacity: 1,
              color: `hsl(${r.hue + (Math.random() - 0.5) * 40},85%,65%)`,
              life: 0, maxLife: 70 + Math.random() * 50, rotation: 0, vr: 0,
            });
          }
          for (let j = 0; j < 20; j++) {
            const angle = (Math.PI * 2 * j) / 20;
            particles.push({
              x: r.x, y: r.y, vx: Math.cos(angle) * (0.5 + Math.random() * 1.5), vy: Math.sin(angle) * (0.5 + Math.random() * 1.5),
              size: 1 + Math.random(), opacity: 1,
              color: `hsl(${r.hue},60%,90%)`,
              life: 0, maxLife: 40 + Math.random() * 20, rotation: 0, vr: 0,
            });
          }
          rockets.splice(i, 1);
        }
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy;
        p.vy += 0.025; p.vx *= 0.985; p.vy *= 0.985;
        p.life++;
        p.opacity = Math.max(0, 1 - (p.life / p.maxLife) ** 1.5);
        if (p.life >= p.maxLife) { particles.splice(i, 1); continue; }
        const glow = p.size * 3 * p.opacity;
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glow);
        grad.addColorStop(0, p.color.replace(')', `,${p.opacity})`).replace('hsl(', 'hsla('));
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fillRect(p.x - glow, p.y - glow, glow * 2, glow * 2);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.opacity, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.opacity;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // ═══════════════ CELEBRATE (confetti) ═══════════════
    const confettiColors = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#ff6bff', '#ff9f43', '#a855f7', '#f43f5e'];
    function initCelebrate() {
      particles = Array.from({ length: 90 }, () => ({
        x: Math.random() * w, y: Math.random() * h - h,
        vx: (Math.random() - 0.5) * 2, vy: 1.5 + Math.random() * 3,
        size: 5 + Math.random() * 7, opacity: 0.8 + Math.random() * 0.2,
        color: confettiColors[Math.floor(Math.random() * confettiColors.length)],
        life: 0, maxLife: 1,
        rotation: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 0.1,
        tilt: Math.random() * Math.PI * 2, vt: 0.03 + Math.random() * 0.06,
        phase: Math.random() * Math.PI * 2,
      }));
    }
    function drawCelebrateFrame(t: number) {
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.x += p.vx + Math.sin(t * 0.001 + (p.phase || 0)) * 0.6;
        p.y += p.vy;
        p.rotation += p.vr;
        p.tilt = (p.tilt || 0) + (p.vt || 0);
        p.vy = Math.min(p.vy + 0.002, 4);
        if (p.y > h + 20) { p.y = -20; p.x = Math.random() * w; p.vy = 1.5 + Math.random() * 3; }
        drawRibbon(ctx, p.x, p.y, p.size * 0.6, p.size * 1.8, p.rotation, p.tilt, p.opacity, p.color);
      }
    }

    // ═══════════════ MAIN LOOP ═══════════════
    const initMap: Record<string, () => void> = { snow: initSnow, sakura: initSakura, waves: initWaves, fireworks: initFireworks, celebrate: initCelebrate };
    const drawMap: Record<string, (t: number) => void> = { snow: drawSnowFrame, sakura: drawSakuraFrame, waves: drawWavesFrame, fireworks: drawFireworksFrame, celebrate: drawCelebrateFrame };
    const init = initMap[effect];
    const draw = drawMap[effect];
    if (!init || !draw) return;
    init();

    function loop(t: number) { draw(t); rafRef.current = requestAnimationFrame(loop); }
    rafRef.current = requestAnimationFrame(loop);

    return () => { cancelAnimationFrame(rafRef.current); window.removeEventListener('resize', onResize); };
  }, [effect]);

  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none" style={{ zIndex: 1 }} />;
}

function ThemeAnimations() {
  const { animationEffect } = useTheme();
  if (animationEffect === 'none') return null;
  return <AnimationCanvas effect={animationEffect} />;
}

export default memo(ThemeAnimations);
