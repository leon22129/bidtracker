'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { AiModel, AiProvider, AiSettings, ProfileAiSettings } from '@/lib/ai-types';
import { useToast } from '@/components/ui/toast';

const usd = (value: number) => `$${value.toLocaleString('en-US', { maximumFractionDigits: 4 })}`;
const price = (model: Pick<AiModel, 'input' | 'output'>) => `${usd(model.input)} input / ${usd(model.output)} output`;

export function AiSettingsForm({ workspaceId }: { workspaceId?: string }) {
  const toast = useToast();
  const [settings, setSettings] = useState<AiSettings | ProfileAiSettings | null>(null);
  const [customizing, setCustomizing] = useState(false);
  const [provider, setProvider] = useState<AiProvider>('openai');
  const [modelId, setModelId] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadVersion, setLoadVersion] = useState(0);

  function applySettings(data: AiSettings | ProfileAiSettings) {
    setSettings(data); setProvider(data.provider); setModelId(data.model); setKey('');
    setCustomizing('uses_account_defaults' in data ? !data.uses_account_defaults : true);
  }

  useEffect(() => {
    let active = true;
    setError('');
    setSettings(null); setKey('');
    void (workspaceId ? api.profileAiSettings(workspaceId) : api.aiSettings()).then((data) => {
      if (!active) return;
      applySettings(data);
    }).catch((err) => { if (active) setError(err instanceof Error ? err.message : 'Could not load AI settings'); });
    return () => { active = false; };
  }, [loadVersion, workspaceId]);

  const models = settings?.models.filter((model) => model.provider === provider) ?? [];
  const selected = models.find((model) => model.id === modelId);
  const keyStatus = settings?.keys[provider];
  const platform = settings?.providers[provider];
  const profileSettings = settings && 'uses_account_defaults' in settings ? settings : null;

  function changeProvider(value: AiProvider) {
    setProvider(value); setKey('');
    setModelId(settings?.provider === value ? settings.model
      : settings?.providers[value].default_model ?? '');
  }

  async function save(removeKey = false) {
    setBusy(true);
    try {
      const changes = { provider, model: modelId,
        ...(removeKey ? { remove_api_key: true } : key.trim() ? { api_key: key.trim() } : {}),
      };
      const data = await (workspaceId ? api.updateProfileAiSettings(workspaceId, changes) : api.updateAiSettings(changes));
      applySettings(data);
      toast.success(removeKey ? 'Account API key removed' : workspaceId ? 'Profile override saved' : 'Account AI defaults saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save AI settings');
    } finally { setBusy(false); }
  }

  async function useAccountDefaults() {
    if (!workspaceId) return;
    setBusy(true);
    try {
      applySettings(await api.resetProfileAiSettings(workspaceId));
      toast.success('Profile now uses account defaults');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reset AI settings');
    } finally { setBusy(false); }
  }

  return (
    <form className={workspaceId ? 'mt-4 space-y-3' : 'card mt-5 space-y-3 p-4'}
      onSubmit={(event) => { event.preventDefault(); if (customizing) void save(); }}>
      <div>
        <h2 className="text-sm font-semibold">AI generation</h2>
        <p className="mt-1 text-2xs text-gray-500 dark:text-gray-400">
          {workspaceId
            ? 'Choose a special model and API key for this profile, or use its admin’s account defaults.'
            : 'Set the default model and API key for your profiles. Profiles with their own override keep their special settings.'}
          {' '}Used for resumes, cover letters, eligibility checks, and application answers.
        </p>
      </div>
      {error ? <div role="alert" className="text-xs text-red-700 dark:text-red-300">{error}
        <button type="button" className="ml-2 underline" onClick={() => setLoadVersion((value) => value + 1)}>Retry</button>
      </div> : !settings ? <p className="text-xs text-gray-500 dark:text-gray-400">Loading AI settings…</p> : (
        <fieldset disabled={busy} className="space-y-3 disabled:opacity-60">
          {profileSettings && <div className="rounded border border-gray-200 p-3 text-xs dark:border-gray-700">
            <p className="font-semibold">{profileSettings.uses_account_defaults ? 'Using account defaults' : 'Using profile override'}</p>
            <p className="mt-1 break-words text-gray-500 dark:text-gray-400">
              Account default: {settings.providers[profileSettings.account_defaults.provider].name} / {profileSettings.account_defaults.model}.
              {' '}{profileSettings.account_defaults.configured ? 'Account key is saved.' : 'No account key is configured. Ask the profile admin to save one in Account.'}
            </p>
            {!profileSettings.uses_account_defaults ? <>
              <p className="mt-1 text-gray-500 dark:text-gray-400">Returning to account defaults clears this profile’s saved model and keys.</p>
              <button type="button" className="btn-secondary btn-xs mt-2" onClick={() => void useAccountDefaults()}>Use account defaults</button>
            </> : customizing ? <>
              <p className="mt-1 text-gray-500 dark:text-gray-400">Account defaults stay active until you save the override with its own API key.</p>
              <button type="button" className="btn-secondary btn-xs mt-2" onClick={() => applySettings(profileSettings)}>Cancel override</button>
            </> : <>
              <p className="mt-1 text-gray-500 dark:text-gray-400">Changes to the admin’s account settings apply automatically.</p>
              <button type="button" className="btn-secondary btn-xs mt-2" onClick={() => setCustomizing(true)}>Set profile override</button>
            </>}
          </div>}
          {customizing && <>
          <div>
            <label className="label" htmlFor="ai-platform">AI platform</label>
            <select id="ai-platform" className="input" value={provider} onChange={(event) => changeProvider(event.target.value as AiProvider)}>
              {(Object.entries(settings.providers) as [AiProvider, AiSettings['providers'][AiProvider]][])
                .map(([id, info]) => <option key={id} value={id}>{info.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ai-model">Model — USD per 1M tokens</label>
            <select id="ai-model" className="input" value={modelId} onChange={(event) => setModelId(event.target.value)} required>
              {!selected && <option value={modelId} disabled>{modelId || 'Choose a model'} — select a supported model</option>}
              {models.map((model) => <option key={model.id} value={model.id}>
                {model.id}{model.deprecated ? ' (deprecated)' : ''} — {price(model)}
              </option>)}
            </select>
          </div>
          {selected && (
            <div className="rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-3 text-xs">
              <dl className="grid grid-cols-3 gap-2">
                <div><dt className="text-gray-500 dark:text-gray-400">Input{provider === 'deepseek' ? ' (peak)' : ''}</dt><dd className="mt-1 font-medium">{usd(selected.input)}</dd></div>
                <div><dt className="text-gray-500 dark:text-gray-400">Cached input</dt><dd className="mt-1 font-medium">{selected.cached_input === null ? 'No discount' : usd(selected.cached_input)}</dd></div>
                <div><dt className="text-gray-500 dark:text-gray-400">Output</dt><dd className="mt-1 font-medium">{usd(selected.output)}</dd></div>
              </dl>
              {selected.cache_write !== undefined && <p className="mt-2 text-2xs text-gray-600 dark:text-gray-400">
                Cache writes (5 minutes): {usd(selected.cache_write)} per 1M tokens.
              </p>}
              {selected.long_context && <p className="mt-2 text-2xs text-gray-600 dark:text-gray-400">
                Above {selected.long_context.above_tokens.toLocaleString('en-US')} input tokens: {price(selected.long_context)}
                {selected.long_context.cached_input !== null && ` / ${usd(selected.long_context.cached_input)} cached input`}
                {selected.long_context.cache_write !== undefined && ` / ${usd(selected.long_context.cache_write)} cache writes`}.
              </p>}
              {selected.price_change && <p className="mt-2 text-2xs text-gray-600 dark:text-gray-400">
                Rates from {selected.price_change.effective_at}: {price(selected.price_change)}
                {selected.price_change.cached_input !== null && ` / ${usd(selected.price_change.cached_input)} cached input`}.
              </p>}
              {selected.context_window && <p className="mt-2 text-2xs text-gray-600 dark:text-gray-400">
                Context: {selected.context_window.toLocaleString('en-US')} tokens{provider === 'gemini' ? ' (input and output combined)' : ''}.
                {' '}Maximum output per request: {selected.max_output_tokens?.toLocaleString('en-US')} tokens, including thinking.
              </p>}
              {selected.off_peak && <p className="mt-2 text-2xs text-gray-600 dark:text-gray-400">
                Off-peak: {usd(selected.off_peak.input)} input · {usd(selected.off_peak.cached_input)} cached input · {usd(selected.off_peak.output)} output.
                Peak: Mon–Fri, 01:00–04:00 and 06:00–10:00 UTC, excluding Chinese public holidays.
              </p>}
              {selected.deprecated && <p className="mt-2 text-2xs text-amber-800 dark:text-amber-200">This model is deprecated by its provider and may have limited availability.</p>}
            </div>
          )}
          <details className="text-2xs">
            <summary className="cursor-pointer font-medium">Compare all {models.length} models</summary>
            <div className="mt-2 max-h-64 overflow-auto">
              <table className="w-full text-left">
                <thead><tr className="border-b"><th className="py-1">Model</th><th>Input</th><th>Cached</th><th>Output</th></tr></thead>
                <tbody>{models.map((model) => <tr key={model.id} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="py-1 pr-2">{model.id}{model.deprecated ? ' (deprecated)' : ''}</td>
                  <td className="pr-2">{usd(model.input)}</td><td className="pr-2">{model.cached_input === null ? '—' : usd(model.cached_input)}</td><td>{usd(model.output)}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </details>
          <p className="text-2xs text-gray-500 dark:text-gray-400">
            Supported text generation model families. Image, audio, embeddings, restricted research models, and retired models are excluded.
            Prices checked {platform?.checked_at ?? settings.checked_at}. Standard text rates; long prompts, tools, and special processing can cost more. Availability depends on your API account.{' '}
            <a href={settings.sources[provider]} target="_blank" rel="noreferrer" className="text-primary-600 underline">Official pricing</a>
          </p>
          {platform?.notes && <p className="text-2xs text-gray-500 dark:text-gray-400">{platform.notes}</p>}
          {platform && <details className="text-2xs text-gray-500 dark:text-gray-400">
            <summary className="cursor-pointer">API endpoint</summary>
            <code className="mt-1 block break-all">{platform.target_url.replace('{model}', modelId)}</code>
          </details>}
          <div>
            <label className="label" htmlFor="ai-api-key">{platform?.name} API key</label>
            <input id="ai-api-key" type="password" className="input" autoComplete="new-password" maxLength={1000}
              placeholder={keyStatus?.configured ? 'Leave blank to keep the current key' : 'Enter API key'}
              value={key} onChange={(event) => setKey(event.target.value)} />
            <p className="mt-1 text-2xs text-gray-500 dark:text-gray-400">
              {keyStatus?.saved ? 'Your key is saved. ' : 'Add your own API key to enable generation. '}
              Saved keys are encrypted and never displayed again.{' '}
              {workspaceId ? 'This override uses its own key, separate from the account defaults.' : 'Each platform keeps its own account key.'}
              {platform && <> <a href={platform.key_url} target="_blank" rel="noreferrer" className="text-primary-600 underline">Get an API key</a></>}
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            {!workspaceId && keyStatus?.saved && <button type="button" className="btn-danger" disabled={!selected} onClick={() => void save(true)}>Remove saved key</button>}
            <button className="btn-primary" type="submit" disabled={!selected || (!keyStatus?.configured && !key.trim())}>
              {busy ? 'Saving…' : 'Save AI settings'}
            </button>
          </div>
          </>}
        </fieldset>
      )}
    </form>
  );
}
