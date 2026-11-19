'use client';

import { useState } from 'react';

const MAX_PDF_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_LENGTH = 50_000;

export function ApplicationDocumentInput({
  id, label, pdf, text, onPdfChange, onTextChange, onReadingChange,
}: {
  id: string;
  label: string;
  pdf: File | null;
  text: string;
  onPdfChange: (file: File | null) => void;
  onTextChange: (text: string) => void;
  onReadingChange: (reading: boolean) => void;
}) {
  const [error, setError] = useState('');
  const [importedName, setImportedName] = useState('');

  async function chooseFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    if (/\.pdf$/i.test(file.name)) {
      if (!file.size || file.size > MAX_PDF_BYTES) {
        setError('Choose a non-empty PDF up to 5 MB.');
        return;
      }
      onPdfChange(file);
      return;
    }
    if (!/\.txt$/i.test(file.name)) {
      setError('Choose a PDF or TXT file.');
      return;
    }
    if (!file.size || file.size > MAX_TEXT_LENGTH * 4) {
      setError('Choose a non-empty TXT file with up to 50,000 characters.');
      return;
    }
    onReadingChange(true);
    try {
      const value = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()).trim();
      if (!value || value.includes('\0') || value.length > MAX_TEXT_LENGTH) {
        throw new Error('TXT files must contain between 1 and 50,000 characters of plain text.');
      }
      onTextChange(value);
      setImportedName(file.name);
    } catch (error) {
      setError(error instanceof TypeError ? 'Save the TXT file with UTF-8 encoding and try again.'
        : error instanceof Error ? error.message : 'Could not read the TXT file.');
    } finally {
      onReadingChange(false);
    }
  }

  return (
    <fieldset className="space-y-2 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
      <legend className="px-1 text-sm font-medium">{label} <span className="text-xs font-normal text-gray-500 dark:text-gray-400">(required)</span></legend>
      <p id={`${id}-help`} className="text-xs text-gray-500 dark:text-gray-400">
        Upload a PDF or TXT file, paste text, or provide both PDF and text. PDFs: up to 5 MB. Text: up to 50,000 characters.
      </p>
      <div>
        <label className="label" htmlFor={`${id}-file`}>Upload PDF or TXT</label>
        <input id={`${id}-file`} type="file" accept=".pdf,.txt,application/pdf,text/plain"
          className="input text-xs" aria-describedby={`${id}-help`} onChange={chooseFile} />
      </div>
      {pdf && (
        <div className="flex items-center justify-between gap-2 rounded bg-gray-50 dark:bg-gray-800 p-2 text-xs">
          <span className="min-w-0 break-all">PDF: {pdf.name}</span>
          <button type="button" className="shrink-0 underline" aria-label={`Remove ${label.toLowerCase()} PDF`}
            onClick={() => { onPdfChange(null); setError(''); }}>Remove</button>
        </div>
      )}
      <div>
        <label className="label" htmlFor={`${id}-text`}>Text version{pdf ? ' (optional)' : ''}</label>
        <textarea id={`${id}-text`} className="input min-h-32 resize-y" rows={6}
          value={text} maxLength={MAX_TEXT_LENGTH} required={!pdf}
          aria-describedby={`${id}-help`} placeholder={`Paste the ${label.toLowerCase()} here`}
          onChange={(event) => { onTextChange(event.target.value); setImportedName(''); setError(''); }} />
        {importedName && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Loaded {importedName} into the text version.</p>}
      </div>
      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </fieldset>
  );
}
