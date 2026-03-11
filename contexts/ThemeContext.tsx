'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

export type Theme = 'light' | 'dark' | 'spring';

export const THEME_OPTIONS: { id: Theme; label: string; emoji: string; desc: string }[] = [
  { id: 'light', label: '亮色', emoji: '☀️', desc: '清爽明亮' },
  { id: 'dark', label: '暗色', emoji: '🌙', desc: '护眼暗黑' },
  { id: 'spring', label: '新春', emoji: '🧧', desc: '喜庆红金' },
];

export type BgOption = { id: string; label: string; url: string; thumb: string; css?: string; category: string };

export type AnimationEffect = 'none' | 'snow' | 'waves' | 'fireworks' | 'celebrate' | 'sakura';

export const ANIMATION_OPTIONS: { id: AnimationEffect; label: string; emoji: string; desc: string }[] = [
  { id: 'none', label: '无', emoji: '⏹️', desc: '关闭动画' },
  { id: 'snow', label: '飘雪', emoji: '❄️', desc: '雪花纷飞' },
  { id: 'sakura', label: '樱花', emoji: '🌸', desc: '花瓣飘落' },
  { id: 'waves', label: '海浪', emoji: '🌊', desc: '波浪涌动' },
  { id: 'fireworks', label: '烟花', emoji: '🎆', desc: '绚烂烟花' },
  { id: 'celebrate', label: '庆祝', emoji: '🎉', desc: '彩带纷飞' },
];

export const BG_CATEGORIES = [
  { id: 'nature', label: '🏞️ 自然风光' },
  { id: 'city', label: '🏙️ 城市建筑' },
  { id: 'anime', label: '✨ 二次元' },
  { id: 'donghua', label: '🐉 国漫' },
  { id: 'abstract', label: '🎨 抽象艺术' },
  { id: 'gradient', label: '🌈 纯色渐变' },
  { id: 'festival', label: '🎉 节日主题' },
  { id: 'custom', label: '📁 我的上传' },
];

export const BG_OPTIONS: BgOption[] = [
  // 自然风光
  { id: 'mountain', label: '山峦', category: 'nature', url: "https://picsum.photos/id/29/2070/1380", thumb: "https://picsum.photos/id/29/200/130" },
  { id: 'ocean', label: '海洋', category: 'nature', url: "https://picsum.photos/id/1015/2070/1380", thumb: "https://picsum.photos/id/1015/200/130" },
  { id: 'forest', label: '森林', category: 'nature', url: "https://picsum.photos/id/15/2070/1380", thumb: "https://picsum.photos/id/15/200/130" },
  { id: 'lake', label: '湖泊', category: 'nature', url: "https://picsum.photos/id/1036/2070/1380", thumb: "https://picsum.photos/id/1036/200/130" },
  { id: 'sunset', label: '日落', category: 'nature', url: "https://picsum.photos/id/1040/2070/1380", thumb: "https://picsum.photos/id/1040/200/130" },
  { id: 'snow', label: '雪景', category: 'nature', url: "https://picsum.photos/id/1039/2070/1380", thumb: "https://picsum.photos/id/1039/200/130" },
  { id: 'flower', label: '花卉', category: 'nature', url: "https://picsum.photos/id/106/2070/1380", thumb: "https://picsum.photos/id/106/200/130" },
  { id: 'desert', label: '沙漠', category: 'nature', url: "https://picsum.photos/id/1050/2070/1380", thumb: "https://picsum.photos/id/1050/200/130" },
  { id: 'nature-sakura', label: '樱花', category: 'nature', url: '/wallpapers/anime/sakura.jpg', thumb: '/wallpapers/anime/thumb/sakura.jpg' },
  { id: 'nature-starry', label: '星空', category: 'nature', url: '/wallpapers/anime/night-sky.jpg', thumb: '/wallpapers/anime/thumb/night-sky.jpg' },
  { id: 'nature-sea', label: '碧海', category: 'nature', url: '/wallpapers/anime/ocean.jpg', thumb: '/wallpapers/anime/thumb/ocean.jpg' },
  { id: 'nature-dusk', label: '黄昏', category: 'nature', url: '/wallpapers/anime/sunset.jpg', thumb: '/wallpapers/anime/thumb/sunset.jpg' },
  { id: 'nature-wave', label: '浪花', category: 'nature', url: '/wallpapers/anime/pastel.jpg', thumb: '/wallpapers/anime/thumb/pastel.jpg' },
  { id: 'nature-temple', label: '古寺', category: 'nature', url: '/wallpapers/anime/neon-city.jpg', thumb: '/wallpapers/anime/thumb/neon-city.jpg' },
  { id: 'nature-meadow', label: '草原', category: 'nature', url: '/wallpapers/anime/meadow.jpg', thumb: '/wallpapers/anime/thumb/meadow.jpg' },
  { id: 'nature-snowfield', label: '雪原', category: 'nature', url: '/wallpapers/anime/snow.jpg', thumb: '/wallpapers/anime/thumb/snow.jpg' },
  // 城市建筑
  { id: 'city', label: '城市', category: 'city', url: "https://picsum.photos/id/1026/2070/1380", thumb: "https://picsum.photos/id/1026/200/130" },
  { id: 'night-city', label: '夜景', category: 'city', url: "https://picsum.photos/id/1044/2070/1380", thumb: "https://picsum.photos/id/1044/200/130" },
  { id: 'bridge', label: '桥梁', category: 'city', url: "https://picsum.photos/id/1058/2070/1380", thumb: "https://picsum.photos/id/1058/200/130" },
  { id: 'street', label: '街道', category: 'city', url: "https://picsum.photos/id/1029/2070/1380", thumb: "https://picsum.photos/id/1029/200/130" },
  // 二次元 — CSS 渐变模拟动漫场景风格，也可在「我的上传」中添加真正的动漫壁纸
  {
    id: 'anime-sakura', label: '樱花小径', category: 'anime', url: '', thumb: '',
    css: `radial-gradient(ellipse at 20% 80%, rgba(255,183,197,0.7) 0%, transparent 50%),
      radial-gradient(ellipse at 80% 20%, rgba(255,218,233,0.6) 0%, transparent 50%),
      radial-gradient(ellipse at 50% 50%, rgba(255,240,245,0.3) 0%, transparent 70%),
      linear-gradient(160deg, #fce4ec 0%, #f8bbd0 30%, #f48fb1 60%, #ec407a 100%)`,
  },
  {
    id: 'anime-night-sky', label: '星空夜', category: 'anime', url: '', thumb: '',
    css: `radial-gradient(circle at 25% 25%, rgba(100,149,237,0.4) 0%, transparent 40%),
      radial-gradient(circle at 75% 60%, rgba(138,43,226,0.3) 0%, transparent 40%),
      radial-gradient(circle at 50% 10%, rgba(255,255,255,0.1) 0%, transparent 30%),
      linear-gradient(180deg, #0a0e27 0%, #1a1a4e 30%, #2d1b69 60%, #1a0a3e 100%)`,
  },
  {
    id: 'anime-ocean-blue', label: '碧海蓝天', category: 'anime', url: '', thumb: '',
    css: `radial-gradient(ellipse at 50% 0%, rgba(135,206,250,0.6) 0%, transparent 60%),
      radial-gradient(ellipse at 30% 100%, rgba(0,105,148,0.4) 0%, transparent 50%),
      linear-gradient(180deg, #87ceeb 0%, #4fc3f7 25%, #0288d1 50%, #01579b 80%, #002f4a 100%)`,
  },
  {
    id: 'anime-sunset-glow', label: '夕阳物语', category: 'anime', url: '', thumb: '',
    css: `radial-gradient(ellipse at 50% 60%, rgba(255,193,7,0.5) 0%, transparent 50%),
      radial-gradient(ellipse at 70% 30%, rgba(255,87,34,0.3) 0%, transparent 40%),
      linear-gradient(180deg, #1a237e 0%, #4a148c 15%, #e65100 40%, #ff8f00 60%, #ffcc02 80%, #fff9c4 100%)`,
  },
  {
    id: 'anime-pastel-dream', label: '梦幻柔彩', category: 'anime', url: '', thumb: '',
    css: `radial-gradient(ellipse at 20% 50%, rgba(186,147,255,0.5) 0%, transparent 50%),
      radial-gradient(ellipse at 80% 50%, rgba(147,218,255,0.5) 0%, transparent 50%),
      radial-gradient(ellipse at 50% 80%, rgba(255,182,193,0.4) 0%, transparent 50%),
      linear-gradient(135deg, #e8daef 0%, #d4e6f1 25%, #d5f5e3 50%, #fdebd0 75%, #fadbd8 100%)`,
  },
  {
    id: 'anime-cyber-neon', label: '赛博霓虹', category: 'anime', url: '', thumb: '',
    css: `radial-gradient(ellipse at 30% 70%, rgba(0,255,255,0.25) 0%, transparent 50%),
      radial-gradient(ellipse at 70% 30%, rgba(255,0,255,0.2) 0%, transparent 50%),
      radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0.3) 0%, transparent 60%),
      linear-gradient(135deg, #0d0221 0%, #150734 20%, #1a0a2e 40%, #0f0318 60%, #0a0114 100%)`,
  },
  {
    id: 'anime-green-meadow', label: '绿野仙踪', category: 'anime', url: '', thumb: '',
    css: `radial-gradient(ellipse at 50% 20%, rgba(255,255,255,0.3) 0%, transparent 50%),
      radial-gradient(ellipse at 30% 80%, rgba(76,175,80,0.4) 0%, transparent 50%),
      radial-gradient(ellipse at 70% 60%, rgba(139,195,74,0.3) 0%, transparent 40%),
      linear-gradient(180deg, #81d4fa 0%, #b3e5fc 20%, #c8e6c9 45%, #81c784 65%, #4caf50 85%, #2e7d32 100%)`,
  },
  {
    id: 'anime-snow-village', label: '雪夜小镇', category: 'anime', url: '', thumb: '',
    css: `radial-gradient(circle at 50% 30%, rgba(200,220,255,0.4) 0%, transparent 50%),
      radial-gradient(circle at 20% 80%, rgba(100,120,180,0.3) 0%, transparent 40%),
      linear-gradient(180deg, #1a1a3e 0%, #2c3e6b 25%, #4a6fa5 50%, #8eacc5 70%, #c5d5e4 85%, #e8eef5 100%)`,
  },
  // 国漫 — 水墨仙侠、玄幻修仙、古风武侠等中国动画风格色调
  {
    id: 'donghua-ink-mountain', label: '水墨山河', category: 'donghua', url: '', thumb: '',
    css: `radial-gradient(ellipse at 30% 70%, rgba(120,120,120,0.3) 0%, transparent 50%),
      radial-gradient(ellipse at 70% 30%, rgba(180,180,180,0.2) 0%, transparent 50%),
      linear-gradient(180deg, #f5f0e8 0%, #e8ddd0 15%, #d4c5b0 30%, #a89880 50%, #7a6b58 70%, #4a3f30 85%, #2a2018 100%)`,
  },
  {
    id: 'donghua-xianxia', label: '仙侠云海', category: 'donghua', url: '', thumb: '',
    css: `radial-gradient(ellipse at 50% 20%, rgba(255,255,255,0.4) 0%, transparent 50%),
      radial-gradient(ellipse at 20% 60%, rgba(100,180,255,0.3) 0%, transparent 40%),
      radial-gradient(ellipse at 80% 80%, rgba(180,130,255,0.2) 0%, transparent 40%),
      linear-gradient(180deg, #e8f4fd 0%, #b8d8f8 15%, #88b8e8 30%, #6898d0 50%, #4870a8 70%, #2a4878 85%, #1a2848 100%)`,
  },
  {
    id: 'donghua-xuanhuan', label: '玄幻天地', category: 'donghua', url: '', thumb: '',
    css: `radial-gradient(circle at 50% 40%, rgba(255,180,50,0.35) 0%, transparent 40%),
      radial-gradient(circle at 30% 70%, rgba(200,50,50,0.2) 0%, transparent 40%),
      radial-gradient(circle at 70% 20%, rgba(100,50,200,0.2) 0%, transparent 40%),
      linear-gradient(180deg, #1a0a2e 0%, #2d1050 20%, #4a1a6e 40%, #6a2040 60%, #8a3020 75%, #4a1a10 100%)`,
  },
  {
    id: 'donghua-wuxia', label: '武侠江湖', category: 'donghua', url: '', thumb: '',
    css: `radial-gradient(ellipse at 60% 30%, rgba(200,160,100,0.3) 0%, transparent 50%),
      radial-gradient(ellipse at 30% 80%, rgba(80,120,60,0.3) 0%, transparent 40%),
      linear-gradient(180deg, #f0e6d0 0%, #d8c8a8 15%, #b0a080 30%, #889068 50%, #607848 65%, #3a5030 80%, #1a2810 100%)`,
  },
  {
    id: 'donghua-spirit', label: '灵境幽谷', category: 'donghua', url: '', thumb: '',
    css: `radial-gradient(ellipse at 40% 30%, rgba(100,220,200,0.3) 0%, transparent 45%),
      radial-gradient(ellipse at 70% 70%, rgba(50,150,180,0.25) 0%, transparent 40%),
      radial-gradient(circle at 50% 50%, rgba(255,255,255,0.08) 0%, transparent 50%),
      linear-gradient(180deg, #0a1a20 0%, #0f2830 20%, #1a4040 40%, #205050 55%, #184038 70%, #102820 85%, #081810 100%)`,
  },
  {
    id: 'donghua-palace', label: '宫阙琼楼', category: 'donghua', url: '', thumb: '',
    css: `radial-gradient(ellipse at 50% 20%, rgba(255,215,0,0.3) 0%, transparent 45%),
      radial-gradient(ellipse at 30% 70%, rgba(200,50,50,0.15) 0%, transparent 40%),
      linear-gradient(180deg, #2a1a10 0%, #4a2a18 15%, #6a3a20 30%, #8a4a28 45%, #a05830 55%, #8a4a28 70%, #5a3018 85%, #2a1808 100%)`,
  },
  {
    id: 'donghua-frost', label: '冰霜剑域', category: 'donghua', url: '', thumb: '',
    css: `radial-gradient(ellipse at 50% 30%, rgba(200,230,255,0.4) 0%, transparent 50%),
      radial-gradient(ellipse at 20% 70%, rgba(100,160,220,0.25) 0%, transparent 40%),
      radial-gradient(ellipse at 80% 60%, rgba(150,200,255,0.2) 0%, transparent 40%),
      linear-gradient(180deg, #e8f0f8 0%, #c0d8f0 15%, #90b8e0 30%, #6090c0 50%, #3868a0 70%, #1a3868 85%, #0a1830 100%)`,
  },
  {
    id: 'donghua-demon', label: '魔域炼狱', category: 'donghua', url: '', thumb: '',
    css: `radial-gradient(circle at 50% 50%, rgba(255,50,0,0.25) 0%, transparent 45%),
      radial-gradient(circle at 30% 30%, rgba(200,0,100,0.15) 0%, transparent 40%),
      radial-gradient(circle at 70% 70%, rgba(255,100,0,0.15) 0%, transparent 40%),
      linear-gradient(180deg, #0a0008 0%, #1a0010 15%, #300018 30%, #4a0020 45%, #3a0818 60%, #280010 75%, #180008 90%, #0a0004 100%)`,
  },
  // 抽象艺术
  { id: 'abstract', label: '抽象', category: 'abstract', url: "https://picsum.photos/id/1069/2070/1380", thumb: "https://picsum.photos/id/1069/200/130" },
  { id: 'texture', label: '纹理', category: 'abstract', url: "https://picsum.photos/id/1067/2070/1380", thumb: "https://picsum.photos/id/1067/200/130" },
  { id: 'dark-art', label: '暗调', category: 'abstract', url: "https://picsum.photos/id/1062/2070/1380", thumb: "https://picsum.photos/id/1062/200/130" },
  { id: 'minimal', label: '极简', category: 'abstract', url: "https://picsum.photos/id/1080/2070/1380", thumb: "https://picsum.photos/id/1080/200/130" },
  // 纯色渐变
  {
    id: 'gradient-purple', label: '紫韵', category: 'gradient', url: '', thumb: '',
    css: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  },
  {
    id: 'gradient-ocean', label: '海蓝', category: 'gradient', url: '', thumb: '',
    css: 'linear-gradient(135deg, #0c3483 0%, #a2b6df 50%, #6b8cce 100%)',
  },
  {
    id: 'gradient-sunset', label: '晚霞', category: 'gradient', url: '', thumb: '',
    css: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  },
  {
    id: 'gradient-forest', label: '翠林', category: 'gradient', url: '', thumb: '',
    css: 'linear-gradient(135deg, #0ba360 0%, #3cba92 50%, #30dd8a 100%)',
  },
  {
    id: 'gradient-dark', label: '深邃', category: 'gradient', url: '', thumb: '',
    css: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
  },
  {
    id: 'gradient-warm', label: '暖阳', category: 'gradient', url: '', thumb: '',
    css: 'linear-gradient(135deg, #f5af19 0%, #f12711 100%)',
  },
  // 节日主题
  {
    id: 'spring-fest', label: '🧧 新春', category: 'festival', url: '', thumb: '',
    css: `radial-gradient(circle at 20% 30%, rgba(255,215,0,0.35) 0%, transparent 35%),
      radial-gradient(circle at 80% 70%, rgba(255,215,0,0.25) 0%, transparent 35%),
      radial-gradient(circle at 50% 50%, rgba(255,215,0,0.08) 0%, transparent 60%),
      linear-gradient(135deg, #6b0000 0%, #b91c1c 25%, #dc2626 50%, #b91c1c 75%, #6b0000 100%)`,
  },
  {
    id: 'christmas', label: '🎄 圣诞', category: 'festival', url: '', thumb: '',
    css: 'linear-gradient(135deg, #165B33 0%, #146B3A 25%, #F8B229 50%, #BB2528 75%, #EA4630 100%)',
  },
];

export const PRIMARY_COLORS: { id: string; label: string; value: string; hex: string }[] = [
  { id: 'violet', label: '紫罗兰', value: 'rgba(139, 92, 246, var(--gradient-opacity))', hex: '#8b5cf6' },
  { id: 'blue', label: '蓝色', value: 'rgba(59, 130, 246, var(--gradient-opacity))', hex: '#3b82f6' },
  { id: 'emerald', label: '翠绿', value: 'rgba(16, 185, 129, var(--gradient-opacity))', hex: '#10b981' },
  { id: 'rose', label: '玫红', value: 'rgba(244, 63, 94, var(--gradient-opacity))', hex: '#f43f5e' },
  { id: 'amber', label: '琥珀', value: 'rgba(245, 158, 11, var(--gradient-opacity))', hex: '#f59e0b' },
  { id: 'red-gold', label: '红金', value: 'rgba(220, 38, 38, var(--gradient-opacity))', hex: '#dc2626' },
  { id: 'cyan', label: '青色', value: 'rgba(6, 182, 212, var(--gradient-opacity))', hex: '#06b6d4' },
  { id: 'indigo', label: '靛蓝', value: 'rgba(99, 102, 241, var(--gradient-opacity))', hex: '#6366f1' },
];

// Per-theme defaults: each theme has its own default bg + primary color
const THEME_DEFAULTS: Record<Theme, { bgId: string; primaryColorId: string }> = {
  light:  { bgId: 'mountain',    primaryColorId: 'violet' },
  dark:   { bgId: 'gradient-dark', primaryColorId: 'blue' },
  spring: { bgId: 'spring-fest', primaryColorId: 'red-gold' },
};

interface ThemePrefs { bgId: string; primaryColorId: string; animationEffect: AnimationEffect }

function loadThemePrefs(t: Theme): ThemePrefs {
  try {
    const raw = localStorage.getItem(`app_theme_prefs_${t}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        bgId: parsed.bgId || THEME_DEFAULTS[t].bgId,
        primaryColorId: parsed.primaryColorId || THEME_DEFAULTS[t].primaryColorId,
        animationEffect: parsed.animationEffect || 'none',
      };
    }
  } catch { /* ignore */ }
  return { ...THEME_DEFAULTS[t], animationEffect: 'none' };
}

function saveThemePrefs(t: Theme, prefs: Partial<ThemePrefs>) {
  const current = loadThemePrefs(t);
  const merged = { ...current, ...prefs };
  localStorage.setItem(`app_theme_prefs_${t}`, JSON.stringify(merged));
}

interface ThemeContextValue {
  theme: Theme;
  bgId: string;
  bgUrl: string;
  bgCss: string;
  primaryColorId: string;
  primaryHex: string;
  animationEffect: AnimationEffect;
  customBgs: BgOption[];
  setTheme: (t: Theme) => void;
  setBgId: (id: string) => void;
  setPrimaryColorId: (id: string) => void;
  setAnimationEffect: (e: AnimationEffect) => void;
  addCustomBg: (label: string, dataUrl: string) => void;
  removeCustomBg: (id: string) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  bgId: 'mountain',
  bgUrl: BG_OPTIONS[0].url,
  bgCss: '',
  primaryColorId: 'violet',
  primaryHex: '#8b5cf6',
  animationEffect: 'none',
  customBgs: [],
  setTheme: () => {},
  setBgId: () => {},
  setPrimaryColorId: () => {},
  setAnimationEffect: () => {},
  addCustomBg: () => {},
  removeCustomBg: () => {},
  toggleTheme: () => {},
});

function applyThemeClass(t: Theme) {
  const root = document.documentElement;
  root.classList.remove('dark', 'spring');
  if (t === 'dark') root.classList.add('dark');
  else if (t === 'spring') {
    root.classList.add('dark', 'spring');
  }
}

function applyPrimaryColor(colorId: string) {
  const color = PRIMARY_COLORS.find(c => c.id === colorId);
  if (color) {
    document.documentElement.style.setProperty('--primary-color', color.value);
    document.documentElement.style.setProperty('--primary-hex', color.hex);
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light');
  const [bgId, setBgIdState] = useState('mountain');
  const [primaryColorId, setPrimaryColorIdState] = useState('violet');
  const [animationEffect, setAnimationEffectState] = useState<AnimationEffect>('none');
  const [customBgs, setCustomBgs] = useState<BgOption[]>([]);

  // Apply a theme's prefs (bg + color) to state
  const applyThemePrefs = useCallback((t: Theme) => {
    const prefs = loadThemePrefs(t);
    setBgIdState(prefs.bgId);
    setPrimaryColorIdState(prefs.primaryColorId);
    setAnimationEffectState(prefs.animationEffect);
    applyPrimaryColor(prefs.primaryColorId);
  }, []);

  // Initialize from localStorage
  useEffect(() => {
    // Load custom backgrounds first
    try {
      const savedCustom = localStorage.getItem('app_custom_bgs');
      if (savedCustom) setCustomBgs(JSON.parse(savedCustom));
    } catch { /* ignore */ }

    // Migrate old single-key storage to per-theme prefs (one-time)
    const migrated = localStorage.getItem('app_theme_prefs_migrated');
    if (!migrated) {
      const oldBg = localStorage.getItem('app_bg');
      const oldColor = localStorage.getItem('app_primary_color');
      const oldTheme = localStorage.getItem('app_theme') as Theme | null;
      if (oldBg || oldColor) {
        // Save old values to the theme they belonged to
        const t = oldTheme || 'light';
        saveThemePrefs(t, {
          bgId: oldBg || THEME_DEFAULTS[t].bgId,
          primaryColorId: oldColor || THEME_DEFAULTS[t].primaryColorId,
        });
      }
      localStorage.setItem('app_theme_prefs_migrated', '1');
      // Clean up old keys
      localStorage.removeItem('app_bg');
      localStorage.removeItem('app_primary_color');
    }

    const saved = localStorage.getItem('app_theme') as Theme | null;
    if (saved === 'light' || saved === 'dark' || saved === 'spring') {
      setThemeState(saved);
      applyThemeClass(saved);
      applyThemePrefs(saved);
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setThemeState('dark');
      applyThemeClass('dark');
      applyThemePrefs('dark');
    } else {
      applyThemePrefs('light');
    }
  }, [applyThemePrefs]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem('app_theme', t);
    applyThemeClass(t);
    // Load this theme's saved prefs (or defaults)
    applyThemePrefs(t);
    fetch('/api/settings/global', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: t }),
    }).catch(() => {});
  }, [applyThemePrefs]);

  const setBgId = useCallback((id: string) => {
    setBgIdState(id);
    // Save to current theme's prefs
    saveThemePrefs(theme, { bgId: id });
  }, [theme]);

  const setPrimaryColorId = useCallback((id: string) => {
    setPrimaryColorIdState(id);
    applyPrimaryColor(id);
    // Save to current theme's prefs
    saveThemePrefs(theme, { primaryColorId: id });
  }, [theme]);

  const setAnimationEffect = useCallback((effect: AnimationEffect) => {
    setAnimationEffectState(effect);
    saveThemePrefs(theme, { animationEffect: effect });
  }, [theme]);

  const addCustomBg = useCallback((label: string, dataUrl: string) => {
    const id = `custom-${Date.now()}`;
    const newBg: BgOption = { id, label, url: dataUrl, thumb: dataUrl, category: 'custom' };
    setCustomBgs(prev => {
      const updated = [...prev, newBg];
      localStorage.setItem('app_custom_bgs', JSON.stringify(updated));
      return updated;
    });
    setBgIdState(id);
    saveThemePrefs(theme, { bgId: id });
  }, [theme]);

  const removeCustomBg = useCallback((id: string) => {
    setCustomBgs(prev => {
      const updated = prev.filter(b => b.id !== id);
      localStorage.setItem('app_custom_bgs', JSON.stringify(updated));
      return updated;
    });
    if (bgId === id) {
      const fallback = THEME_DEFAULTS[theme].bgId;
      setBgIdState(fallback);
      saveThemePrefs(theme, { bgId: fallback });
    }
  }, [bgId, theme]);

  const toggleTheme = useCallback(() => {
    const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'spring' : 'light';
    setTheme(next);
  }, [theme, setTheme]);

  const allBgs = [...BG_OPTIONS, ...customBgs];
  const bgOption = allBgs.find(b => b.id === bgId) || BG_OPTIONS[0];
  const bgUrl = bgOption.url;
  const bgCss = bgOption.css || '';
  const primaryHex = PRIMARY_COLORS.find(c => c.id === primaryColorId)?.hex || '#8b5cf6';

  return (
    <ThemeContext.Provider value={{ theme, bgId, bgUrl, bgCss, primaryColorId, primaryHex, animationEffect, customBgs, setTheme, setBgId, setPrimaryColorId, setAnimationEffect, addCustomBg, removeCustomBg, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
