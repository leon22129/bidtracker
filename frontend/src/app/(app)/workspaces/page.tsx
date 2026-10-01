'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { canManageWorkspaces } from '@/lib/permissions';
import type { User, Workspace } from '@/lib/types';
import { useToast } from '@/components/ui/toast';

type WorkspaceFilter = 'active' | 'archived' | 'all';

export default function WorkspacesPage() {
  const { user } = useAuth();
  const toast = useToast();
  const admin = canManageWorkspaces(user);
  const canEditProfiles = user?.role === 'admin' || user?.role === 'super_admin';

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newOwner, setNewOwner] = useState('');
  const [reassigning, setReassigning] = useState<Workspace | null>(null);
  const [editingProfile, setEditingProfile] = useState<Workspace | null>(null);
  const [workspaceFilter, setWorkspaceFilter] = useState<WorkspaceFilter>('active');
  const [selectedBidderId, setSelectedBidderId] = useState('all');

  const workspaceCounts = useMemo(() => ({
    all: workspaces.length,
    active: workspaces.filter((workspace) => !workspace.is_archived).length,
    archived: workspaces.filter((workspace) => workspace.is_archived).length,
  }), [workspaces]);
  const filteredWorkspaces = useMemo(
    () => workspaces.filter((workspace) => (
      workspaceFilter === 'all'
      || (workspaceFilter === 'archived' ? workspace.is_archived : !workspace.is_archived)
    )),
    [workspaceFilter, workspaces],
  );
  const activeWorkspaceActivity = useMemo(
    () => workspaces.filter((workspace) => !workspace.is_archived),
    [workspaces],
  );
  const bidderActivity = useMemo(() => {
    const bidders = new Map<string, {
      id: string;
      username: string;
      total: number;
      profiles: Array<{ id: string; name: string; count: number }>;
    }>();

    for (const workspace of activeWorkspaceActivity) {
      for (const item of workspace.applied_today_by_user) {
        const bidder = bidders.get(item.user_id) ?? {
          id: item.user_id,
          username: item.username,
          total: 0,
          profiles: [],
        };
        bidder.total += item.count;
        bidder.profiles.push({
          id: workspace.id,
          name: workspace.profile?.name || workspace.name,
          count: item.count,
        });
        bidders.set(item.user_id, bidder);
      }
    }

    return [...bidders.values()].sort((a, b) => a.username.localeCompare(b.username));
  }, [activeWorkspaceActivity]);
  const displayedBidderActivity = useMemo(
    () => bidderActivity.filter((bidder) => (
      selectedBidderId === 'all' || bidder.id === selectedBidderId
    )),
    [bidderActivity, selectedBidderId],
  );
  const appliedTodayTotal = useMemo(
    () => displayedBidderActivity.reduce((total, bidder) => total + bidder.total, 0),
    [displayedBidderActivity],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.listWorkspaces(true);
      setWorkspaces(list);
      if (admin) setUsers(await api.listUsers());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load workspaces');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createWorkspace(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newOwner) return;
    setCreating(true);
    try {
      await api.createWorkspace({ name: newName.trim(), owner_user_id: newOwner });
      toast.success(`Created "${newName.trim()}"`);
      setNewName('');
      setNewOwner('');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create workspace');
    } finally {
      setCreating(false);
    }
  }

  async function removeWorkspace(w: Workspace) {
    const confirmed = window.confirm(
      `Delete "${w.name}" and all ${w.application_count.toLocaleString()} of its applications?\n\n` +
        'This cannot be undone.',
    );
    if (!confirmed) return;
    try {
      const res = await api.deleteWorkspace(w.id);
      toast.success(`Deleted "${w.name}" (${res.deleted_applications} applications)`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete workspace');
    }
  }

  async function toggleArchive(w: Workspace) {
    try {
      await api.updateWorkspace(w.id, { is_archived: !w.is_archived });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update workspace');
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-lg font-semibold">Dashboard</h1>
          <p className="mt-0.5 text-xs text-gray-500">
            Each workspace (tab) belongs to one bidder — that owner receives the payment credit for its
            applied rows, regardless of who entered them.
          </p>
        </div>
      </div>

      {admin && !loading && workspaces.length > 0 && (
        <section className="card mb-6 p-4" aria-labelledby="today-applied-heading">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="today-applied-heading" className="text-sm font-semibold">
                Today&apos;s applied applications
              </h2>
              <p className="mt-0.5 text-2xs text-gray-500">Select a bidder to see their profile counts</p>
            </div>
            <label className="label min-w-52">
              Bidder
              <select
                className="input mt-1"
                value={selectedBidderId}
                onChange={(event) => setSelectedBidderId(event.target.value)}
              >
                <option value="all">All bidders ({bidderActivity.reduce((sum, bidder) => sum + bidder.total, 0)})</option>
                {bidderActivity.map((bidder) => (
                  <option key={bidder.id} value={bidder.id}>
                    {bidder.username} ({bidder.total})
                  </option>
                ))}
              </select>
            </label>
            <div className="text-right">
              <p className="text-2xl font-semibold tabular-nums">{appliedTodayTotal.toLocaleString()}</p>
              <p className="text-2xs text-gray-500">total today</p>
            </div>
          </div>

          <div className="mt-4 space-y-4">
            {displayedBidderActivity.map((bidder) => (
              <div key={bidder.id}>
                <p className="text-sm font-medium">
                  {bidder.username}: total {bidder.total.toLocaleString()}
                </p>
                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-sm text-gray-700">
                  {bidder.profiles.map((profile) => (
                    <span key={profile.id}>
                      {profile.name}-{profile.count.toLocaleString()}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {displayedBidderActivity.length === 0 && (
              <p className="text-sm text-gray-500">No applications today for this bidder.</p>
            )}
          </div>
        </section>
      )}

      {admin && (
        <form onSubmit={createWorkspace} className="card mb-6 flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-48 flex-1">
            <label className="label" htmlFor="ws-name">
              Workspace name
            </label>
            <input
              id="ws-name"
              className="input"
              placeholder="John Applications"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <div className="min-w-48 flex-1">
            <label className="label" htmlFor="ws-owner">
              Owner (gets paid for this tab)
            </label>
            <select
              id="ws-owner"
              className="input"
              value={newOwner}
              onChange={(e) => setNewOwner(e.target.value)}
            >
              <option value="">Select a bidder…</option>
              {users
                .filter((u) => u.is_active)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.username} ({u.role})
                  </option>
                ))}
            </select>
          </div>
          <button type="submit" className="btn-primary" disabled={creating || !newName || !newOwner}>
            {creating ? 'Creating…' : 'Create workspace'}
          </button>
        </form>
      )}

      {!loading && workspaces.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Filter workspaces by status">
          {(['active', 'archived', 'all'] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              className={workspaceFilter === filter ? 'btn-primary btn-xs' : 'btn-secondary btn-xs'}
              onClick={() => setWorkspaceFilter(filter)}
              aria-pressed={workspaceFilter === filter}
            >
              {filter[0].toUpperCase() + filter.slice(1)} ({workspaceCounts[filter]})
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : workspaces.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-gray-600">
            {admin
              ? 'No workspaces yet. Create one above to get started.'
              : 'No workspaces have been assigned to you yet. Ask an admin for access.'}
          </p>
        </div>
      ) : filteredWorkspaces.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-gray-600">No {workspaceFilter} workspaces.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredWorkspaces.map((w) => (
            <div
              key={w.id}
              className={`card flex flex-col p-4 ${w.is_archived ? 'opacity-60' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/workspaces/${w.id}`}
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {w.name}
                  </Link>
                  <p className="mt-0.5 text-2xs text-gray-500">
                    Owner: {w.owner.username}
                    {w.is_archived && ' · archived'}
                  </p>
                </div>
              </div>

              <p className="mt-3 text-2xl font-semibold tabular-nums">
                {w.application_count.toLocaleString()}
              </p>
              <p className="text-2xs text-gray-500">applications</p>

              {admin && (
                <div className="mt-3 border-t border-gray-100 pt-3">
                  <p className="text-2xs font-medium uppercase tracking-wide text-gray-500">Applied today</p>
                  <p className="mt-1 text-xs text-gray-700">
                    {w.applied_today_by_user.length > 0
                      ? w.applied_today_by_user
                        .map((item) => `${item.username}(${item.count.toLocaleString()})`)
                        .join(' ')
                      : 'None'}
                  </p>
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-1.5">
                <Link href={`/workspaces/${w.id}`} className="btn-secondary btn-xs">
                  Open table
                </Link>
                {canEditProfiles && (
                  <button
                    type="button"
                    className="btn-secondary btn-xs"
                    onClick={() => setEditingProfile(w)}
                  >
                    Edit profile
                  </button>
                )}
                <Link href={`/workspaces/${w.id}/add`} className="btn-primary btn-xs">
                  Add application
                </Link>
                <Link href={`/workspaces/${w.id}/import`} className="btn-secondary btn-xs">
                  Import Excel/CSV
                </Link>
                {admin && (
                  <>
                    <button
                      type="button"
                      className="btn-secondary btn-xs"
                      onClick={() => setReassigning(w)}
                    >
                      Reassign owner
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-xs"
                      onClick={() => toggleArchive(w)}
                    >
                      {w.is_archived ? 'Unarchive' : 'Archive'}
                    </button>
                    <button
                      type="button"
                      className="btn-danger btn-xs"
                      onClick={() => removeWorkspace(w)}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {reassigning && admin && (
        <OwnerModal
          workspace={reassigning}
          users={users}
          onClose={() => setReassigning(null)}
          onChanged={load}
        />
      )}
      {editingProfile && (
        <ProfileModal workspace={editingProfile} onClose={() => setEditingProfile(null)} onChanged={load} />
      )}
    </main>
  );
}

function ProfileModal({
  workspace,
  onClose,
  onChanged,
}: {
  workspace: Workspace;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const profile = workspace.profile;
  const [name, setName] = useState(profile?.name ?? workspace.name);
  const [careerPath, setCareerPath] = useState(profile?.career_path ?? '');
  const [personal, setPersonal] = useState({
    fullName: '', firstName: '', middleName: '', lastName: '',
    title: '', email: '', phone: '', location: '', country: '', linkedin: '',
    address1: '', city: '', county: '', state: '', zip: '',
    gender: '', hispanicLatino: '', ethnicity: '',
    requiresSponsorship: '', legallyAuthorizedUs: '', usWorkStatus: '',
    ...(profile?.personal_info ?? {}),
  });
  const [education, setEducation] = useState(profile?.education ?? [{ degree: '', school: '', year: '' }]);
  const [certifications, setCertifications] = useState(profile?.certifications ?? []);
  const [updateHeadline, setUpdateHeadline] = useState(profile?.update_headline ?? true);
  const [useGeneratedRoleTitles, setUseGeneratedRoleTitles] = useState(profile?.use_generated_role_titles ?? true);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const composedFullName = [personal.firstName, personal.middleName, personal.lastName]
        .map((value) => value.trim())
        .filter(Boolean)
        .join(' ');
      await api.updateWorkspace(workspace.id, {
        profile_name: name,
        career_path: careerPath,
        full_name: personal.fullName.trim() || composedFullName,
        first_name: personal.firstName,
        middle_name: personal.middleName,
        last_name: personal.lastName,
        title: personal.title,
        email: personal.email,
        phone: personal.phone,
        location: personal.location,
        country: /^(?:US|USA|United States(?: of America)?)$/i.test(personal.country.trim()) ? 'United States' : personal.country,
        address1: personal.address1,
        city: personal.city,
        county: personal.county,
        state: personal.state,
        zip: personal.zip,
        linkedin: personal.linkedin,
        gender: personal.gender,
        hispanic_latino: personal.hispanicLatino,
        ethnicity: personal.ethnicity,
        requires_sponsorship: personal.requiresSponsorship,
        legally_authorized_us: personal.legallyAuthorizedUs,
        us_work_status: personal.usWorkStatus,
        education,
        certifications,
        update_headline: updateHeadline,
        use_generated_role_titles: useGeneratedRoleTitles,
      });
      toast.success('Profile saved');
      await onChanged();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save profile');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
      <form onSubmit={save} className="card max-h-[90vh] w-full max-w-2xl overflow-y-auto p-5">
        <h2 className="text-sm font-semibold">Edit resume profile</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <ProfileInput label="Profile name" value={name} onChange={setName} />
          <ProfileInput
            label="Full name"
            value={personal.fullName}
            onChange={(v) => {
              const parts = v.trim().split(/\s+/).filter(Boolean);
              setPersonal({
                ...personal,
                fullName: v,
                firstName: parts[0] || '',
                middleName: parts.length > 2 ? parts.slice(1, -1).join(' ') : '',
                lastName: parts.length > 1 ? parts.at(-1) || '' : '',
              });
            }}
          />
          <ProfileInput label="First name (application autofill)" value={personal.firstName} onChange={(v) => setPersonal({ ...personal, firstName: v })} />
          <ProfileInput label="Middle name (application autofill)" value={personal.middleName} onChange={(v) => setPersonal({ ...personal, middleName: v })} />
          <ProfileInput label="Last name (application autofill)" value={personal.lastName} onChange={(v) => setPersonal({ ...personal, lastName: v })} />
          <ProfileInput label="Title" value={personal.title} onChange={(v) => setPersonal({ ...personal, title: v })} />
          <ProfileInput label="Email" type="email" value={personal.email} onChange={(v) => setPersonal({ ...personal, email: v })} />
          <ProfileInput label="Phone" value={personal.phone} onChange={(v) => setPersonal({ ...personal, phone: v })} />
          <ProfileInput label="Location" value={personal.location} onChange={(v) => setPersonal({ ...personal, location: v })} />
          <ProfileInput label="Country" value={personal.country} onChange={(v) => setPersonal({ ...personal, country: v })} />
          <ProfileInput label="Street address (Address 1)" value={personal.address1} onChange={(v) => setPersonal({ ...personal, address1: v })} />
          <ProfileInput label="City" value={personal.city} onChange={(v) => setPersonal({ ...personal, city: v })} />
          <ProfileInput label="County" value={personal.county} onChange={(v) => setPersonal({ ...personal, county: v })} />
          <ProfileInput label="State / province" value={personal.state} onChange={(v) => setPersonal({ ...personal, state: v })} />
          <ProfileInput label="ZIP / postal code" value={personal.zip} onChange={(v) => setPersonal({ ...personal, zip: v })} />
          <ProfileInput label="LinkedIn" value={personal.linkedin} onChange={(v) => setPersonal({ ...personal, linkedin: v })} />
          <ProfileSelect
            label="U.S. work status (application autofill)"
            value={personal.usWorkStatus}
            options={['US Citizen', 'Green Card', 'Other']}
            onChange={(v) => setPersonal({ ...personal, usWorkStatus: v })}
          />
          <ProfileSelect
            label="Require employment sponsorship now or later"
            value={personal.requiresSponsorship}
            options={['Yes', 'No']}
            onChange={(v) => setPersonal({ ...personal, requiresSponsorship: v })}
          />
          <ProfileSelect
            label="Legally authorized to work in the US"
            value={personal.legallyAuthorizedUs}
            options={['Yes', 'No']}
            onChange={(v) => setPersonal({ ...personal, legallyAuthorizedUs: v })}
          />
          <ProfileSelect
            label="Gender (application autofill)"
            value={personal.gender}
            options={['Male', 'Female', 'Non-binary', 'Decline To Self Identify']}
            onChange={(v) => setPersonal({ ...personal, gender: v })}
          />
          <ProfileSelect
            label="Hispanic/Latino (application autofill)"
            value={personal.hispanicLatino}
            options={['Yes', 'No', 'Decline To Self Identify']}
            onChange={(v) => setPersonal({ ...personal, hispanicLatino: v })}
          />
          <ProfileSelect
            label="Race / ethnicity (especially when Hispanic/Latino is No)"
            value={personal.ethnicity}
            options={[
              'American Indian or Alaskan Native', 'Asian', 'Black or African American',
              'Hispanic or Latino', 'White', 'Native Hawaiian or Other Pacific Islander',
              'Two or More Races', 'Decline To Self Identify',
            ]}
            onChange={(v) => setPersonal({ ...personal, ethnicity: v })}
          />
        </div>
        <p className="mt-2 text-xs text-gray-500">
          U.S. work status is optional, used only for application autofill, and is never inferred by AI.
        </p>
        <p className="mt-2 text-xs text-gray-500">
          Application autofill always selects “I am not a protected veteran” for veteran status. Demographic values are optional and are never inferred by AI.
        </p>
        <label className="label mt-4" htmlFor="career-path">Career path</label>
        <textarea id="career-path" className="input mt-1 min-h-32 font-mono text-xs" value={careerPath} onChange={(e) => setCareerPath(e.target.value)} />
        <div className="mt-3 space-y-2">
          <label className="flex items-center gap-2 text-xs text-gray-700">
            <input type="checkbox" checked={updateHeadline} onChange={(e) => setUpdateHeadline(e.target.checked)} />
            Update headline from generated resume
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-700">
            <input type="checkbox" checked={useGeneratedRoleTitles} onChange={(e) => setUseGeneratedRoleTitles(e.target.checked)} />
            Use AI-generated job titles
          </label>
        </div>
        <h3 className="mt-4 text-xs font-semibold">Education</h3>
        {education.map((item, index) => (
          <div key={index} className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_8rem_auto]">
            <ProfileInput label="Degree" value={item.degree} onChange={(v) => setEducation(education.map((x, i) => i === index ? { ...x, degree: v } : x))} />
            <ProfileInput label="School" value={item.school} onChange={(v) => setEducation(education.map((x, i) => i === index ? { ...x, school: v } : x))} />
            <ProfileInput label="Year" value={item.year} onChange={(v) => setEducation(education.map((x, i) => i === index ? { ...x, year: v } : x))} />
            <button type="button" className="btn-danger btn-xs self-end" onClick={() => setEducation(education.filter((_, i) => i !== index))}>Remove</button>
          </div>
        ))}
        <button type="button" className="btn-secondary btn-xs mt-2" onClick={() => setEducation([...education, { degree: '', school: '', year: '' }])}>Add education</button>
        <h3 className="mt-4 text-xs font-semibold">Certifications</h3>
        {certifications.map((item, index) => (
          <div key={index} className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_8rem_auto]">
            <ProfileInput label="Name" value={item.name} onChange={(v) => setCertifications(certifications.map((x, i) => i === index ? { ...x, name: v } : x))} />
            <ProfileInput label="Issuer" value={item.issuer} onChange={(v) => setCertifications(certifications.map((x, i) => i === index ? { ...x, issuer: v } : x))} />
            <ProfileInput label="Year" value={item.year} onChange={(v) => setCertifications(certifications.map((x, i) => i === index ? { ...x, year: v } : x))} />
            <button type="button" className="btn-danger btn-xs self-end" onClick={() => setCertifications(certifications.filter((_, i) => i !== index))}>Remove</button>
          </div>
        ))}
        <button type="button" className="btn-secondary btn-xs mt-2" onClick={() => setCertifications([...certifications, { name: '', issuer: '', year: '' }])}>Add certification</button>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
        </div>
      </form>
    </div>
  );
}

function ProfileInput({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <label className="label">{label}<input type={type} className="input mt-1" value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}

function ProfileSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="label">
      {label}
      <select className="input mt-1" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Do not autofill</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function OwnerModal({
  workspace,
  users,
  onClose,
  onChanged,
}: {
  workspace: Workspace;
  users: User[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const [ownerId, setOwnerId] = useState(workspace.owner_user_id);
  const [busy, setBusy] = useState(false);

  async function reassign() {
    if (!ownerId || ownerId === workspace.owner_user_id) return;
    setBusy(true);
    try {
      await api.updateWorkspace(workspace.id, { owner_user_id: ownerId });
      const owner = users.find((user) => user.id === ownerId);
      toast.success(`Owner changed to ${owner?.username ?? 'the selected user'}`);
      await onChanged();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reassign owner');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
      <div className="card w-full max-w-md p-5">
        <h2 className="text-sm font-semibold">Reassign owner — {workspace.name}</h2>
        <p className="mt-1 text-2xs text-gray-500">
          The new owner receives payment credit for future applied rows in this workspace. Existing
          payment records are unchanged.
        </p>

        <div className="mt-4">
          <label className="label" htmlFor="workspace-owner">
            New owner
          </label>
          <select
            id="workspace-owner"
            className="input"
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
          >
            {users
              .filter((user) => user.is_active)
              .map((user) => (
                <option key={user.id} value={user.id}>
                  {user.username} ({user.role})
                </option>
              ))}
          </select>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void reassign()}
            disabled={busy || ownerId === workspace.owner_user_id}
          >
            {busy ? 'Saving…' : 'Save owner'}
          </button>
        </div>
      </div>
    </div>
  );
}
