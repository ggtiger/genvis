"use client";

import { useState, useEffect } from 'react';
import { useGlobalSettings } from '@/contexts/GlobalSettingsContext';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

interface BasicTabProps {
  // Props can be added here if needed
}

export default function BasicTab(_props: BasicTabProps) {
  const { settings: globalSettings, setSettings: setGlobalSettings, refresh: refreshGlobalSettings } = useGlobalSettings();
  const [allowRemoteAccess, setAllowRemoteAccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Load server settings on mount
  useEffect(() => {
    if (globalSettings?.server?.allow_remote_access !== undefined) {
      setAllowRemoteAccess(globalSettings.server.allow_remote_access);
    }
  }, [globalSettings]);

  const saveGlobalSettings = async () => {
    setIsLoading(true);
    setSaveMessage(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings/global`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server: { allow_remote_access: allowRemoteAccess }
        })
      });
      if (response.ok) {
        setSaveMessage({ type: 'success', text: 'Settings saved successfully' });
        await refreshGlobalSettings();
      } else {
        setSaveMessage({ type: 'error', text: 'Failed to save settings' });
      }
    } catch (error) {
      setSaveMessage({ type: 'error', text: 'Network error, please try again' });
    } finally {
      setIsLoading(false);
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-6">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Basic Settings</span>
        <div className="flex items-center gap-2">
          {saveMessage && (
            <span className={`text-xs ${saveMessage.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
              {saveMessage.text}
            </span>
          )}
          <button
            onClick={saveGlobalSettings}
            disabled={isLoading}
            className="px-3 py-1 text-xs font-medium bg-slate-800 dark:bg-white/20 hover:bg-slate-700 dark:hover:bg-white/30 text-white dark:text-slate-100 rounded transition-colors disabled:opacity-50"
          >
            {isLoading ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <div className="divide-y divide-gray-200/40 dark:divide-white/10">
        {/* Remote Access Setting */}
        <div className="py-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-gray-900 dark:text-white">Allow Remote Access</p>
              <span className="px-2 py-0.5 text-xs bg-yellow-100 text-yellow-800 rounded">Restart Required</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={allowRemoteAccess}
                onChange={(e) => {
                  const newValue = e.target.checked;
                  setAllowRemoteAccess(newValue);
                  setGlobalSettings({
                    ...globalSettings,
                    server: { allow_remote_access: newValue }
                  });
                }}
              />
              <div className="w-11 h-6 bg-white/40 dark:bg-white/10 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
            </label>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-300 mb-2">
            Enable listening on 0.0.0.0 to allow LAN devices to access the server
          </p>
          <div className="p-2.5 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-start gap-1.5 text-xs text-yellow-800">
              <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span>Security Warning: Only enable this in trusted networks</span>
            </div>
          </div>
        </div>

        {/* Future settings can be added here as new items in the divide-y list */}
      </div>
    </div>
  );
}
