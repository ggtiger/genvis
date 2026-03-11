import './globals.css'
import 'highlight.js/styles/github-dark.css'
import GlobalSettingsProvider from '@/contexts/GlobalSettingsContext'
import { AuthProvider } from '@/contexts/AuthContext'
import { ToastProvider } from '@/contexts/ToastContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import Header from '@/components/layout/Header'
import SpringCouplet from '@/components/layout/SpringCouplet'
import SpringFireworks from '@/components/layout/SpringFireworks'
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Genvis',
  description: 'Genvis Application',
  icons: {
    icon: '/Genvis_Icon.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head />
      <body className="min-h-screen transition-colors duration-300 bg-[#f3f4f6] dark:bg-[#0f172a] text-text-main dark:text-slate-100" suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: `if(window.desktopAPI){document.body.classList.add('electron-app')}` }} />
        <AuthProvider>
          <GlobalSettingsProvider>
            <ThemeProvider>
              <ToastProvider>
                <Header />
                <SpringCouplet />
                <SpringFireworks />
                <main>{children}</main>
              </ToastProvider>
            </ThemeProvider>
          </GlobalSettingsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
