'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { allowedStatusTransitions } from '@/lib/permissions';
import type { ApplicationStatus, Workspace } from '@/lib/types';
import { useToast } from '@/components/ui/toast';

export default function AddApplicationPage() {
  const params = useParams<{ id: string }>();
  const workspaceId = params.id;
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [jobTitle, setJobTitle] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<ApplicationStatus>('Pending');
  const [submitting, setSubmitting] = useState(false);
  const statuses = useMemo(() => allowedStatusTransitions(user, 'Pending'), [user]);

  useEffect(() => {
    api.getWorkspace(workspaceId)
      .then(setWorkspace)
      .catch((error) => toast.error(error instanceof Error ? error.message : 'Could not load workspace'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const title = jobTitle.trim();
    const company = companyName.trim();
    const jobUrl = url.trim();
    if (!title || !company || !jobUrl) {
      toast.error('Job title, company name, job URL, and status are required.');
      return;
    }

    setSubmitting(true);
    try {
      const application = await api.createApplication({
        workspace_id: workspaceId,
        job_title: title,
        company_name: company,
        url: jobUrl,
        application_status: status,
      });
      toast.success(`Added ${application.job_title} at ${application.company_name}`);
      router.push(`/workspaces/${workspaceId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add application');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-6">
      <Link href={`/workspaces/${workspaceId}`} className="text-xs text-gray-500 hover:underline">
        ← {workspace?.name ?? 'Workspace'}
      </Link>
      <h1 className="mt-1 text-lg font-semibold">Add application</h1>
      <p className="mt-0.5 text-xs text-gray-500">All fields are required.</p>

      <form onSubmit={submit} className="card mt-5 space-y-4 p-4">
        <Field label="Job title" htmlFor="job-title">
          <input
            id="job-title"
            className="input"
            value={jobTitle}
            onChange={(event) => setJobTitle(event.target.value)}
            maxLength={300}
            required
          />
        </Field>

        <Field label="Company name" htmlFor="company-name">
          <input
            id="company-name"
            className="input"
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            maxLength={200}
            required
          />
        </Field>

        <Field label="Job URL" htmlFor="job-url">
          <input
            id="job-url"
            type="url"
            className="input"
            placeholder="https://company.com/jobs/123"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            required
          />
        </Field>

        <Field label="Status" htmlFor="application-status">
          <select
            id="application-status"
            className="input"
            value={status}
            onChange={(event) => setStatus(event.target.value as ApplicationStatus)}
            required
          >
            {statuses.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </Field>

        <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
          <Link href={`/workspaces/${workspaceId}`} className="btn-secondary">Cancel</Link>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Adding…' : 'Add application'}
          </button>
        </div>
      </form>
    </main>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}
