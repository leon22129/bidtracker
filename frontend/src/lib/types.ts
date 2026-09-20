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

export type PermissionType = 'view' | 'edit';
export type AccessLevel = 'none' | 'view' | 'edit';

export interface User {
  id: string;
  username: string;
  email: string;
  role: Role;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  owned_workspace_count?: number;
  granted_workspace_count?: number;
}

export interface WorkspacePermissionRow {
  id: string;
  user_id: string;
  username: string;
  role: Role;
  permission_type: PermissionType;
}

export interface Workspace {
  id: string;
  name: string;
  owner_user_id: string;
  created_by_user_id?: string;
  owner: { id: string; username: string; email: string };
  is_archived: boolean;
  application_count: number;
  my_access: AccessLevel;
  permissions?: WorkspacePermissionRow[];
  created_at: string;
  updated_at: string;
  resume_profile_id?: string | null;
  profile: ResumeProfile | null;
}

export interface ResumeProfile {
  id: string;
  name: string;
  career_path: string;
  personal_info: {
    fullName: string;
    title: string;
    email: string;
    phone: string;
    location: string;
    linkedin: string;
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
  note: string | null;
  paid: boolean;
  resume_link: string | null;
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

export interface UrlPreviewResult {
  total_lines: number;
  valid: number;
  invalid: string[];
  duplicates: number;
  duplicate_scope: 'global' | 'workspace';
  rows: Array<{
    url: string;
    normalized_url: string;
    job_source: JobSource;
    existing_url: string | null;
    existing_job_title: string | null;
    existing_date: string | null;
    is_duplicate: boolean;
    existing_in: string | null;
  }>;
}

export interface ImportResult {
  total_rows: number;
  created: number;
  duplicates: number;
  skipped: Array<{ row: number; reason: string }>;
  detected_columns: Record<string, number | null>;
}

export interface ImportPreview {
  headers: string[];
  detected_columns: Record<string, number | null>;
  total_rows: number;
  sample: unknown[][];
}
