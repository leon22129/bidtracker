'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { canManageWorkspaces } from '@/lib/permissions';
import type { User, Workspace } from '@/lib/types';
import { useToast } from '@/components/ui/toast';

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
          <h1 className="text-lg font-semibold">Workspaces</h1>
          <p className="mt-0.5 text-xs text-gray-500">
            Each workspace (tab) belongs to one bidder — that owner receives the payment credit for its
            applied rows, regardless of who entered them.
          </p>
        </div>
      </div>

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
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {workspaces.map((w) => (
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
  const [personal, setPersonal] = useState(profile?.personal_info ?? {
    fullName: '', title: '', email: '', phone: '', location: '', country: '', linkedin: '',
    address1: '', city: '', county: '', state: '', zip: '',
    gender: '', hispanicLatino: '', ethnicity: '',
    requiresSponsorship: '', legallyAuthorizedUs: '',
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
      await api.updateWorkspace(workspace.id, {
        profile_name: name,
        career_path: careerPath,
        full_name: personal.fullName,
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
          <ProfileInput label="Full name" value={personal.fullName} onChange={(v) => setPersonal({ ...personal, fullName: v })} />
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
