'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { canViewAnalytics } from '@/lib/permissions';
import type { AnalyticsOverview, Workspace } from '@/lib/types';
import { PipelinePill } from '@/components/ui/status-pill';
import { useToast } from '@/components/ui/toast';

/**
 * Recruiting analytics — admin only.
 *
 * Charts are hand-drawn with divs rather than pulled from a charting library. Everything here is a
 * horizontal bar or a big number; a 100 KB+ chart dependency would earn its place only once we need
 * axes, tooltips, and zoom.
 *
 * "Interview count" means pipeline_status ∈ {Recruiter, Technical, Final} ∪ {Offer Received, Accepted} —
 * a candidate who reached an offer necessarily interviewed, so counting only the interview stages would
 * undercount the funnel. That definition lives in the backend and is restated here for the reader.
 */
export default function AnalyticsPage() {
  const { user } = useAuth();
  const toast = useToast();

  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [overview, ws] = await Promise.all([
        api.analyticsOverview({
          from: from || undefined,
          to: to || undefined,
          workspace_id: workspaceId || undefined,
        }),
        api.listWorkspaces(true),
      ]);
      setData(overview);
      setWorkspaces(ws);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load analytics');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canViewAnalytics(user)) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-sm text-gray-600">Analytics are restricted to administrators.</p>
      </main>
    );
  }

  const c = data?.conversion;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Analytics</h1>
          <p className="mt-0.5 text-xs text-gray-500">
            Interview performance and conversion across every workspace.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label" htmlFor="a-ws">Workspace</label>
            <select id="a-ws" className="input w-48 py-1 text-xs" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
              <option value="">All workspaces</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="a-from">From</label>
            <input id="a-from" type="date" className="input w-36 py-1 text-xs" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="a-to">To</label>
            <input id="a-to" type="date" className="input w-36 py-1 text-xs" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          {(from || to || workspaceId) && (
            <button
              type="button"
              className="btn-secondary btn-xs mb-0.5"
              onClick={() => {
                setFrom('');
                setTo('');
                setWorkspaceId('');
              }}
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {loading && !data ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : !data || !c ? (
        <p className="text-sm text-gray-500">No data.</p>
      ) : (
        <>
          {/* ---- conversion funnel ---- */}
          <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Tile label="Total applications" value={c.total_applications} />
            <Tile label="Applied" value={c.applied_count} tone="green" />
            <Tile label="Interviews" value={c.interview_count} tone="indigo" />
            <Tile label="Offers" value={c.offer_count} tone="amber" />
            <Tile
              label="Interview rate"
              value={c.interview_rate}
              percent
              hint="Interview count ÷ Applied count"
            />
            <Tile label="Offer rate" value={c.offer_rate} percent hint="Offers ÷ Applied count" />
          </section>

          <section className="mb-6 grid gap-3 lg:grid-cols-2">
            <div className="card p-4">
              <h2 className="text-sm font-semibold">Application status mix</h2>
              <div className="mt-3 space-y-2">
                <Bar label="Pending" value={c.pending_count} max={c.total_applications} colour="bg-gray-400" />
                <Bar label="Applied" value={c.applied_count} max={c.total_applications} colour="bg-green-500" />
                <Bar label="Rejected" value={c.rejected_count} max={c.total_applications} colour="bg-gray-900" />
                <Bar label="Banned" value={c.banned_count} max={c.total_applications} colour="bg-orange-500" />
                <Bar label="Duplicated" value={c.duplicated_count} max={c.total_applications} colour="bg-red-500" />
              </div>
              {c.duplicate_rate !== null && (
                <p className="mt-3 text-2xs text-gray-500">
                  Duplicate rate {(c.duplicate_rate * 100).toFixed(1)}% — duplicates are excluded from
                  weekly payment, so a rising number here is worth a conversation with the bidder.
                </p>
              )}
            </div>

            <div className="card p-4">
              <h2 className="text-sm font-semibold">Pipeline breakdown</h2>
              <div className="mt-3 space-y-1.5">
                {data.pipeline_breakdown.length === 0 ? (
                  <p className="text-xs text-gray-500">Nothing has entered the pipeline yet.</p>
                ) : (
                  data.pipeline_breakdown.map((p) => (
                    <div key={p.pipeline_status} className="flex items-center justify-between gap-2">
                      <PipelinePill status={p.pipeline_status} />
                      <span className="text-xs tabular-nums text-gray-700">{p.count.toLocaleString()}</span>
                    </div>
                  ))
                )}
              </div>
              {c.offer_per_interview_rate !== null && (
                <p className="mt-3 border-t border-gray-100 pt-3 text-2xs text-gray-500">
                  {(c.offer_per_interview_rate * 100).toFixed(1)}% of interviews reach an offer.
                </p>
              )}
            </div>
          </section>

          {/* ---- interviews by workspace ---- */}
          <section className="mb-6 grid gap-3 lg:grid-cols-2">
            <div className="card p-4">
              <h2 className="text-sm font-semibold">Interviews by workspace</h2>
              <p className="mt-0.5 text-2xs text-gray-500">Which bidder&apos;s applications convert.</p>
              <div className="mt-3 space-y-2">
                {data.interviews_by_workspace.length === 0 ? (
                  <p className="text-xs text-gray-500">No interviews recorded.</p>
                ) : (
                  data.interviews_by_workspace.map((w) => (
                    <Bar
                      key={w.workspace_id}
                      label={`${w.workspace_name} · ${w.owner_username}`}
                      value={w.interviews}
                      max={Math.max(...data.interviews_by_workspace.map((x) => x.interviews))}
                      colour="bg-indigo-500"
                      href={`/workspaces/${w.workspace_id}`}
                    />
                  ))
                )}
              </div>
            </div>

            <div className="card p-4">
              <h2 className="text-sm font-semibold">Interviews by job source</h2>
              <p className="mt-0.5 text-2xs text-gray-500">
                Where the effort actually pays off — rate matters more than volume.
              </p>
              <div className="mt-3 overflow-hidden rounded border border-gray-200">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-left text-2xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">Source</th>
                      <th className="w-20 px-2 py-1.5 text-right font-medium">Applied</th>
                      <th className="w-24 px-2 py-1.5 text-right font-medium">Interviews</th>
                      <th className="w-16 px-2 py-1.5 text-right font-medium">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.interviews_by_source.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-2 py-3 text-center text-gray-500">No data.</td>
                      </tr>
                    ) : (
                      data.interviews_by_source.map((s) => (
                        <tr key={s.job_source} className="border-t border-gray-100">
                          <td className="px-2 py-1.5">{s.job_source}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">
                            {s.applied.toLocaleString()}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                            {s.interviews.toLocaleString()}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {s.interview_rate === null ? (
                              <span className="text-gray-300">—</span>
                            ) : (
                              `${(s.interview_rate * 100).toFixed(1)}%`
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

        </>
      )}
    </main>
  );
}

function Tile({
  label,
  value,
  percent,
  tone,
  hint,
}: {
  label: string;
  value: number | null;
  percent?: boolean;
  tone?: 'green' | 'indigo' | 'amber';
  hint?: string;
}) {
  const toneClass =
    tone === 'green' ? 'text-green-700' : tone === 'indigo' ? 'text-indigo-700' : tone === 'amber' ? 'text-amber-700' : '';
  return (
    <div className="card px-3 py-2.5" title={hint}>
      <p className={`text-2xl font-semibold tabular-nums ${toneClass}`}>
        {value === null ? (
          // A rate with a zero denominator is genuinely undefined; showing "0%" would read as failure.
          <span className="text-gray-300">—</span>
        ) : percent ? (
          `${(value * 100).toFixed(1)}%`
        ) : (
          value.toLocaleString()
        )}
      </p>
      <p className="text-2xs text-gray-500">{label}</p>
    </div>
  );
}

function Bar({
  label,
  value,
  max,
  colour,
  href,
}: {
  label: string;
  value: number;
  max: number;
  colour: string;
  href?: string;
}) {
  const pct = max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-2xs">
        {href ? (
          <Link href={href} className="truncate text-gray-700 hover:underline">{label}</Link>
        ) : (
          <span className="truncate text-gray-700">{label}</span>
        )}
        <span className="shrink-0 tabular-nums text-gray-600">{value.toLocaleString()}</span>
      </div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
        <div className={`h-full rounded-full ${colour}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
