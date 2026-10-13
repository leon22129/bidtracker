'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { isAdmin } from '@/lib/permissions';
import { useAuth } from '@/lib/auth-context';
import type { PaymentReport, PaymentReportResult } from '@/lib/types';
import { useToast } from '@/components/ui/toast';

function previousWeek() {
  const today = new Date();
  const day = today.getUTCDay();
  const thisMonday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (day === 0 ? 6 : day - 1)));
  const start = new Date(thisMonday);
  start.setUTCDate(start.getUTCDate() - 7);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export default function PaymentsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const defaults = previousWeek();
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [data, setData] = useState<PaymentReportResult | null>(null);
  const [history, setHistory] = useState<PaymentReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      if (isAdmin(user)) {
        const [report, reports] = await Promise.all([api.paymentReport(startDate, endDate), api.paymentHistory()]);
        setData(report);
        setHistory(reports);
      } else {
        setData(await api.paymentReport(startDate, endDate));
        setHistory([]);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load bid count report');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function processPayment(bidderId: string, bidderName: string, count: number) {
    if (!window.confirm(`Process ${count} unpaid Applied application(s) for ${bidderName}?`)) return;
    setProcessing(bidderId);
    try {
      await api.processPayment({ bidder_id: bidderId, start_date: startDate, end_date: endDate });
      toast.success(`Processed ${count} application(s) for ${bidderName}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not process payment');
    } finally {
      setProcessing(null);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-5">
        <h1 className="text-lg font-semibold">{isAdmin(user) ? 'Bid Count Report' : 'My Bid Count Report'}</h1>
        <p className="mt-0.5 text-xs text-gray-500">Applied, unpaid applications credited to the bidder who created them.</p>
      </div>

      <section className="card mb-6 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="label">Start Date<input type="date" className="input mt-1 w-40" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
          <label className="label">End Date<input type="date" className="input mt-1 w-40" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
          <button type="button" className="btn-primary" onClick={() => void load()} disabled={loading || !startDate || !endDate}>Run Report</button>
          {data && <span className="ml-auto text-sm text-gray-600">Total unpaid Applied: <strong>{data.total_applied.toLocaleString()}</strong></span>}
        </div>
      </section>

      {loading ? <p className="text-sm text-gray-500">Loading...</p> : (
        <>
          <section className="space-y-4">
            {data?.managers.map((manager) => (
              <div key={manager.manager_id ?? 'unassigned'} className="card overflow-hidden">
                <div className="flex items-center justify-between bg-gray-50 px-4 py-3 text-sm font-semibold">
                  <span>{manager.manager_username} (manager)</span>
                  <span className="tabular-nums">total {manager.applied_count.toLocaleString()}</span>
                </div>
                <div className="divide-y divide-gray-100">
                  {manager.profiles.map((profile) => (
                    <div
                      key={`${profile.workspace_id}:${profile.bidder_id}`}
                      className="flex items-center justify-between px-4 py-2.5 text-xs"
                    >
                      <span>{profile.profile_name} ({profile.bidder_username})</span>
                      <span className="font-semibold tabular-nums">{profile.applied_count.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {data?.managers.length === 0 && (
              <div className="card p-6 text-center text-xs text-gray-500">
                No unpaid Applied applications in this period.
              </div>
            )}
          </section>

          {isAdmin(user) && Boolean(data?.bidders.length) && (
            <section className="mt-6">
              <h2 className="mb-2 text-sm font-semibold">Payment processing</h2>
              <div className="card overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-left text-2xs uppercase tracking-wide text-gray-500">
                    <tr><th className="px-3 py-2">Bidder</th><th className="px-3 py-2 text-right">Applied</th><th className="px-3 py-2 text-right">Action</th></tr>
                  </thead>
                  <tbody>
                    {data?.bidders.map((bidder) => (
                      <tr key={bidder.bidder_id} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-medium">{bidder.bidder_username}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{bidder.applied_count.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            className="btn-primary btn-xs"
                            disabled={processing !== null}
                            onClick={() => void processPayment(bidder.bidder_id, bidder.bidder_username, bidder.applied_count)}
                          >
                            {processing === bidder.bidder_id ? 'Processing...' : 'Process Payment'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      {isAdmin(user) && <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold">Payment Report History</h2>
        <div className="card overflow-hidden"><table className="w-full text-xs"><thead className="bg-gray-50 text-left text-2xs uppercase tracking-wide text-gray-500"><tr><th className="px-3 py-2">Bidder</th><th className="px-3 py-2">Period</th><th className="px-3 py-2 text-right">Applied Count</th><th className="px-3 py-2 text-right">Processed Date</th></tr></thead><tbody>{history.map((report) => <tr key={report.id} className="border-t border-gray-100"><td className="px-3 py-2 font-medium">{report.bidder_username}</td><td className="px-3 py-2">{report.start_date.slice(0, 10)} - {report.end_date.slice(0, 10)}</td><td className="px-3 py-2 text-right tabular-nums">{report.applied_count.toLocaleString()}</td><td className="px-3 py-2 text-right">{report.processed_at.slice(0, 10)}</td></tr>)}</tbody></table>{history.length === 0 && <p className="p-6 text-center text-xs text-gray-500">No payment reports processed yet.</p>}</div>
      </section>}
    </main>
  );
}
