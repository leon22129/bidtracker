'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { isAdmin } from '@/lib/permissions';
import type { BannedUrlPattern } from '@/lib/types';
import { useToast } from '@/components/ui/toast';

export default function BannedUrlsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [patterns, setPatterns] = useState<BannedUrlPattern[]>([]);
  const [pattern, setPattern] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPatterns(await api.listBannedPatterns());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load banned URL patterns');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  if (!isAdmin(user)) {
    return <main className="mx-auto max-w-lg px-4 py-16 text-center text-sm text-gray-600">Banned URL settings are restricted to administrators.</main>;
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!pattern.trim()) return;
    setSaving(true);
    try {
      await api.createBannedPattern(pattern);
      setPattern('');
      toast.success('Banned URL pattern added');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add pattern');
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: BannedUrlPattern) {
    if (!window.confirm(`Remove "${row.pattern}" from the banned list?`)) return;
    try {
      await api.deleteBannedPattern(row.id);
      toast.success('Banned URL pattern removed');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not remove pattern');
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-5">
        <h1 className="text-lg font-semibold">Banned URL Patterns</h1>
        <p className="mt-1 text-xs text-gray-500">A job URL containing any pattern below is automatically rejected before resume generation.</p>
      </div>

      <form className="card mb-5 flex gap-2 p-4" onSubmit={add}>
        <input
          className="input flex-1"
          value={pattern}
          onChange={(event) => setPattern(event.target.value)}
          placeholder="example.com or blocked-company"
          maxLength={300}
        />
        <button className="btn-primary" type="submit" disabled={saving || pattern.trim().length < 2}>
          {saving ? 'Adding...' : 'Add pattern'}
        </button>
      </form>

      <div className="card overflow-hidden">
        {loading ? <p className="p-4 text-sm text-gray-500">Loading...</p> : (
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-left text-2xs uppercase tracking-wide text-gray-500">
              <tr><th className="px-3 py-2 font-medium">Pattern</th><th className="px-3 py-2 font-medium">Added by</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody>
              {patterns.map((row) => (
                <tr key={row.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-mono">{row.pattern}</td>
                  <td className="px-3 py-2 text-gray-500">{row.createdByUser?.username ?? 'system default'}</td>
                  <td className="px-3 py-2 text-right"><button className="btn-danger btn-xs" type="button" onClick={() => void remove(row)}>Remove</button></td>
                </tr>
              ))}
              {!patterns.length && <tr><td className="px-3 py-6 text-center text-gray-500" colSpan={3}>No banned URL patterns.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
