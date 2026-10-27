const loopbackHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

export function localPasswordlessAllowed(headers: Pick<Headers, 'get'>): boolean {
  if (
    process.env.LOCAL_PASSWORDLESS_LOGIN !== 'true' ||
    process.env.AUTH_PROVIDER !== 'local' ||
    process.env.DEMO_SEED !== 'true' ||
    process.env.DATABASE_URL ||
    !loopbackHost.test(headers.get('host') || '')
  ) return false;

  try {
    const origin = new URL(process.env.APP_ORIGIN || '');
    return ['http:', 'https:'].includes(origin.protocol) && loopbackHost.test(origin.host);
  } catch {
    return false;
  }
}
