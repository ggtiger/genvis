"use client";

import { useState } from 'react';
import { useGlobalSettings } from '@/contexts/GlobalSettingsContext';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

interface ASRTabProps {
  // Props can be added here if needed
}

export default function ASRTab(_props: ASRTabProps) {
  const { settings: globalSettings, refresh: refreshGlobalSettings } = useGlobalSettings();
  const asrSettings = globalSettings?.ai_services?.asr;

  const [asrEnabled, setAsrEnabled] = useState(asrSettings?.enabled ?? false);
  const [asrBaseUrl, setAsrBaseUrl] = useState(asrSettings?.wanjie?.base_url ?? '');
  const [asrSubmitUrl, setAsrSubmitUrl] = useState(asrSettings?.wanjie?.submit_url ?? '');
  const [asrQueryUrlTemplate, setAsrQueryUrlTemplate] = useState(asrSettings?.wanjie?.query_url_template ?? '');
  const [asrSaving, setAsrSaving] = useState(false);
  const [asrMessage, setAsrMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  return (
    <div className="space-y-6">
      {/* ASR Service Configuration */}
      <div className="border border-gray-200/60 dark:border-white/15 rounded-xl p-6">
        <div className="flex items-start gap-4 mb-4">
          <div className="flex-shrink-0 w-10 h-10 rounded-xl ring-1 ring-inset ring-white/20 dark:ring-white/10 bg-white/90 dark:bg-white/10 flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M12 19v4M8 23h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-medium text-gray-900 dark:text-white text-sm">ASR Speech Recognition (Wanjie)</h4>
              {asrEnabled && (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium text-emerald-700 bg-emerald-100">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Enabled
                </span>
              )}
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              Configure ASR service for speech-to-text in sub-projects and Skills
            </p>
          </div>
        </div>

        {/* Enable Toggle */}
        <div className="flex items-center justify-between p-3 mb-4 bg-white/40 dark:bg-white/8 border border-gray-200/60 dark:border-white/15 rounded-lg">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">Enable ASR Service</p>
            <p className="text-xs font-medium text-gray-600 dark:text-gray-300">Inject ASR config into sub-projects and Skills</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={asrEnabled}
              onChange={(e) => setAsrEnabled(e.target.checked)}
            />
            <div className="w-11 h-6 bg-white/40 dark:bg-white/10 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300/60 dark:border-white/15 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
          </label>
        </div>

        {/* ASR URLs Configuration */}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Base URL</label>
            <input
              type="text"
              value={asrBaseUrl}
              onChange={(e) => setAsrBaseUrl(e.target.value)}
              placeholder="http://your-asr-server:port"
              className="w-full px-3 py-1.5 rounded-lg border border-gray-200/60 dark:border-white/15 bg-white/90 dark:bg-white/10 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-white/20 dark:ring-white/10"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Submit URL</label>
            <input
              type="text"
              value={asrSubmitUrl}
              onChange={(e) => setAsrSubmitUrl(e.target.value)}
              placeholder="http://your-asr-server:port/v1/audio/transcriptions"
              className="w-full px-3 py-1.5 rounded-lg border border-gray-200/60 dark:border-white/15 bg-white/90 dark:bg-white/10 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-white/20 dark:ring-white/10"
            />
            <p className="text-[11px] text-gray-500 dark:text-gray-400">Endpoint for submitting audio files</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Query URL Template</label>
            <input
              type="text"
              value={asrQueryUrlTemplate}
              onChange={(e) => setAsrQueryUrlTemplate(e.target.value)}
              placeholder="http://your-asr-server:port/v1/audio/transcriptions/{task_id}"
              className="w-full px-3 py-1.5 rounded-lg border border-gray-200/60 dark:border-white/15 bg-white/90 dark:bg-white/10 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-white/20 dark:ring-white/10"
            />
            <p className="text-[11px] text-gray-500 dark:text-gray-400">Use {'{task_id}'} as placeholder for task ID</p>
          </div>

          {/* Message */}
          {asrMessage && (
            <p className={`text-[11px] leading-snug ${asrMessage.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
              {asrMessage.text}
            </p>
          )}

          {/* Save Button */}
          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={async () => {
                setAsrSaving(true);
                setAsrMessage(null);
                try {
                  const response = await fetch(`${API_BASE}/api/settings/global`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      ai_services: {
                        asr: {
                          enabled: asrEnabled,
                          provider: 'wanjie',
                          wanjie: {
                            base_url: asrBaseUrl.trim(),
                            submit_url: asrSubmitUrl.trim(),
                            query_url_template: asrQueryUrlTemplate.trim(),
                          }
                        }
                      }
                    })
                  });
                  if (response.ok) {
                    setAsrMessage({ type: 'success', text: 'ASR settings saved successfully' });
                    await refreshGlobalSettings();
                  } else {
                    setAsrMessage({ type: 'error', text: 'Failed to save ASR settings' });
                  }
                } catch (error) {
                  setAsrMessage({ type: 'error', text: 'Network error, please try again' });
                } finally {
                  setAsrSaving(false);
                  setTimeout(() => setAsrMessage(null), 3000);
                }
              }}
              disabled={asrSaving}
              className="px-4 py-1.5 text-sm font-medium bg-slate-800 dark:bg-white/20 hover:bg-slate-700 dark:hover:bg-white/30 text-white dark:text-slate-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {asrSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      {/* Info Box */}
      <div className="p-4 bg-white/40 dark:bg-white/8 rounded-xl border border-gray-200/60 dark:border-white/15">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-gray-500 dark:text-gray-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-gray-900 dark:text-white">
              How it works
            </h3>
            <div className="mt-2 text-sm text-gray-700 dark:text-gray-200">
              <p>
                When enabled, ASR configuration will be automatically injected into:
              </p>
              <ul className="list-disc list-inside mt-1 text-xs text-gray-600 dark:text-gray-300">
                <li>Sub-project preview processes (as environment variables)</li>
                <li>Claude Agent system prompts (with usage examples)</li>
                <li>Skill execution environments</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
