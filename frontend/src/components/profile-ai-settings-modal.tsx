'use client';

import { useEffect, useRef } from 'react';
import { AiSettingsForm } from './ai-settings-form';

export function ProfileAiSettingsModal({ workspaceId, name, onClose }: {
  workspaceId: string; name: string; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} onCancel={onClose}
    className="card m-auto max-h-[90vh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto p-5 text-gray-900 dark:text-gray-100 backdrop:bg-black/50"
    aria-labelledby="profile-ai-heading">
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 id="profile-ai-heading" className="text-sm font-semibold">AI settings — {name}</h2>
        <p className="mt-1 text-2xs text-gray-500 dark:text-gray-400">Use the admin's account defaults or save an override for this profile.</p>
      </div>
      <button type="button" className="btn-secondary btn-xs" onClick={onClose} aria-label="Close AI settings">Close</button>
    </div>
    <AiSettingsForm key={workspaceId} workspaceId={workspaceId} />
  </dialog>;
}
