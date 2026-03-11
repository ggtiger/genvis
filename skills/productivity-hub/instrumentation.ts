/**
 * Next.js Instrumentation Hook
 *
 * 在服务端启动时自动启动内部定时任务调度器。
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  // 仅在 Node.js runtime 中启动（不在 edge runtime）
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startScheduler } = await import('./lib/scheduler');
    startScheduler();
    console.log('[Instrumentation] 定时任务调度器已启动');
  }
}
