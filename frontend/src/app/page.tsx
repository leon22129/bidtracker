'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

/** Entry point: send authenticated users to the app, everyone else to login. */
export default function RootPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? '/workspaces' : '/login');
  }, [user, loading, router]);

  return (
    <main className="flex h-full items-center justify-center">
      <p className="text-sm text-gray-500">Loading…</p>
    </main>
  );
}
