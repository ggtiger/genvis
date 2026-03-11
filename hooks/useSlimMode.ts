"use client";

import { useState, useEffect } from 'react';

const SLIM_MODE_KEY = 'genvis_slim_mode';
const SLIM_PREVIOUS_SIZE_KEY = 'genvis_slim_previous_size';
const SLIM_MODE_EVENT = 'genvis-slim-mode-changed';

const SLIM_WIDTH = 420;
const SLIM_HEIGHT = 550;
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;
const NORMAL_MIN_WIDTH = 1024;
const NORMAL_MIN_HEIGHT = 640;

/**
 * Global hook for managing slim mode state.
 * Slim mode only controls window size - layout adapts via CSS media queries.
 */
export function useSlimMode() {
  const [isSlimMode, setIsSlimMode] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const saved = localStorage.getItem(SLIM_MODE_KEY);
    if (saved === 'true') {
      setIsSlimMode(true);
    }
    setIsInitialized(true);
  }, []);

  // Listen for toggle event from title bar
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleTitleBarToggle = async () => {
      const desktopAPI = (window as any).desktopAPI;
      const currentSlimMode = localStorage.getItem(SLIM_MODE_KEY) === 'true';
      const newSlimMode = !currentSlimMode;

      // Update localStorage and state
      localStorage.setItem(SLIM_MODE_KEY, String(newSlimMode));
      setIsSlimMode(newSlimMode);

      // Dispatch event for other listeners (like preload.js button state)
      window.dispatchEvent(new CustomEvent(SLIM_MODE_EVENT, { detail: { isSlimMode: newSlimMode } }));

      // Handle window resize
      if (desktopAPI?.windowControls?.setSize && desktopAPI?.windowControls?.getSize) {
        try {
          if (newSlimMode) {
            // Entering slim mode: save current size to localStorage and resize
            const currentSize = await desktopAPI.windowControls.getSize();
            if (currentSize.width > 500) {
              localStorage.setItem(SLIM_PREVIOUS_SIZE_KEY, JSON.stringify(currentSize));
              await desktopAPI.windowControls.setSize({
                width: SLIM_WIDTH,
                height: SLIM_HEIGHT,
                minWidth: 400,
                minHeight: 400
              });
            }
          } else {
            // Exiting slim mode: restore previous size from localStorage
            const savedSize = localStorage.getItem(SLIM_PREVIOUS_SIZE_KEY);
            if (savedSize) {
              const previousSize = JSON.parse(savedSize);
              await desktopAPI.windowControls.setSize({
                width: previousSize.width,
                height: previousSize.height,
                minWidth: NORMAL_MIN_WIDTH,
                minHeight: NORMAL_MIN_HEIGHT
              });
              localStorage.removeItem(SLIM_PREVIOUS_SIZE_KEY);
            } else {
              // No previous size, restore to default
              await desktopAPI.windowControls.setSize({
                width: DEFAULT_WIDTH,
                height: DEFAULT_HEIGHT,
                minWidth: NORMAL_MIN_WIDTH,
                minHeight: NORMAL_MIN_HEIGHT
              });
            }
          }
        } catch (e) {
          console.error('Failed to resize window:', e);
        }
      }
    };

    window.addEventListener('electron-toggle-slim-mode', handleTitleBarToggle);

    return () => {
      window.removeEventListener('electron-toggle-slim-mode', handleTitleBarToggle);
    };
  }, []);

  // Listen for changes from other tabs/windows
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === SLIM_MODE_KEY) {
        setIsSlimMode(e.newValue === 'true');
      }
    };

    const handleCustomEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ isSlimMode: boolean }>;
      setIsSlimMode(customEvent.detail.isSlimMode);
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener(SLIM_MODE_EVENT, handleCustomEvent);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener(SLIM_MODE_EVENT, handleCustomEvent);
    };
  }, []);

  return {
    isSlimMode,
    isInitialized,
  };
}

/**
 * Simplified hook - just returns slim mode state.
 * Window size is now handled within useSlimMode itself.
 */
export function useSlimModeWindowSize() {
  const { isSlimMode } = useSlimMode();
  return { isSlimMode };
}
