const { contextBridge, ipcRenderer } = require('electron');

/**
 * Define a safe bridge accessible from the renderer.
 * Extend the required APIs below.
 */
contextBridge.exposeInMainWorld('desktopAPI', {
  ping: () => ipcRenderer.invoke('ping'),

  // 获取应用版本
  getAppVersion: () => {
    const versionArg = process.argv.find(arg => arg.startsWith('--app-version='));
    return versionArg ? versionArg.split('=')[1] : 'Unknown';
  },

  // 窗口控制API
  windowControls: {
    minimize: () => ipcRenderer.invoke('window-control', { action: 'minimize' }),
    maximizeOrRestore: () => ipcRenderer.invoke('window-control', { action: 'toggle-maximize' }),
    close: () => ipcRenderer.invoke('window-control', { action: 'close' }),
    getState: () => ipcRenderer.invoke('get-window-state'),
    onStateChange: (callback) => {
      if (typeof callback !== 'function') {
        return () => {};
      }
      const handler = (event, state) => callback(state);
      ipcRenderer.on('window-state-changed', handler);
      return () => ipcRenderer.removeListener('window-state-changed', handler);
    },
    // Window size control (for slim mode)
    setSize: (options) => ipcRenderer.invoke('set-window-size', options),
    getSize: () => ipcRenderer.invoke('get-window-size')
  },

  // 导航控制API
  navigationControls: {
    goBack: () => ipcRenderer.invoke('window-navigation', { action: 'back' }),
    goForward: () => ipcRenderer.invoke('window-navigation', { action: 'forward' }),
    refresh: (force = false) => ipcRenderer.invoke('window-navigation', { action: force ? 'force-refresh' : 'refresh' }),
    toggleDevTools: () => ipcRenderer.invoke('window-navigation', { action: 'toggle-devtools' }),
    getState: () => ipcRenderer.invoke('get-navigation-state'),
    onStateChange: (callback) => {
      if (typeof callback !== 'function') {
        return () => {};
      }
      const handler = (event, state) => callback(state);
      ipcRenderer.on('navigation-state-changed', handler);
      return () => ipcRenderer.removeListener('navigation-state-changed', handler);
    }
  },

  // 打开外部链接
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // 选择目录
  selectDirectory: () => ipcRenderer.invoke('select-directory'),

  // Open folder in system file manager
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),

  // Open new window with options
  openNewWindow: (options) => ipcRenderer.invoke('open-new-window', options),

  // Arrange slim windows in grid
  arrangeSlimWindows: () => ipcRenderer.invoke('arrange-slim-windows'),

  // 通知主进程应用页面已完全加载（用于关闭启动页）
  appReady: () => ipcRenderer.invoke('app-ready'),
});

// ==================== 自定义标题栏实现 ====================

const SHOULD_USE_CUSTOM_TITLEBAR = process.argv.includes('--enable-custom-titlebar');
const TITLEBAR_ID = 'electron-custom-titlebar';
const TITLEBAR_STYLE_ID = 'electron-custom-titlebar-style';
const TITLEBAR_HEIGHT = 40;
const APP_ROOT_CLASS = 'electron-app-root';

// 从启动参数中读取版本号
const getAppVersion = () => {
  const versionArg = process.argv.find(arg => arg.startsWith('--app-version='));
  return versionArg ? versionArg.split('=')[1] : 'Unknown';
};
const APP_VERSION = getAppVersion();

const ensureLayoutStyles = () => {
  if (document.getElementById(TITLEBAR_STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = TITLEBAR_STYLE_ID;
  style.textContent = `
:root.electron-custom-titlebar-active {
  --electron-titlebar-height: ${TITLEBAR_HEIGHT}px;
  scroll-padding-top: ${TITLEBAR_HEIGHT}px;
}
/* 不限制html和body的overflow，让页面正常滚动 */
body.electron-custom-titlebar-active {
  margin: 0;
  box-sizing: border-box;
}
`;

  (document.head || document.documentElement).appendChild(style);
};

const createToolbarButton = (label, ariaLabel, options = {}) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', ariaLabel);
  button.textContent = label;
  Object.assign(button.style, {
    width: options.width || '34px',
    height: options.height || '26px',
    border: 'none',
    borderRadius: '4px',
    backgroundColor: 'transparent',
    color: '#e2e8f0',
    fontSize: options.fontSize || '14px',
    fontWeight: options.fontWeight || 'normal',
    cursor: 'pointer',
    transition: 'background-color 0.15s ease, opacity 0.1s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  });
  button.style.webkitAppRegion = 'no-drag';

  const setBackground = (value) => {
    button.style.backgroundColor = value;
  };

  button.addEventListener('mouseenter', () => {
    if (!button.disabled) {
      setBackground('rgba(255, 255, 255, 0.12)');
    }
  });
  button.addEventListener('mouseleave', () => setBackground('transparent'));
  button.addEventListener('mousedown', (event) => {
    event.stopPropagation();
    if (!button.disabled) {
      setBackground('rgba(255, 255, 255, 0.2)');
    }
  });
  button.addEventListener('mouseup', () => {
    if (!button.disabled) {
      setBackground('rgba(255, 255, 255, 0.12)');
    }
  });

  return button;
};

const applyLayoutAdjustments = (body, titleBar) => {
  ensureLayoutStyles();

  const htmlElement = document.documentElement;
  htmlElement.classList.add('electron-custom-titlebar-active');
  body.classList.add('electron-custom-titlebar-active');

  // 设置CSS变量，供全局CSS使用
  htmlElement.style.setProperty('--electron-titlebar-height', `${TITLEBAR_HEIGHT}px`);

  // 简化布局调整 - 只设置body的padding-top
  const computedPadding = parseFloat(window.getComputedStyle(body).paddingTop || '0') || 0;
  body.dataset.electronOriginalPaddingTop = String(computedPadding);
  body.style.paddingTop = `${computedPadding + TITLEBAR_HEIGHT}px`;

  // 不强制设置overflow和height，让页面自然滚动
  // body.style.height = '100vh';
  // body.style.minHeight = '100vh';
  // body.style.boxSizing = 'border-box';
  // body.style.overflow = 'hidden';
  // htmlElement.style.overflow = 'hidden';
  // htmlElement.style.height = '100vh';
  // htmlElement.style.minHeight = '100vh';

  htmlElement.style.scrollPaddingTop = `${TITLEBAR_HEIGHT}px`;

  // 不再强制识别和调整app root，让CSS处理
  // const appRootCandidate = Array.from(body.children)
  //   .find((node) => {
  //     if (node === titleBar || node.nodeType !== Node.ELEMENT_NODE) {
  //       return false;
  //     }
  //     const tagName = node.tagName || '';
  //     return tagName.toLowerCase() !== 'script' && tagName.toLowerCase() !== 'style';
  //   });
  // if (appRootCandidate) {
  //   appRootCandidate.classList.add(APP_ROOT_CLASS);
  // }
};

const initCustomTitleBar = () => {
  if (!SHOULD_USE_CUSTOM_TITLEBAR) {
    return;
  }

  if (!document || document.getElementById(TITLEBAR_ID)) {
    return;
  }

  const body = document.body;
  if (!body) {
    window.requestAnimationFrame(initCustomTitleBar);
    return;
  }

  const titleBar = document.createElement('div');
  titleBar.id = TITLEBAR_ID;

  // macOS 需要更大的左侧 padding 以避免红绿灯按钮遮挡标题
  const isMac = process.platform === 'darwin';
  // Windows/Linux 也需要为红绿灯留出空间
  const leftPadding = isMac ? '80px' : '12px';

  Object.assign(titleBar.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    height: `${TITLEBAR_HEIGHT}px`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `0 12px 0 ${leftPadding}`,
    background: 'linear-gradient(90deg, #0f172a, #1e293b)',
    color: '#e2e8f0',
    fontFamily: '"Segoe UI", "PingFang SC", "Microsoft Yahei", sans-serif',
    fontSize: '14px',
    zIndex: '2147483646',
    boxSizing: 'border-box',
    boxShadow: '0 1px 6px rgba(0, 0, 0, 0.35)'
  });
  titleBar.style.webkitAppRegion = 'drag';

  const navGroup = document.createElement('div');
  Object.assign(navGroup.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '4px'
  });
  navGroup.style.webkitAppRegion = 'no-drag';
  navGroup.addEventListener('dblclick', (event) => event.stopPropagation());

  const leftSection = document.createElement('div');
  Object.assign(leftSection.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flex: '1',
    minWidth: '0'
  });
  leftSection.style.webkitAppRegion = 'drag';

  const rightSection = document.createElement('div');
  Object.assign(rightSection.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  });
  rightSection.style.webkitAppRegion = 'no-drag';

  // Refresh button
  const refreshButton = createToolbarButton('⟳', '刷新', {
    width: '30px',
    height: '24px',
    fontSize: '13px'
  });
  refreshButton.addEventListener('click', async (event) => {
    event.stopPropagation();
    const action = event.shiftKey ? 'force-refresh' : 'refresh';
    try {
      await ipcRenderer.invoke('window-navigation', { action });
    } catch (error) {
      console.error('执行刷新操作失败:', error);
    }
  });

  navGroup.appendChild(refreshButton);

  // Slim mode toggle button - placed in left section before title
  const SLIM_MODE_KEY = 'genvis_slim_mode';
  const slimModeButton = createToolbarButton('⊟', '瘦身模式', {
    width: '28px',
    height: '24px',
    fontSize: '14px'
  });
  slimModeButton.id = 'electron-slim-mode-button';
  slimModeButton.style.webkitAppRegion = 'no-drag';

  // Initialize button state from localStorage
  const updateSlimButtonState = () => {
    const isSlim = localStorage.getItem(SLIM_MODE_KEY) === 'true';
    slimModeButton.textContent = isSlim ? '⊞' : '⊟';
    slimModeButton.style.color = isSlim ? '#38bdf8' : '#e2e8f0';
  };
  updateSlimButtonState();

  slimModeButton.addEventListener('click', async (event) => {
    event.stopPropagation();

    // Shift+click: arrange all slim windows
    if (event.shiftKey) {
      try {
        await ipcRenderer.invoke('arrange-slim-windows');
      } catch (error) {
        console.error('Failed to arrange slim windows:', error);
      }
      return;
    }

    // Normal click: toggle slim mode
    // Dispatch custom event for React to handle (useSlimMode hook will update localStorage)
    window.dispatchEvent(new CustomEvent('electron-toggle-slim-mode'));
    // Update button appearance after a brief delay to allow React to update localStorage
    setTimeout(updateSlimButtonState, 50);
  });

  // Listen for slim mode changes from React
  window.addEventListener('genvis-slim-mode-changed', () => {
    updateSlimButtonState();
  });

  const titleSection = document.createElement('div');
  Object.assign(titleSection.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontWeight: '500',
    minWidth: '0'
  });
  titleSection.style.webkitAppRegion = 'drag';

  const statusDot = document.createElement('span');
  Object.assign(statusDot.style, {
    width: '8px',
    height: '8px',
    borderRadius: '999px',
    backgroundColor: '#38bdf8',
    display: 'inline-block',
    boxShadow: '0 0 8px rgba(56, 189, 248, 0.6)'
  });

  const titleText = document.createElement('span');
  titleText.textContent = `G.E.N.V.I.S 预览版 V${APP_VERSION}`;
  Object.assign(titleText.style, {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  });

  titleSection.appendChild(statusDot);
  titleSection.appendChild(titleText);

  // ===== Windows/Linux 红绿灯窗口控制按钮 =====
  const trafficLightContainer = document.createElement('div');
  Object.assign(trafficLightContainer.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '0 4px'
  });
  trafficLightContainer.style.webkitAppRegion = 'no-drag';
  trafficLightContainer.addEventListener('dblclick', (event) => event.stopPropagation());

  const TRAFFIC_LIGHT_SIZE = '13px';
  const TRAFFIC_COLORS = {
    close:    { bg: '#ff5f57', hover: '#ff3b30', active: '#bf4040' },
    minimize: { bg: '#febc2e', hover: '#f0a500', active: '#c89320' },
    maximize: { bg: '#28c840', hover: '#1aab32', active: '#1a9b30' }
  };

  // SVG 图标（hover 时显示）
  const TRAFFIC_ICONS = {
    close:    '<svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 1l6 6M7 1l-6 6" stroke="rgba(0,0,0,0.5)" stroke-width="1.2" stroke-linecap="round"/></svg>',
    minimize: '<svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 4h6" stroke="rgba(0,0,0,0.5)" stroke-width="1.2" stroke-linecap="round"/></svg>',
    maximize: '<svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 1l3 3-3 3M4.5 1l3 3-3 3" stroke="rgba(0,0,0,0.5)" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
    restore:  '<svg width="8" height="8" viewBox="0 0 8 8"><path d="M7 1L4 4l3 3M3.5 1L.5 4l3 3" stroke="rgba(0,0,0,0.5)" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>'
  };

  const createTrafficButton = (type, ariaLabel) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-label', ariaLabel);
    btn.className = 'traffic-light-btn';
    const colors = TRAFFIC_COLORS[type];
    Object.assign(btn.style, {
      width: TRAFFIC_LIGHT_SIZE,
      height: TRAFFIC_LIGHT_SIZE,
      borderRadius: '50%',
      border: 'none',
      backgroundColor: colors.bg,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0',
      transition: 'background-color 0.1s ease, transform 0.1s ease',
      boxShadow: `inset 0 0 0 0.5px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.15)`
    });
    btn.style.webkitAppRegion = 'no-drag';
    // 内部 SVG 容器
    const iconSpan = document.createElement('span');
    Object.assign(iconSpan.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      opacity: '0',
      transition: 'opacity 0.12s ease',
      lineHeight: '0'
    });
    btn.appendChild(iconSpan);

    btn.addEventListener('mouseenter', () => {
      btn.style.backgroundColor = colors.hover;
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.backgroundColor = colors.bg;
    });
    btn.addEventListener('mousedown', (event) => {
      event.stopPropagation();
      btn.style.backgroundColor = colors.active;
      btn.style.transform = 'scale(0.9)';
    });
    btn.addEventListener('mouseup', () => {
      btn.style.backgroundColor = colors.hover;
      btn.style.transform = 'scale(1)';
    });

    return { btn, iconSpan };
  };

  const { btn: closeButton, iconSpan: closeIcon } = createTrafficButton('close', '关闭窗口');
  closeIcon.innerHTML = TRAFFIC_ICONS.close;
  closeButton.addEventListener('click', (event) => {
    event.stopPropagation();
    ipcRenderer.invoke('window-control', { action: 'close' });
  });

  const { btn: minimizeButton, iconSpan: minimizeIcon } = createTrafficButton('minimize', '最小化');
  minimizeIcon.innerHTML = TRAFFIC_ICONS.minimize;
  minimizeButton.addEventListener('click', (event) => {
    event.stopPropagation();
    ipcRenderer.invoke('window-control', { action: 'minimize' });
  });

  const { btn: maximizeButton, iconSpan: maximizeIcon } = createTrafficButton('maximize', '最大化或还原');
  maximizeIcon.innerHTML = TRAFFIC_ICONS.maximize;
  const updateMaximizeVisual = (isMaximized = false) => {
    maximizeButton.setAttribute('data-maximized', isMaximized ? 'true' : 'false');
    maximizeIcon.innerHTML = isMaximized ? TRAFFIC_ICONS.restore : TRAFFIC_ICONS.maximize;
    maximizeButton.setAttribute('aria-label', isMaximized ? '还原窗口' : '最大化窗口');
  };
  maximizeButton.addEventListener('click', async (event) => {
    event.stopPropagation();
    try {
      const response = await ipcRenderer.invoke('window-control', { action: 'toggle-maximize' });
      if (response && response.state) {
        updateMaximizeVisual(response.state.isMaximized);
      }
    } catch (error) {
      console.error('切换窗口大小失败:', error);
    }
  });

  // 红绿灯容器 hover 时显示所有图标
  trafficLightContainer.appendChild(closeButton);
  trafficLightContainer.appendChild(minimizeButton);
  trafficLightContainer.appendChild(maximizeButton);

  trafficLightContainer.addEventListener('mouseenter', () => {
    trafficLightContainer.querySelectorAll('.traffic-light-btn span').forEach(s => {
      s.style.opacity = '1';
    });
  });
  trafficLightContainer.addEventListener('mouseleave', () => {
    trafficLightContainer.querySelectorAll('.traffic-light-btn span').forEach(s => {
      s.style.opacity = '0';
    });
  });

  const devToolsButton = createToolbarButton('</>', '切换开发者工具', {
    width: '42px',
    fontSize: '13px'
  });
  // 永远显示开发者工具按钮
  devToolsButton.style.display = 'flex';
  devToolsButton.addEventListener('click', (event) => {
    event.stopPropagation();
    ipcRenderer.invoke('window-navigation', { action: 'toggle-devtools' });
  });

  // 新窗口按钮
  const newWindowButton = createToolbarButton('+', '新建窗口', {
    width: '34px',
    fontSize: '18px',
    fontWeight: 'bold'
  });
  newWindowButton.addEventListener('click', async (event) => {
    event.stopPropagation();
    try {
      // Check if current window is in slim mode, pass to new window
      const isSlimMode = localStorage.getItem(SLIM_MODE_KEY) === 'true';
      const result = await ipcRenderer.invoke('open-new-window', { slimMode: isSlimMode });
      if (!result.success && result.message) {
        // 显示提示信息（可选：使用 alert 或其他方式）
        alert(result.message);
      }
    } catch (error) {
      console.error('打开新窗口失败:', error);
    }
  });

  // Windows/Linux: 红绿灯按钮放在左侧（类似 macOS 风格）
  if (!isMac) {
    leftSection.appendChild(trafficLightContainer);
  }

  leftSection.appendChild(slimModeButton);
  leftSection.appendChild(titleSection);

  rightSection.appendChild(navGroup);
  rightSection.appendChild(devToolsButton);
  rightSection.appendChild(newWindowButton);

  titleBar.appendChild(leftSection);
  titleBar.appendChild(rightSection);

  body.prepend(titleBar);
  applyLayoutAdjustments(body, titleBar);

  ipcRenderer.invoke('get-window-state')
    .then((state) => updateMaximizeVisual(state?.isMaximized))
    .catch(() => updateMaximizeVisual(false));

  ipcRenderer.on('window-state-changed', (event, state) => {
    updateMaximizeVisual(state?.isMaximized);
  });

  titleBar.addEventListener('dblclick', () => {
    ipcRenderer.invoke('window-control', { action: 'toggle-maximize' });
  });
};

if (SHOULD_USE_CUSTOM_TITLEBAR) {
  // 延迟创建，等待 React hydration 完成
  const createTitleBarAfterHydration = () => {
    console.log('[Preload] 准备创建标题栏...');

    // 使用 requestIdleCallback 或 setTimeout 兆底，确保在浏览器空闲时执行
    const scheduleInit = (callback) => {
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(callback, { timeout: 500 });
      } else {
        setTimeout(callback, 300);
      }
    };

    scheduleInit(() => {
      console.log('[Preload] 开始创建标题栏（React hydration 后）');
      initCustomTitleBar();

      // 监听 DOM 变化，如果标题栏被删除则重新创建
      const observer = new MutationObserver(() => {
        if (!document.getElementById(TITLEBAR_ID)) {
          console.log('[Preload] 标题栏被删除，重新创建...');
          initCustomTitleBar();
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: false
      });
    });
  };

  if (document.readyState === 'complete') {
    createTitleBarAfterHydration();
  } else {
    window.addEventListener('load', createTitleBarAfterHydration, { once: true });
  }
}

// ==================== Windows/Linux 浮动红绿灯 ====================
// 在非 macOS 平台上添加浮动红绿灯按钮（不需要头部栏，与 macOS 原生红绿灯位置一致）
if (process.platform !== 'darwin' && !SHOULD_USE_CUSTOM_TITLEBAR) {
  const FLOATING_TL_ID = 'electron-floating-traffic-lights';

  const injectFloatingTrafficLights = () => {
    if (document.getElementById(FLOATING_TL_ID)) return;
    const body = document.body;
    if (!body) { window.requestAnimationFrame(injectFloatingTrafficLights); return; }

    // 容器：定位与 macOS trafficLightPosition { x: 25, y: 15 } 一致
    const container = document.createElement('div');
    container.id = FLOATING_TL_ID;
    Object.assign(container.style, {
      position: 'fixed',
      top: '15px',
      left: '25px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      zIndex: '2147483646',
      padding: '0',
      pointerEvents: 'auto'
    });
    container.style.webkitAppRegion = 'no-drag';
    container.addEventListener('dblclick', (e) => e.stopPropagation());

    const TL_SIZE = '13px';
    const TL_COLORS = {
      close:    { bg: '#ff5f57', hover: '#ff3b30', active: '#bf4040' },
      minimize: { bg: '#febc2e', hover: '#f0a500', active: '#c89320' },
      maximize: { bg: '#28c840', hover: '#1aab32', active: '#1a9b30' }
    };
    const TL_ICONS = {
      close:    '<svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 1l6 6M7 1l-6 6" stroke="rgba(0,0,0,0.5)" stroke-width="1.2" stroke-linecap="round"/></svg>',
      minimize: '<svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 4h6" stroke="rgba(0,0,0,0.5)" stroke-width="1.2" stroke-linecap="round"/></svg>',
      maximize: '<svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 1l3 3-3 3M4.5 1l3 3-3 3" stroke="rgba(0,0,0,0.5)" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
      restore:  '<svg width="8" height="8" viewBox="0 0 8 8"><path d="M7 1L4 4l3 3M3.5 1L.5 4l3 3" stroke="rgba(0,0,0,0.5)" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>'
    };

    const makeTLBtn = (type, label) => {
      const colors = TL_COLORS[type];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('aria-label', label);
      btn.className = 'floating-tl-btn';
      Object.assign(btn.style, {
        width: TL_SIZE, height: TL_SIZE,
        borderRadius: '50%', border: 'none',
        backgroundColor: colors.bg, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '0',
        transition: 'background-color 0.1s ease, transform 0.1s ease',
        boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.15)'
      });
      btn.style.webkitAppRegion = 'no-drag';

      const icon = document.createElement('span');
      Object.assign(icon.style, {
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: '0', transition: 'opacity 0.12s ease', lineHeight: '0'
      });
      btn.appendChild(icon);

      btn.addEventListener('mouseenter', () => { btn.style.backgroundColor = colors.hover; });
      btn.addEventListener('mouseleave', () => { btn.style.backgroundColor = colors.bg; });
      btn.addEventListener('mousedown', (e) => {
        e.stopPropagation(); btn.style.backgroundColor = colors.active; btn.style.transform = 'scale(0.9)';
      });
      btn.addEventListener('mouseup', () => {
        btn.style.backgroundColor = colors.hover; btn.style.transform = 'scale(1)';
      });
      return { btn, icon };
    };

    // 关闭
    const { btn: closeBtn, icon: closeIcon } = makeTLBtn('close', '关闭窗口');
    closeIcon.innerHTML = TL_ICONS.close;
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation(); ipcRenderer.invoke('window-control', { action: 'close' });
    });

    // 最小化
    const { btn: minBtn, icon: minIcon } = makeTLBtn('minimize', '最小化');
    minIcon.innerHTML = TL_ICONS.minimize;
    minBtn.addEventListener('click', (e) => {
      e.stopPropagation(); ipcRenderer.invoke('window-control', { action: 'minimize' });
    });

    // 最大化/还原
    const { btn: maxBtn, icon: maxIcon } = makeTLBtn('maximize', '最大化或还原');
    maxIcon.innerHTML = TL_ICONS.maximize;
    const updateMaxIcon = (isMax = false) => {
      maxIcon.innerHTML = isMax ? TL_ICONS.restore : TL_ICONS.maximize;
      maxBtn.setAttribute('aria-label', isMax ? '还原窗口' : '最大化窗口');
    };
    maxBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const res = await ipcRenderer.invoke('window-control', { action: 'toggle-maximize' });
        if (res && res.state) updateMaxIcon(res.state.isMaximized);
      } catch (err) { console.error('切换最大化失败:', err); }
    });

    container.appendChild(closeBtn);
    container.appendChild(minBtn);
    container.appendChild(maxBtn);

    // hover 容器时显示所有图标
    container.addEventListener('mouseenter', () => {
      container.querySelectorAll('.floating-tl-btn span').forEach(s => { s.style.opacity = '1'; });
    });
    container.addEventListener('mouseleave', () => {
      container.querySelectorAll('.floating-tl-btn span').forEach(s => { s.style.opacity = '0'; });
    });

    body.appendChild(container);

    // 同步最大化状态
    ipcRenderer.invoke('get-window-state')
      .then((state) => updateMaxIcon(state?.isMaximized))
      .catch(() => updateMaxIcon(false));
    ipcRenderer.on('window-state-changed', (_event, state) => {
      updateMaxIcon(state?.isMaximized);
    });
  };

  // 等待 DOM 准备就绪后注入
  const scheduleInject = () => {
    const doInject = () => {
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(injectFloatingTrafficLights, { timeout: 500 });
      } else {
        setTimeout(injectFloatingTrafficLights, 300);
      }
    };
    if (document.readyState === 'complete') {
      doInject();
    } else {
      window.addEventListener('load', doInject, { once: true });
    }
  };
  scheduleInject();

  // 如果被意外移除则重新注入
  const tlObserver = new MutationObserver(() => {
    if (document.body && !document.getElementById(FLOATING_TL_ID)) {
      injectFloatingTrafficLights();
    }
  });
  if (document.body) {
    tlObserver.observe(document.body, { childList: true, subtree: false });
  } else {
    window.addEventListener('DOMContentLoaded', () => {
      tlObserver.observe(document.body, { childList: true, subtree: false });
    }, { once: true });
  }
}
