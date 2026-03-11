'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface EmbeddedPage {
  url: string;
  title?: string;
}

interface EmbeddedPageContextValue {
  /** Open a URL in the embedded page view (replaces main content area) */
  openPage: (url: string, title?: string) => void;
  /** Close the embedded page and return to previous view */
  closePage: () => void;
  /** Currently open embedded page, or null */
  currentPage: EmbeddedPage | null;
}

const EmbeddedPageContext = createContext<EmbeddedPageContextValue | null>(null);

export function EmbeddedPageProvider({ children }: { children: ReactNode }) {
  const [currentPage, setCurrentPage] = useState<EmbeddedPage | null>(null);

  const openPage = useCallback((url: string, title?: string) => {
    setCurrentPage({ url, title });
  }, []);

  const closePage = useCallback(() => {
    setCurrentPage(null);
  }, []);

  return (
    <EmbeddedPageContext.Provider value={{ openPage, closePage, currentPage }}>
      {children}
    </EmbeddedPageContext.Provider>
  );
}

/**
 * Hook to open URLs in the workspace's embedded page view.
 * Falls back to window.open if used outside the provider.
 */
export function useEmbeddedPage() {
  const ctx = useContext(EmbeddedPageContext);
  if (!ctx) {
    // Fallback: outside provider, just use window.open
    return {
      openPage: (url: string, _title?: string) => window.open(url, '_blank'),
      closePage: () => {},
      currentPage: null,
    };
  }
  return ctx;
}
