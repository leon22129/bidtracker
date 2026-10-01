'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { canViewAnalytics, isAdmin, roleLabel } from '@/lib/permissions';

/**
 * Route group for everything behind authentication.
 *
 * The redirect here is a UX convenience only — every API call is independently authorised server-side,
 * so a user who forces their way to /admin/users sees an empty page and 403s, not data.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [user, loading, router, pathname]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    );
  }
  if (!user) return null;

  const nav = [
    { href: '/workspaces', label: 'Dashboard', show: true },
    { href: '/admin/payments', label: 'Bid Count Report', show: true },
    { href: '/admin/analytics', label: 'Analytics', show: canViewAnalytics(user) },
    { href: '/admin/users', label: 'Users', show: isAdmin(user) },
    { href: '/admin/banned-urls', label: 'Banned URLs', show: isAdmin(user) },
  ].filter((n) => n.show);

  return (
    <div className="flex h-full flex-col">
      <header className="z-20 flex h-12 shrink-0 items-center gap-6 border-b border-gray-800 bg-gray-900 px-4 text-white">
        <Link href="/workspaces" className="text-sm font-semibold tracking-tight text-white">
          BidTracker
        </Link>

        <nav className="flex items-center gap-1">
          {nav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  active ? 'bg-white text-gray-900' : 'text-gray-300 hover:text-white'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <div className="text-right leading-tight">
            <div className="text-xs font-medium">{user.username}</div>
            <div className="text-2xs text-gray-400">{roleLabel(user.role)}</div>
          </div>
          <Link href="/account" className="btn-secondary btn-xs">
            Account
          </Link>
          <button type="button" onClick={logout} className="btn-secondary btn-xs">
            Sign out
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
