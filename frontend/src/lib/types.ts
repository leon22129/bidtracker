// Mirrors the backend's Prisma models and `src/common/constants.ts`.
// Kept hand-written (rather than generated) so the frontend depends only on the HTTP contract.

export const ROLES = ['super_admin', 'admin', 'bidder_manager', 'bidder'] as const;
export type Role = (typeof ROLES)[number];

export const APPLICATION_STATUSES = ['Pending', 'Applied', 'Rejected', 'Duplicated'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const PIPELINE_STATUSES = [
  'Not Started',
  'Recruiter Interview',
  'Technical Interview',
  'Final Interview',
  'Offer Received',
  'Accepted',
  'Rejected',
] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

export const JOB_SOURCES = [
  'Greenhouse', 'Workday', 'ADP', 'AshbyHQ', 'BambooHR', 'JobDiva', 'Dayforce', 'UKG',
  'PaycomOnline', 'Jobvite', 'Lever', 'SmartRecruiters', 'iCIMS', 'Zoho Recruit', 'Paylocity',
  'Rippling', 'Taleo', 'LinkedIn', 'Indeed', 'ZipRecruiter', 'Company Career Page', 'Other',
] as const;
export type JobSource = (typeof JOB_SOURCES)[number];

export interface User {
  id: string;
  username: string;
  email: string;
  role: Role;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  owned_workspace_count?: number;
}

export interface BannedUrlPattern {
  id: string;
  pattern: string;
  created_at: string;
  created_by_user_id?: string | null;
  createdByUser?: { username: string } | null;
}

export interface Workspace {
  id: string;
  name: string;
  owner_user_id: string;
  created_by_user_id?: string;
  owner: { id: string; username: string; email: string };
  is_archived: boolean;
  application_count: number;
  created_at: string;
  updated_at: string;
  profile: ResumeProfile | null;
}

export interface ResumeProfile {
  id: string;
  name: string;
  career_path: string;
  personal_info: {
    fullName: string;
    firstName: string;
    middleName: string;
    lastName: string;
    title: string;
    email: string;
    phone: string;
    location: string;
    country: string;
    address1: string;
    city: string;
    county: string;
    state: string;
    zip: string;
    linkedin: string;
    gender: string;
    hispanicLatino: string;
    ethnicity: string;
    requiresSponsorship: string;
    legallyAuthorizedUs: string;
    usWorkStatus: string;
  };
  education: Array<{ degree: string; school: string; year: string }>;
  certifications: Array<{ name: string; issuer: string; year: string }>;
  update_headline: boolean;
  use_generated_role_titles: boolean;
  template: string;
  save_in_folder: boolean;
  auto_download: boolean;
  download_jd_with_pdf: boolean;
  use_company_name: boolean;
  generate_cover_letter: boolean;
  cover_letter_template: string;
}

export interface JobApplication {
  id: string;
  workspace_id: string;
  date: string;
  number: number;
  job_title: string | null;
  company_name: string | null;
  url: string;
  normalized_url: string;
  job_source: JobSource;
  application_status: ApplicationStatus;
  pipeline_status: PipelineStatus;
  interview_date: string | null;
  interview_note: string | null;
  note: string | null;
  paid: boolean;
  resume_generated_at: string | null;
  cover_letter_template: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface ApplicationFilters {
  search?: string;
  application_status?: ApplicationStatus[];
  pipeline_status?: PipelineStatus[];
  job_source?: JobSource[];
  paid?: boolean;
  date_from?: string;
  date_to?: string;
  sort_by?: string;
  sort_dir?: 'asc' | 'desc';
}

export interface WorkspaceSummary {
  total: number;
  paid: number;
  by_application_status: Record<string, number>;
  by_pipeline_status: Record<string, number>;
  by_job_source: Record<string, number>;
}

export interface PaymentReport {
  id: string;
  bidder_id: string;
  bidder_username: string;
  start_date: string;
  end_date: string;
  applied_count: number;
  processed_by: string | null;
  processed_at: string;
}

export interface PaymentReportResult {
  start_date: string;
  end_date: string;
  total_applied: number;
  bidders: Array<{
    bidder_id: string;
    bidder_username: string;
    applied_count: number;
    workspaces: Array<{ workspace_id: string; workspace_name: string; applied_count: number }>;
  }>;
}

export interface AnalyticsOverview {
  conversion: {
    total_applications: number;
    pending_count: number;
    applied_count: number;
    rejected_count: number;
    duplicated_count: number;
    interview_count: number;
    offer_count: number;
    accepted_count: number;
    interview_rate: number | null;
    offer_rate: number | null;
    offer_per_interview_rate: number | null;
    duplicate_rate: number | null;
  };
  interviews_by_workspace: Array<{
    workspace_id: string;
    workspace_name: string;
    owner_username: string;
    interviews: number;
  }>;
  interviews_by_source: Array<{
    job_source: string;
    interviews: number;
    applied: number;
    interview_rate: number | null;
  }>;
  pipeline_breakdown: Array<{ pipeline_status: PipelineStatus; count: number }>;
  daily_volume: Array<{ date: string; applied: number }>;
}

export interface ResumeData {
  personalInfo: {
    fullName: string;
    title: string;
    email: string;
    phone: string;
    location: string;
    linkedin: string;
  };
  education: Array<{ degree: string; school: string; year: string }>;
  certifications: Array<{ name: string; issuer: string; year: string }>;
  summary: string;
  skills: Array<{ category: string; items: string[] }>;
  workexperience: Array<{
    role: string;
    original_role?: string;
    companyname: string;
    duration: string;
    experience: string[];
  }>;
  annualSalary?: string;
  hourlyRate?: string;
  rateInJd?: boolean;
}

export interface ResumeArtifact {
  id: string;
  job_title: string | null;
  company_name: string | null;
  resume: ResumeData;
  template: string;
  generated_at: string | null;
  job_description: string | null;
  cover_letter_text: string | null;
  cover_letter_template: string;
  conversation_available: boolean;
}

export interface UpcomingInterview {
  id: string;
  workspace_id: string;
  job_title: string | null;
  company_name: string | null;
  interview_date: string;
  interview_note: string | null;
  pipeline_status: PipelineStatus;
  workspace: { name: string };
}

export interface ImportResult {
  total_rows: number;
  created: number;
  duplicates: number;
  skipped: Array<{ row: number; reason: string }>;
  missing_fields: MissingImportField[];
  detected_columns: Record<string, number | null>;
}

export interface ImportPreview {
  headers: string[];
  detected_columns: Record<string, number | null>;
  total_rows: number;
  sample: unknown[][];
  missing_fields: MissingImportField[];
}

export interface MissingImportField {
  row: number;
  fields: Array<'job_title' | 'company_name'>;
}
