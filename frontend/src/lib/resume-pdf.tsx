'use client';

import { pdf } from '@react-pdf/renderer';
import type React from 'react';
import type { ResumeArtifact, ResumeData } from './types';
import {
  AcademicTemplate,
  BoldTemplate,
  ClassicCoverLetterTemplate,
  ClassicTemplate,
  CorporateTemplate,
  ElegantTemplate,
  ExecutiveTemplate,
  MinimalTemplate,
  MinimalCoverLetterTemplate,
  ModernTemplate,
  ModernCoverLetterTemplate,
  TechTemplate,
} from './resume-template-bridge';

type TemplateId = 'classic' | 'modern' | 'minimal' | 'executive' | 'academic' | 'tech' |
  'elegant' | 'bold' | 'corporate';
type CoverLetterTemplateId = 'classic' | 'modern' | 'minimal';

const templates: Record<TemplateId, React.ComponentType<{ data: ResumeData }>> = {
  classic: ClassicTemplate,
  modern: ModernTemplate,
  minimal: MinimalTemplate,
  executive: ExecutiveTemplate,
  academic: AcademicTemplate,
  tech: TechTemplate,
  elegant: ElegantTemplate,
  bold: BoldTemplate,
  corporate: CorporateTemplate,
};

const coverLetterTemplates = {
  classic: ClassicCoverLetterTemplate,
  modern: ModernCoverLetterTemplate,
  minimal: MinimalCoverLetterTemplate,
} satisfies Record<CoverLetterTemplateId, React.ComponentType<any>>;

function downloadBlob(blob: Blob, filename: string) {
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

export async function downloadResumePdf(artifact: ResumeArtifact) {
  const template = artifact.template in templates ? artifact.template as TemplateId : 'classic';
  const Template = templates[template];
  const blob = await pdf(<Template data={artifact.resume} />).toBlob();
  downloadBlob(blob, 'resume.pdf');
}

export function downloadJobDescription(artifact: ResumeArtifact) {
  if (!artifact.job_description?.trim()) throw new Error('No job description was saved.');
  downloadBlob(new Blob([artifact.job_description], { type: 'text/plain;charset=utf-8' }), 'jd.txt');
}

export async function downloadCoverLetterPdf(artifact: ResumeArtifact) {
  if (!artifact.cover_letter_text?.trim()) throw new Error('No cover letter was saved.');
  const templateId = artifact.cover_letter_template in coverLetterTemplates
    ? artifact.cover_letter_template as CoverLetterTemplateId
    : 'classic';
  const Template = coverLetterTemplates[templateId];
  const blob = await pdf(
    <Template data={{
      text: artifact.cover_letter_text,
      personalInfo: artifact.resume.personalInfo,
      companyName: artifact.company_name || '',
    }} />,
  ).toBlob();
  downloadBlob(blob, 'cover letter.pdf');
}
