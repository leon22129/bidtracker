'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { AiModel, AiProvider, AiSettings } from '@/lib/ai-types';
import { useToast } from '@/components/ui/toast';
import { ResumePromptEditor } from './resume-prompt-editor';

const usd = (value: number) => `$${value.toLocaleString('en-US', { maximumFractionDigits: 4 })}`;
const price = (model: AiModel) => `${usd(model.input)} input / ${usd(model.output)} output`;

export function AiSettingsForm() {
  const toast = useToast();
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [provider, setProvider] = useState<AiProvider>('openai');
  const [modelId, setModelId] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadVersion, setLoadVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setError('');
    void api.aiSettings().then((data) => {
      if (!active) return;
      setSettings(data); setProvider(data.provider); setModelId(data.model);
    }).catch((err) => { if (active) setError(err instanceof Error ? err.message : 'Could not load AI settings'); });
    return () => { active = false; };
  }, [loadVersion]);

  const models = settings?.models.filter((model) => model.provider === provider) ?? [];
  const selected = models.find((model) => model.id === modelId);
  const keyStatus = settings?.keys[provider];

  function changeProvider(value: AiProvider) {
    setProvider(value); setKey('');
    setModelId(settings?.provider === value ? settings.model
      : settings?.models.find((model) => model.provider === value)?.id ?? '');
  }

  async function save(removeKey = false) {
    setBusy(true);
    try {
      const data = await api.updateAiSettings({ provider, model: modelId,
        ...(removeKey ? { remove_api_key: true } : key.trim() ? { api_key: key.trim() } : {}),
      });
      setSettings(data); setKey('');
      toast.success(removeKey ? 'Saved API key removed' : 'AI settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save AI settings');
    } finally { setBusy(false); }
  }

  return (
    <>
    <form className="card mt-5 space-y-3 p-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div>
        <h2 className="text-sm font-semibold">AI generation</h2>
        <p className="mt-1 text-2xs text-gray-500">
          Choose the platform and model for your profiles and bidders. Used for resumes, cover letters, eligibility checks, and application answers.
        </p>
      </div>
      {error ? <div role="alert" className="text-xs text-red-700">{error}
        <button type="button" className="ml-2 underline" onClick={() => setLoadVersion((value) => value + 1)}>Retry</button>
      </div> : !settings ? <p className="text-xs text-gray-500">Loading AI settings…</p> : (
        <fieldset disabled={busy} className="space-y-3 disabled:opacity-60">
          <div>
            <label className="label" htmlFor="ai-platform">AI platform</label>
            <select id="ai-platform" className="input" value={provider} onChange={(event) => changeProvider(event.target.value as AiProvider)}>
              <option value="openai">OpenAI</option>
              <option value="deepseek">DeepSeek</option>
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
            <div className="rounded border border-gray-200 bg-gray-50 p-3 text-xs">
              <dl className="grid grid-cols-3 gap-2">
                <div><dt className="text-gray-500">Input{provider === 'deepseek' ? ' (peak)' : ''}</dt><dd className="mt-1 font-medium">{usd(selected.input)}</dd></div>
                <div><dt className="text-gray-500">Cached input</dt><dd className="mt-1 font-medium">{selected.cached_input === null ? 'No discount' : usd(selected.cached_input)}</dd></div>
                <div><dt className="text-gray-500">Output</dt><dd className="mt-1 font-medium">{usd(selected.output)}</dd></div>
              </dl>
              {selected.off_peak && <p className="mt-2 text-2xs text-gray-600">
                Off-peak: {usd(selected.off_peak.input)} input · {usd(selected.off_peak.cached_input)} cached input · {usd(selected.off_peak.output)} output.
                Peak: Mon–Fri, 01:00–04:00 and 06:00–10:00 UTC, excluding Chinese public holidays.
              </p>}
              {selected.deprecated && <p className="mt-2 text-2xs text-amber-800">This model is deprecated by OpenAI and may have limited availability.</p>}
            </div>
          )}
          <details className="text-2xs">
            <summary className="cursor-pointer font-medium">Compare all {models.length} models</summary>
            <div className="mt-2 max-h-64 overflow-auto">
              <table className="w-full text-left">
                <thead><tr className="border-b"><th className="py-1">Model</th><th>Input</th><th>Cached</th><th>Output</th></tr></thead>
                <tbody>{models.map((model) => <tr key={model.id} className="border-b border-gray-100">
                  <td className="py-1 pr-2">{model.id}{model.deprecated ? ' (deprecated)' : ''}</td>
                  <td className="pr-2">{usd(model.input)}</td><td className="pr-2">{model.cached_input === null ? '—' : usd(model.cached_input)}</td><td>{usd(model.output)}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </details>
          <p className="text-2xs text-gray-500">
            Text generation model families, without dated snapshots or duplicate aliases. Image, audio, embeddings, restricted research models, and retired models are excluded.
            Prices checked {settings.checked_at}. Standard text rates; long prompts, tools, and special processing can cost more. Availability depends on your API account.{' '}
            <a href={settings.sources[provider]} target="_blank" rel="noreferrer" className="text-primary-600 underline">Official pricing</a>
          </p>
          <div>
            <label className="label" htmlFor="ai-api-key">{provider === 'openai' ? 'OpenAI' : 'DeepSeek'} API key</label>
            <input id="ai-api-key" type="password" className="input" autoComplete="new-password" maxLength={1000}
              placeholder={keyStatus?.configured ? 'Leave blank to keep the current key' : 'Enter API key'}
              value={key} onChange={(event) => setKey(event.target.value)} />
            <p className="mt-1 text-2xs text-gray-500">
              {keyStatus?.saved ? 'Your key is saved. ' : 'Add your own API key to enable generation. '}
              Saved keys are encrypted and never displayed again. Each platform keeps its own key.
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            {keyStatus?.saved && <button type="button" className="btn-danger" disabled={!selected} onClick={() => void save(true)}>Remove saved key</button>}
            <button className="btn-primary" type="submit" disabled={!selected || (!keyStatus?.configured && !key.trim())}>
              {busy ? 'Saving…' : 'Save AI settings'}
            </button>
          </div>
        </fieldset>
      )}
    </form>
    {settings && <ResumePromptEditor settings={settings} onSaved={setSettings} />}
    </>
  );
}
