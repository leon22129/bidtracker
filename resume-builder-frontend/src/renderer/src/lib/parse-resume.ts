import {
  DEFAULT_RESUME_EDUCATION,
  DEFAULT_RESUME_CERTIFICATIONS,
  DEFAULT_RESUME_PERSONAL_INFO,
  type ResumeEducation,
  type ResumeCertification,
  type ResumePersonalInfo,
} from "../../../shared/resume-profile"

export type Education = ResumeEducation
export type Certification = ResumeCertification

export type PersonalInfo = ResumePersonalInfo

export interface SkillCategory {
  category: string
  items: string[]
}

export function normalizeSkills(input: unknown): SkillCategory[] {
  if (!Array.isArray(input) || input.length === 0) return []

  if (typeof input[0] === "string") {
    return [
      {
        category: "Technical Skills",
        items: input.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()),
      },
    ]
  }

  return input
    .filter((entry): entry is { category?: unknown; items?: unknown } => !!entry && typeof entry === "object")
    .map((entry) => ({
      category: typeof entry.category === "string" && entry.category.trim() ? entry.category.trim() : "Technical Skills",
      items: Array.isArray(entry.items)
        ? entry.items.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
        : [],
    }))
    .filter((entry) => entry.category || entry.items.length > 0)
}

export function flattenSkills(categories: SkillCategory[]): string[] {
  return categories.flatMap((group) => group.items)
}

export interface ResumeData {
  personalInfo: PersonalInfo
  education: Education[]
  certifications: Certification[]
  summary: string
  skills: SkillCategory[]
  workexperience: {
    role: string
    original_role?: string
    companyname: string
    duration: string
    experience: string[]
  }[]
  annualSalary?: string
  hourlyRate?: string
  rateInJd?: boolean
}

export const DEFAULT_PERSONAL_INFO: PersonalInfo = DEFAULT_RESUME_PERSONAL_INFO

export const DEFAULT_EDUCATION: Education[] = DEFAULT_RESUME_EDUCATION
export const DEFAULT_CERTIFICATIONS: Certification[] = DEFAULT_RESUME_CERTIFICATIONS
