import type React from 'react';
import type { ResumeData } from './types';

type ResumeTemplate = React.ComponentType<{ data: ResumeData }>;

export const ClassicTemplate: ResumeTemplate;
export const ModernTemplate: ResumeTemplate;
export const MinimalTemplate: ResumeTemplate;
export const ExecutiveTemplate: ResumeTemplate;
export const AcademicTemplate: ResumeTemplate;
export const TechTemplate: ResumeTemplate;
export const ElegantTemplate: ResumeTemplate;
export const BoldTemplate: ResumeTemplate;
export const CorporateTemplate: ResumeTemplate;

type CoverLetterTemplate = React.ComponentType<{
  data: {
    text: string;
    personalInfo: ResumeData['personalInfo'];
    companyName: string;
  };
}>;

export const ClassicCoverLetterTemplate: CoverLetterTemplate;
export const ModernCoverLetterTemplate: CoverLetterTemplate;
export const MinimalCoverLetterTemplate: CoverLetterTemplate;
