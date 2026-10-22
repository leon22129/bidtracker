'use client';

import type { ResumeArtifact } from './types';

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function downloadJobDescription(artifact: ResumeArtifact) {
  if (!artifact.job_description?.trim()) throw new Error('No job description was saved.');
  downloadBlob(new Blob([artifact.job_description], { type: 'text/plain;charset=utf-8' }), 'jd.txt');
}
