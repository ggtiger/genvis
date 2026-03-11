import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '个人效率助手',
  description: '集日程提醒、笔记记录、待办管理于一体的个人效率工具',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="bg-gray-50 text-gray-900 antialiased">
        <div className="min-h-screen">
          <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex items-center justify-between h-14">
                <div className="flex items-center gap-2">
                  <span className="text-xl">📋</span>
                  <h1 className="text-lg font-semibold">个人效率助手</h1>
                </div>
                <nav className="flex items-center gap-6">
                  <a href="/" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">
                    仪表板
                  </a>
                  <a href="/schedules" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">
                    日程
                  </a>
                  <a href="/notes" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">
                    笔记
                  </a>
                  <a href="/todos" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">
                    待办
                  </a>
                  <a href="/scheduled-tasks" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">
                    ⏰ 定时任务
                  </a>
                </nav>
              </div>
            </div>
          </header>
          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
