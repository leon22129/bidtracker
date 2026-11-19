'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { downloadBlob } from '@/lib/artifact-download';
import type { ApplicationDocument } from '@/lib/types';
import { useToast } from '@/components/ui/toast';

export function ApplicationDocumentDownloads({ applicationId, documents }: {
  applicationId: string;
  documents: ApplicationDocument[];
}) {
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);

  async function download(document: ApplicationDocument) {
    setDownloading(true);
    try {
      downloadBlob(await api.getApplicationDocument(applicationId, document), document.filename);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not download document');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="cell justify-center gap-1">
      {[...documents].sort((a, b) => b.kind.localeCompare(a.kind) || a.format.localeCompare(b.format)).map((document) => (
        <button key={`${document.kind}-${document.format}`} type="button" disabled={downloading}
          className="rounded border border-gray-400 dark:border-gray-500 bg-white dark:bg-gray-900 px-1.5 py-0.5 text-2xs font-semibold text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
          title={`Download saved ${document.kind === 'resume' ? 'resume' : 'job description'} ${document.format.toUpperCase()}`}
          onClick={() => void download(document)}>
          {document.kind === 'resume' ? 'Resume' : 'JD'}.{document.format}
        </button>
      ))}
    </div>
  );
}
