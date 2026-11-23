'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { ResumePromptSettings } from '@/lib/ai-types';
import { ResumePromptEditor } from './resume-prompt-editor';

export function AccountResumePrompt() {
  const [settings, setSettings] = useState<ResumePromptSettings | null>(null);
  const [error, setError] = useState('');
  const [loadVersion, setLoadVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    void api.resumePromptSettings().then((value) => { if (active) setSettings(value); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : 'Could not load resume prompt'); });
    return () => { active = false; };
  }, [loadVersion]);
  return <>
    {error ? <p role="alert" className="mt-3 text-xs text-red-700 dark:text-red-300">{error}
      <button type="button" className="ml-2 underline" onClick={() => setLoadVersion((value) => value + 1)}>Retry</button>
    </p> : settings ? <ResumePromptEditor settings={settings} onSaved={setSettings} />
      : <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">Loading resume prompt…</p>}
  </>;
}
