export async function register() {
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.NEXT_PHASE !== 'phase-production-build'
  ) {
    const state = globalThis as typeof globalThis & {
      adassetTimer?: ReturnType<typeof setInterval>;
    };
    if (!state.adassetTimer) {
      const { scheduler } = await import('./lib/service');
      const run = () => scheduler().catch((e) => console.error('[scheduler]', e.message));
      state.adassetTimer = setInterval(run, 60000);
      state.adassetTimer.unref();
    }
  }
}
