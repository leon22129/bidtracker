'use client';

import type { ResumeArtifact } from '@/lib/types';

export function ApplicationAnswersModal({
  artifact,
  onClose,
}: {
  artifact: ResumeArtifact;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="application-answers-title"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h2 id="application-answers-title" className="text-base font-semibold text-gray-900">
              Application questions and answers
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              {[artifact.company_name, artifact.job_title].filter(Boolean).join(' — ') || 'Saved application'}
            </p>
          </div>
          <button type="button" className="btn-secondary btn-xs" onClick={onClose}>Close</button>
        </div>
        <div className="overflow-y-auto p-5">
          {artifact.answers.length === 0 ? (
            <p className="text-sm text-gray-500">No application questions and answers were saved.</p>
          ) : (
            <div className="space-y-4">
              {artifact.answers.map((item, index) => (
                <section key={`${item.question}-${index}`} className="rounded-md border border-gray-200 bg-gray-50 p-4">
                  <h3 className="text-sm font-semibold text-gray-900">{item.question}</h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">{item.answer}</p>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
