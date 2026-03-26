'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Download, Check, AlertCircle, RefreshCw, ExternalLink, Terminal } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import type { MarketSkill } from '@/lib/services/skill-market';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

interface SkillMarketPanelProps {
  installedSkillNames: string[];
  onSkillInstalled?: () => void;
}

export default function SkillMarketPanel({ installedSkillNames, onSkillInstalled }: SkillMarketPanelProps) {
  const toast = useToast();
  const [skills, setSkills] = useState<MarketSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState<string>('');
  const [cliAvailable, setCliAvailable] = useState<boolean | null>(null); // null = checking
  const [cliInstalling, setCliInstalling] = useState(false);

  const loadSkills = useCallback(async (resetPage = false) => {
    const currentPage = resetPage ? 1 : page;
    if (resetPage) {
      setPage(1);
    }

    setLoading(true);
    try {
      const params = new URLSearchParams({
        q: searchQuery,
        page: String(currentPage),
        limit: '20'
      });

      const response = await fetch(`${API_BASE}/api/skills/market?${params}`);
      const data = await response.json();

      if (data.success) {
        const newSkills = data.data.skills.map((s: MarketSkill) => ({
          ...s,
          installed: installedSkillNames.includes(s.name)
        }));

        if (resetPage || currentPage === 1) {
          setSkills(newSkills);
        } else {
          setSkills(prev => [...prev, ...newSkills]);
        }

        setTotal(data.data.total);
        setHasMore(data.data.hasMore);
        setCliAvailable(data.data.cliAvailable);
      } else {
        toast.error(data.error || 'Failed to load skills');
      }
    } catch (error) {
      console.error('Failed to load market skills:', error);
      toast.error('Failed to load skills from marketplace');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, page, installedSkillNames, toast]);

  useEffect(() => {
    loadSkills(true);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadSkills(true);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleLoadMore = () => {
    if (!loading && hasMore) {
      setPage(prev => prev + 1);
      loadSkills(false);
    }
  };

  const handleInstallCLI = async () => {
    setCliInstalling(true);
    setInstallProgress('Installing SkillHub CLI...');
    try {
      const response = await fetch(`${API_BASE}/api/skills/market/install-cli`, {
        method: 'POST'
      });

      const data = await response.json();

      if (data.success) {
        toast.success('SkillHub CLI installed successfully');
        setCliAvailable(true);
        setInstallProgress('');
        // Reload skills after CLI is installed
        loadSkills(true);
      } else {
        toast.error(data.error || 'CLI installation failed');
        setInstallProgress('');
      }
    } catch (error) {
      console.error('CLI install failed:', error);
      toast.error('CLI installation failed');
      setInstallProgress('');
    } finally {
      setCliInstalling(false);
    }
  };

  const handleInstall = async (skillName: string) => {
    setInstalling(skillName);
    setInstallProgress('Checking prerequisites...');
    try {
      const response = await fetch(`${API_BASE}/api/skills/market/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillName, autoInstallCLI: true })
      });

      const data = await response.json();

      if (data.success) {
        toast.success(`Skill "${skillName}" installed successfully`);
        setSkills(prev => prev.map(s =>
          s.name === skillName ? { ...s, installed: true } : s
        ));
        setCliAvailable(true); // CLI must be available now
        onSkillInstalled?.();
      } else if (data.cliInstallFailed) {
        // CLI installation failed, show manual install option
        toast.error('CLI installation failed. Please install manually.');
        setCliAvailable(false);
      } else {
        toast.error(data.error || 'Installation failed');
      }
    } catch (error) {
      console.error('Install failed:', error);
      toast.error('Installation failed');
    } finally {
      setInstalling(null);
      setInstallProgress('');
    }
  };

  return (
    <div className="space-y-4">
      {/* CLI Status Warning */}
      {cliAvailable === false && (
        <div className="p-3 bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200 dark:border-yellow-500/20 rounded-lg">
          <div className="flex items-start gap-2">
            <Terminal className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-yellow-800 dark:text-yellow-200 font-medium">
                SkillHub CLI not installed
              </p>
              <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
                Click the button below to auto-install, or run manually:
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={handleInstallCLI}
                  disabled={cliInstalling}
                  className="px-3 py-1.5 bg-yellow-600 hover:bg-yellow-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {cliInstalling ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Installing...
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      Auto Install CLI
                    </>
                  )}
                </button>
                <a
                  href="https://skillhub.tencent.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-yellow-700 dark:text-yellow-300 hover:underline"
                >
                  Learn more
                </a>
              </div>
              {installProgress && cliInstalling && (
                <p className="mt-2 text-xs text-yellow-700 dark:text-yellow-300">
                  {installProgress}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CLI Checking */}
      {cliAvailable === null && (
        <div className="p-3 bg-gray-50 dark:bg-gray-500/10 border border-gray-200 dark:border-gray-500/20 rounded-lg">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-gray-500 animate-spin" />
            <span className="text-sm text-gray-600 dark:text-gray-300">Checking SkillHub CLI...</span>
          </div>
        </div>
      )}

      {/* Search Bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search skills..."
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={() => loadSkills(true)}
          disabled={loading}
          className="p-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 text-gray-600 dark:text-gray-300 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <a
          href="https://skillhub.tencent.com"
          target="_blank"
          rel="noopener noreferrer"
          className="p-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          title="Open SkillHub"
        >
          <ExternalLink className="w-4 h-4 text-gray-600 dark:text-gray-300" />
        </a>
      </div>

      {/* Stats */}
      <div className="text-sm text-gray-500 dark:text-gray-400">
        {total > 0 && `${total} skills available`}
      </div>

      {/* Skills List */}
      {loading && skills.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-gray-500 dark:text-gray-400">Loading skills...</div>
        </div>
      ) : skills.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 bg-white/50 dark:bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Search className="w-8 h-8 text-gray-400 dark:text-gray-500" />
          </div>
          <p className="text-gray-500 dark:text-gray-400">
            {searchQuery ? 'No skills found' : 'No skills available'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {skills.map((skill) => (
            <div
              key={skill.name}
              className="p-4 bg-white/50 dark:bg-white/5 rounded-xl border border-gray-100 dark:border-gray-700 hover:border-gray-200 dark:hover:border-gray-600 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-medium text-gray-900 dark:text-white truncate">
                      {skill.displayName || skill.name}
                    </h4>
                    {skill.installed && (
                      <span className="text-xs px-2 py-0.5 rounded bg-green-50 dark:bg-green-500/20 text-green-600 dark:text-green-400">
                        Installed
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">
                    {skill.description || 'No description available'}
                  </p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-400 dark:text-gray-500">
                    {skill.author && (
                      <span>Author: {skill.author}</span>
                    )}
                    {skill.version && (
                      <span>v{skill.version}</span>
                    )}
                    {skill.downloads !== undefined && (
                      <span>{skill.downloads.toLocaleString()} downloads</span>
                    )}
                  </div>
                </div>
                <div className="flex-shrink-0">
                  {skill.installed ? (
                    <div className="flex items-center gap-1 text-green-600 dark:text-green-400 text-sm">
                      <Check className="w-4 h-4" />
                      <span>Installed</span>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleInstall(skill.name)}
                      disabled={installing !== null || !cliAvailable}
                      className="flex items-center gap-1 px-3 py-1.5 bg-gray-900 dark:bg-white/10 hover:bg-gray-800 dark:hover:bg-white/15 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {installing === skill.name ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Installing...</span>
                        </>
                      ) : (
                        <>
                          <Download className="w-4 h-4" />
                          <span>Install</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Load More Button */}
      {hasMore && (
        <div className="flex justify-center pt-4">
          <button
            onClick={handleLoadMore}
            disabled={loading}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Load More'}
          </button>
        </div>
      )}
    </div>
  );
}
