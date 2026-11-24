/** Only allow local destinations supplied through the sign-in page's `next` parameter. */
export function loginRedirectTarget(value: string | null): string {
  const fallback = '/workspaces';
  if (!value?.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value)) return fallback;
  try {
    const base = 'https://bidtracker.invalid';
    const target = new URL(value, base);
    if (target.origin !== base || target.pathname.startsWith('//') || target.pathname === '/login' || target.pathname.startsWith('/login/')) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}
