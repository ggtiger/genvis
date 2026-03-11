'use client';

import { memo, useMemo, useState, useEffect } from 'react';

export type BackgroundAnimationType = 'none' | 'kenburns' | 'float' | 'pulse' | 'zoom-out';

interface AnimatedBackgroundProps {
  bgUrl?: string;
  bgCss?: string;
  animationType?: BackgroundAnimationType;
  className?: string;
}

/**
 * AnimatedBackground - 动画背景组件
 * 
 * 支持 Ken Burns 效果（缓慢缩放和平移），让静态背景图片有动态感
 * 
 * 动画类型：
 * - none: 无动画（静态背景）
 * - kenburns: Ken Burns 效果 - 缓慢缩放和平移组合
 * - float: 漂浮效果 - 轻微平移移动
 * - pulse: 呼吸效果 - 缓慢缩放
 * - zoom-out: 缓慢缩小效果
 */
function AnimatedBackground({ 
  bgUrl, 
  bgCss, 
  animationType = 'kenburns',
  className = ''
}: AnimatedBackgroundProps) {
  // 延迟启动动画，避免首次加载时的布局抖动
  const [isReady, setIsReady] = useState(false);
  
  // 随机选择一个动画变体，让不同页面/刷新时有不同的动画效果
  const animationVariant = useMemo(() => {
    return Math.floor(Math.random() * 4) + 1; // 1-4
  }, []);

  // 延迟启动动画，确保页面布局稳定后再开始
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsReady(true);
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // 如果是 CSS 渐变背景，添加动态渐变动画
  if (bgCss) {
    return (
      <div 
        className={`fixed inset-0 -z-10 ${className}`}
        style={{ 
          background: bgCss,
          backgroundSize: '200% 200%',
          animation: isReady && animationType !== 'none' ? 'gradientShift 15s ease infinite' : undefined,
        }}
      />
    );
  }

  // 如果没有背景 URL，不渲染
  if (!bgUrl) {
    return null;
  }

  // 根据动画类型选择样式
  const getAnimationStyle = () => {
    const baseStyle = {
      backgroundImage: `url('${bgUrl}')`,
      backgroundRepeat: 'no-repeat' as const,
      backgroundPosition: 'center center' as const,
      backgroundSize: 'cover' as const,
    };

    if (animationType === 'none' || !isReady) {
      return baseStyle;
    }

    // Ken Burns 和其他动画效果
    return {
      ...baseStyle,
      willChange: 'transform',
      animation: animationType === 'kenburns' 
        ? `kenBurns${animationVariant} 30s ease-in-out infinite alternate`
        : animationType === 'float'
        ? `bgFloat 20s ease-in-out infinite`
        : animationType === 'pulse'
        ? `bgPulse 15s ease-in-out infinite`
        : `bgZoomOut 25s ease-out infinite`,
    };
  };

  return (
    <div 
      className={`fixed inset-0 -z-10 ${className}`}
      style={getAnimationStyle()}
    />
  );
}

export default memo(AnimatedBackground);
