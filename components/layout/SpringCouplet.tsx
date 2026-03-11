'use client';

import { useTheme } from '@/contexts/ThemeContext';
import { useState, useEffect } from 'react';

/**
 * 新春春联动画组件
 * 聚合阶段春联拉开间距，马卡片变窄，不遮挡内容
 */
export default function SpringCouplet() {
  const { theme } = useTheme();
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (theme !== 'spring') { setPhase(0); return; }
    if (sessionStorage.getItem('spring_anim_done')) { setPhase(5); return; }
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 2500),
      setTimeout(() => setPhase(4), 5500),
      setTimeout(() => { setPhase(5); sessionStorage.setItem('spring_anim_done', '1'); }, 7000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [theme]);

  if (theme !== 'spring') return null;

  const centered = phase >= 1 && phase <= 3;
  const settled = phase === 5;
  const visible = phase >= 1;
  const showBlessing = phase >= 2 && phase <= 3;

  return (
    <>
      <style>{`
        .spring-scroll {
          background: linear-gradient(180deg, #700000 0%, #b91c1c 6%, #dc2626 12%, #dc2626 88%, #b91c1c 94%, #700000 100%);
          border: 3px solid #fbbf24;
          box-shadow: 0 0 16px rgba(255,215,0,0.4), inset 0 0 10px rgba(0,0,0,0.25);
          border-radius: 8px;
        }
        .spring-banner {
          background: linear-gradient(90deg, #700000 0%, #dc2626 12%, #dc2626 88%, #700000 100%);
          border: 3px solid #fbbf24;
          box-shadow: 0 0 16px rgba(255,215,0,0.4), inset 0 0 10px rgba(0,0,0,0.25);
          border-radius: 6px;
        }
        .spring-text {
          color: #ffd700;
          text-shadow: 0 0 12px rgba(255,215,0,0.6), 0 0 24px rgba(255,215,0,0.3), 2px 2px 3px rgba(0,0,0,0.6);
          font-family: KaiTi, STKaiti, "楷体", SimSun, serif;
        }
      `}</style>

      {/* 横批 */}
      <div
        className="fixed z-[9998] pointer-events-none"
        style={{
          left: '50%',
          top: centered ? 'calc(50% - 220px)' : '3px',
          transform: 'translateX(-50%)',
          opacity: visible || settled ? 1 : 0,
          transition: settled ? 'none' : 'top 1.2s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.8s ease-out',
        }}
      >
        <div className="spring-banner px-10 py-2.5">
          <span className="spring-text text-2xl font-bold tracking-[0.5em]">AI迎春</span>
        </div>
      </div>

      {/* 下联 — 左 */}
      <div
        className="fixed z-[9998] pointer-events-none"
        style={{
          top: '50%',
          left: centered ? 'calc(50% - 180px)' : '3px',
          transform: 'translateY(-50%)',
          opacity: visible || settled ? 1 : 0,
          transition: settled ? 'none' : 'left 1.2s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.8s ease-out',
        }}
      >
        <div className="spring-scroll px-3 py-6">
          <div className="spring-text text-2xl font-bold writing-vertical-rl tracking-[0.6em] leading-tight">
            算法模型万象新
          </div>
        </div>
      </div>

      {/* 上联 — 右 */}
      <div
        className="fixed z-[9998] pointer-events-none"
        style={{
          top: '50%',
          right: centered ? 'calc(50% - 180px)' : '3px',
          transform: 'translateY(-50%)',
          opacity: visible || settled ? 1 : 0,
          transition: settled ? 'none' : 'right 1.2s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.8s ease-out',
        }}
      >
        <div className="spring-scroll px-3 py-6">
          <div className="spring-text text-2xl font-bold writing-vertical-rl tracking-[0.6em] leading-tight">
            智能代码千行锦
          </div>
        </div>
      </div>

      {/* 马年吉祥 — 窄卡片 */}
      {(phase >= 2 && phase <= 4) && (
        <div
          className="fixed inset-0 z-[9999] pointer-events-none flex items-center justify-center"
          style={{
            opacity: showBlessing ? 1 : 0,
            transition: 'opacity 0.8s ease-out',
          }}
        >
          <div
            className="flex flex-col items-center gap-3 px-8 py-6 rounded-xl"
            style={{
              background: 'radial-gradient(ellipse at center, rgba(139,0,0,0.95) 0%, rgba(100,0,0,0.9) 100%)',
              border: '3px solid #fbbf24',
              boxShadow: '0 0 30px rgba(255,215,0,0.4), 0 0 60px rgba(255,0,0,0.2)',
              transform: showBlessing ? 'scale(1)' : 'scale(0.8)',
              transition: 'transform 0.6s cubic-bezier(0.25, 1, 0.5, 1)',
              maxWidth: '280px',
            }}
          >
            <span className="text-5xl">🐴</span>
            <span className="spring-text text-3xl font-bold tracking-[0.3em]">马年吉祥</span>
            <span className="spring-text text-xl font-bold tracking-[0.3em]" style={{ color: '#ffe4b5' }}>新春快乐</span>
            <div className="w-full border-t border-yellow-500/40 my-1" />
            <span className="spring-text text-3xl font-bold tracking-[0.2em]" style={{ color: '#ffd700' }}>喝了古20</span>
            <span className="spring-text text-xl font-bold tracking-[0.2em]" style={{ color: '#ffe4b5' }}>天天好心情</span>
          </div>
        </div>
      )}
    </>
  );
}
