"use client";

import { useState } from 'react';
import { useTheme, THEME_OPTIONS, BG_OPTIONS, BG_CATEGORIES, PRIMARY_COLORS, ANIMATION_OPTIONS, type BgOption } from '@/contexts/ThemeContext';

interface AppearanceTabProps {
  // Props can be added here if needed
}

export default function AppearanceTab(_props: AppearanceTabProps) {
  const { theme, setTheme, bgId, setBgId, primaryColorId, setPrimaryColorId, primaryHex, animationEffect, setAnimationEffect, customBgs, addCustomBg, removeCustomBg } = useTheme();
  const [bgCategory, setBgCategory] = useState('nature');
  const sectionClass = "space-y-3";
  const titleClass = "text-sm font-medium text-gray-700 dark:text-gray-200 mb-3";

  const allBgs: BgOption[] = [...BG_OPTIONS, ...customBgs];
  const filteredBgs = allBgs.filter(bg => bg.category === bgCategory);

  const handleUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) { alert('图片不能超过 10MB'); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const name = file.name.replace(/\.[^.]+$/, '').slice(0, 10);
        addCustomBg(name || '自定义', dataUrl);
        setBgCategory('custom');
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  // Active selection style using primary color
  const activeRing = `border-[var(--primary-hex)] ring-2 ring-[var(--primary-hex)]/30`;
  const activeBg = `bg-[var(--primary-hex)]/10`;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">外观设置</h3>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            当前编辑：{THEME_OPTIONS.find(o => o.id === theme)?.emoji} {THEME_OPTIONS.find(o => o.id === theme)?.label}主题 · 壁纸和主题色会独立保存到每个主题
          </p>
        </div>
      </div>

      {/* Theme mode */}
      <div className={sectionClass}>
        <div className={titleClass}>主题模式</div>
        <div className="grid grid-cols-3 gap-3">
          {THEME_OPTIONS.map(opt => (
            <button
              key={opt.id}
              onClick={() => setTheme(opt.id)}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors ${
                theme === opt.id
                  ? 'shadow-sm'
                  : 'border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20'
              }`}
              style={theme === opt.id ? { borderColor: primaryHex, backgroundColor: `${primaryHex}15` } : undefined}
            >
              <span className="text-2xl">{opt.emoji}</span>
              <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{opt.label}</span>
              <span className="text-[10px] text-gray-500 dark:text-gray-400">{opt.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Background with categories */}
      <div className={sectionClass}>
        <div className="flex items-center justify-between">
          <div className={titleClass}>背景壁纸</div>
          <button
            onClick={handleUpload}
            className="text-xs px-3 py-1 rounded-lg transition-colors text-white"
            style={{ backgroundColor: primaryHex }}
          >
            + 上传壁纸
          </button>
        </div>
        {/* Category tabs */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {BG_CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setBgCategory(cat.id)}
              className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                bgCategory === cat.id
                  ? 'text-white shadow-sm'
                  : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10'
              }`}
              style={bgCategory === cat.id ? { backgroundColor: primaryHex } : undefined}
            >
              {cat.label}
              {cat.id === 'custom' && customBgs.length > 0 && ` (${customBgs.length})`}
            </button>
          ))}
        </div>
        {/* Anime/Donghua category tip */}
        {(bgCategory === 'anime' || bgCategory === 'donghua') && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-xs text-amber-700 dark:text-amber-400 mb-2">
            <span>💡</span>
            <span>{bgCategory === 'anime' ? '以下为动漫色调壁纸，想要真正的二次元壁纸？' : '以下为国漫风格色调壁纸，想要真正的国漫壁纸？'}点击右上角「上传壁纸」添加你喜欢的图片</span>
          </div>
        )}
        {/* Wallpaper grid */}
        {filteredBgs.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-400 dark:text-gray-500">
            {bgCategory === 'custom' ? '还没有上传壁纸，点击上方按钮上传' : '该分类暂无壁纸'}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {filteredBgs.map(bg => (
              <div key={bg.id} className="relative group">
                <button
                  onClick={() => setBgId(bg.id)}
                  className={`relative rounded-xl overflow-hidden border-2 transition-colors aspect-video w-full ${
                    bgId === bg.id
                      ? 'shadow-md'
                      : 'border-gray-200 dark:border-white/10 hover:border-gray-300'
                  }`}
                  style={bgId === bg.id ? { borderColor: primaryHex, boxShadow: `0 0 0 2px ${primaryHex}30` } : undefined}
                >
                  {bg.thumb ? (
                    <img src={bg.thumb} alt={bg.label} className="w-full h-full object-cover" loading="lazy" />
                  ) : bg.css ? (
                    <div className="w-full h-full" style={{ background: bg.css }} />
                  ) : (
                    <div className="w-full h-full bg-gray-200 dark:bg-gray-700" />
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1">
                    <span className="text-[11px] text-white font-medium">{bg.label}</span>
                  </div>
                  {bgId === bg.id && (
                    <div className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center" style={{ backgroundColor: primaryHex }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    </div>
                  )}
                </button>
                {/* Delete button for custom wallpapers */}
                {bg.category === 'custom' && (
                  <button
                    onClick={() => removeCustomBg(bg.id)}
                    className="absolute top-1 left-1 w-5 h-5 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    title="删除"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Primary color */}
      <div className={sectionClass}>
        <div className={titleClass}>主题色</div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">主题色将应用于按钮、选中状态、光效等全局元素</p>
        <div className="flex flex-wrap gap-3">
          {PRIMARY_COLORS.map(c => (
            <button
              key={c.id}
              onClick={() => setPrimaryColorId(c.id)}
              className={`w-10 h-10 rounded-lg transition-all ${
                primaryColorId === c.id
                  ? 'ring-2 ring-offset-2 scale-110'
                  : 'hover:scale-105'
              }`}
              style={{
                backgroundColor: c.hex,
                borderColor: primaryColorId === c.id ? primaryHex : 'transparent'
              }}
              title={c.label}
            />
          ))}
        </div>
      </div>

      {/* Animation effect */}
      <div className={sectionClass}>
        <div className={titleClass}>动画效果</div>
        <div className="grid grid-cols-3 gap-3">
          {ANIMATION_OPTIONS.map(opt => (
            <button
              key={opt.id}
              onClick={() => setAnimationEffect(opt.id)}
              className={`flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-colors ${
                animationEffect === opt.id
                  ? 'shadow-sm'
                  : 'border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20'
              }`}
              style={animationEffect === opt.id ? { borderColor: primaryHex, backgroundColor: `${primaryHex}15` } : undefined}
            >
              <span className="text-xl">{opt.emoji}</span>
              <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{opt.label}</span>
              <span className="text-[10px] text-gray-500 dark:text-gray-400">{opt.desc}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
