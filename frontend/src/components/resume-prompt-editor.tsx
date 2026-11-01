'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { AiSettings } from '@/lib/ai-types';
import { useToast } from '@/components/ui/toast';

export function ResumePromptEditor({ settings, onSaved }: { settings: AiSettings; onSaved: (settings: AiSettings) => void }) {
  const toast = useToast();
  const [prompt, setPrompt] = useState(settings.resume_prompt);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPrompt(settings.resume_prompt); }, [settings.resume_prompt]);
  const dirty = prompt !== settings.resume_prompt;
  const missing = settings.resume_prompt_variables.filter((token) => !prompt.includes(token));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api.updateResumePrompt(prompt === settings.default_resume_prompt ? null : prompt);
      onSaved(result);
      toast.success('Resume generation prompt saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the resume prompt');
    } finally { setBusy(false); }
  }

  return (
    <details className="card mt-5 p-4">
      <summary className="cursor-pointer text-sm font-semibold">Base resume generation prompt</summary>
      <form onSubmit={save} className="mt-3 space-y-3">
        <p className="text-2xs text-gray-500">
          {settings.resume_prompt_customized ? 'You are using a custom prompt.' : 'You are using the original prompt.'}{' '}
          Edit the instructions used for new resumes and cover letters across your profiles. Other admins keep their own prompts.
        </p>
        <fieldset disabled={busy} className="space-y-3 disabled:opacity-60">
          <div>
            <label htmlFor="resume-generation-prompt" className="label">Resume generation prompt</label>
            <textarea id="resume-generation-prompt" className="input min-h-96 font-mono text-xs" rows={20}
              value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={settings.resume_prompt_max_length}
              spellCheck={false} aria-describedby="resume-prompt-help" required />
            <p className="mt-1 text-right text-2xs text-gray-500">{prompt.length.toLocaleString()} / {settings.resume_prompt_max_length.toLocaleString()} characters</p>
          </div>
          <p id="resume-prompt-help" className="text-2xs text-gray-500">
            Keep these placeholders so each resume receives the correct job and candidate details:{' '}
            {settings.resume_prompt_variables.map((token) => <code key={token} className="mr-1 inline-block rounded bg-gray-100 px-1">{token}</code>)}
            The app keeps the required resume fields and JSON output format.
          </p>
          {dirty && missing.length > 0 && <p role="alert" className="text-xs text-red-700">Missing placeholders: {missing.join(', ')}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-secondary" disabled={prompt === settings.default_resume_prompt}
              onClick={() => setPrompt(settings.default_resume_prompt)}>Restore original prompt</button>
            <button type="submit" className="btn-primary" disabled={!dirty || missing.length > 0 || !prompt.trim()}>
              {busy ? 'Saving…' : 'Save prompt'}
            </button>
          </div>
          {dirty && <p className="text-2xs text-amber-800">Unsaved changes. Save to apply this prompt to future generations.</p>}
        </fieldset>
      </form>
    </details>
  );
}
