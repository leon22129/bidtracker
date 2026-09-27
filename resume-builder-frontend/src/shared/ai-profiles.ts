import type { ResumeCertification, ResumeEducation, ResumePersonalInfo } from "./resume-profile"

export type AiProfile = {
  id: string
  workspaceId?: string
  name: string
  careerPath: string
  personalInfo: ResumePersonalInfo
  education: ResumeEducation[]
  certifications: ResumeCertification[]
  updateHeadline?: boolean
  useGeneratedRoleTitles?: boolean
  template?: string
  saveInFolder?: boolean
  autoDownload?: boolean
  companyName?: string
  useCompanyName?: boolean
  downloadJDWithPDF?: boolean
  generateCoverLetter?: boolean
  coverLetterTemplate?: string
  baseResume?: string
  createdAt: number
  updatedAt: number
}

export type CreateAiProfileInput = {
  name: string
  careerPath: string
  personalInfo?: ResumePersonalInfo
  education?: ResumeEducation[]
  certifications?: ResumeCertification[]
  updateHeadline?: boolean
  useGeneratedRoleTitles?: boolean
  template?: string
  saveInFolder?: boolean
  autoDownload?: boolean
  companyName?: string
  useCompanyName?: boolean
  downloadJDWithPDF?: boolean
  generateCoverLetter?: boolean
  coverLetterTemplate?: string
  baseResume?: string
}

export type UpdateAiProfileInput = CreateAiProfileInput & {
  id: string
}

export type ApplicationQuestionInput = {
  question: string
  options?: string[]
}

export type GenerateResumeInput = {
  profileId: string
  workspaceId?: string
  url?: string
  prompt?: string
  jobDescription?: string
  questions?: ApplicationQuestionInput[]
  resume?: unknown
  conversationId?: string
  kind?: "resume" | "applicationAnswers" | "jobEligibility"
}

export type GenerateResumeResult = {
  tailored_resume?: string
  full_name?: string
  conversationId?: string
  answers?: Array<{ question: string; answer: string }>
  eligible?: boolean
  reason?: string
  banned?: boolean
  duplicate?: boolean
  duplicateType?: string | null
  application?: GeneratedApplication
  existingApplication?: {
    id: string
    url: string
    job_title: string | null
    company_name: string | null
    workspace_name: string
    date: string
    number: number
  }
}

export type GeneratedApplication = {
  id?: string
  number?: number
  url: string
  job_title: string
  company_name: string
}

export type AiProfilesApi = {
  list: () => Promise<AiProfile[]>
  create: (input: CreateAiProfileInput) => Promise<AiProfile>
  update: (input: UpdateAiProfileInput) => Promise<AiProfile>
  delete: (profileId: string) => Promise<void>
  generate: (input: GenerateResumeInput) => Promise<GenerateResumeResult>
}
