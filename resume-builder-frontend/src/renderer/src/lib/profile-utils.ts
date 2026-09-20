import {
  DEFAULT_PERSONAL_INFO,
  DEFAULT_EDUCATION,
  type PersonalInfo,
  type Education,
} from "@/lib/parse-resume"
import {
  normalizeResumeEducation,
  normalizeResumePersonalInfo,
} from "../../../shared/resume-profile"
import type { AiProfile } from "../../../shared/ai-profiles"
import type { ResumeData, SkillCategory } from "@/lib/parse-resume"

export const LEGACY_STORAGE_KEY_PERSONAL = "resume_personal_info"
export const LEGACY_STORAGE_KEY_EDUCATION = "resume_education"
export const LEGACY_STORAGE_KEY_CAREER_MILESTONES = "resume_career_milestones"
export const STORAGE_KEY_ACTIVE_TAB = "resume_active_tab_id"

export function getLinkedInProfile(value: string): { href: string; label: string } | null {
  const input = value.trim()
  if (!input) return null

  const href = /^https?:\/\//i.test(input)
    ? input
    : /^www\.linkedin\.com\//i.test(input) || /^linkedin\.com\//i.test(input)
      ? `https://${input}`
      : `https://www.linkedin.com/in/${input.replace(/^\/+|\/+$/g, "")}`

  try {
    const url = new URL(href)
    const profileMatch = url.pathname.match(/\/in\/([^/]+)/i)
    return { href, label: profileMatch?.[1] ?? input }
  } catch {
    return { href, label: input }
  }
}

export type ProfileFormMode = "create" | "edit"

export function getFriendlyErrorMessage(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : fallback
  const cleaned = message.replace(/^Error invoking remote method '[^']+':\s*/, "")
  return cleaned || fallback
}

export function parseGeneratedResume(content: string) {
  const trimmed = content?.trim() ?? ""
  if (!trimmed) throw new Error("The AI provider did not return JSON resume content.")

  const braceStart = trimmed.indexOf("{")
  const braceEnd = trimmed.lastIndexOf("}")

  if (braceStart !== -1 && braceEnd !== -1 && braceEnd > braceStart) {
    const cleaned = trimmed.slice(braceStart, braceEnd + 1)
    try {
      return JSON.parse(cleaned) as {
        target_company?: string
        main_title?: string
        annual_salary?: string
        hourly_rate?: string
        rate_in_jd?: boolean
        summary?: string
        skills?: SkillCategory[] | string[]
        workexperience?: ResumeData["workexperience"]
        coverletter?: string
        error?: string
      }
    } catch {
      // fall through to plain-text fallback below
    }
  }

  const normalized = trimmed.toLowerCase()
  if (normalized.includes("this job requires clearance")) {
    return { error: "this job requires clearance" }
  }
  if (normalized.includes("this job is onsite")) {
    return { error: "this job is onsite" }
  }

  throw new Error("The AI provider did not return JSON resume content.")
}

export type JobEligibility = {
  requires_clearance: boolean
  requires_public_trust: boolean
  is_us_job: boolean
  work_arrangement_is_remote_only: boolean
  requires_in_person_interview: boolean
  requires_onsite_onboarding: boolean
  reason: string
}

export function parseJobEligibility(content: string): JobEligibility {
  const trimmed = content?.trim() ?? ""
  const braceStart = trimmed.indexOf("{")
  const braceEnd = trimmed.lastIndexOf("}")

  if (braceStart === -1 || braceEnd <= braceStart) {
    throw new Error("The AI provider returned an invalid job eligibility response.")
  }

  try {
    const parsed = JSON.parse(trimmed.slice(braceStart, braceEnd + 1)) as Partial<JobEligibility>
    if (
      typeof parsed.requires_clearance !== "boolean" ||
      typeof parsed.requires_public_trust !== "boolean" ||
      typeof parsed.is_us_job !== "boolean" ||
      typeof parsed.work_arrangement_is_remote_only !== "boolean" ||
      typeof parsed.requires_in_person_interview !== "boolean" ||
      typeof parsed.requires_onsite_onboarding !== "boolean"
    ) {
      throw new Error("The AI provider returned an incomplete job eligibility response.")
    }
    return {
      requires_clearance: parsed.requires_clearance,
      requires_public_trust: parsed.requires_public_trust,
      is_us_job: parsed.is_us_job,
      work_arrangement_is_remote_only: parsed.work_arrangement_is_remote_only,
      requires_in_person_interview: parsed.requires_in_person_interview,
      requires_onsite_onboarding: parsed.requires_onsite_onboarding,
      reason: typeof parsed.reason === "string" ? parsed.reason.trim() : "",
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("The AI provider")) throw error
    throw new Error("The AI provider returned an invalid job eligibility response.")
  }
}

export function cloneDefaultPersonalInfo(): PersonalInfo {
  return { ...DEFAULT_PERSONAL_INFO }
}

export function cloneDefaultEducation(): Education[] {
  return DEFAULT_EDUCATION.map((item) => ({ ...item }))
}

function hasPersonalInfoContent(value: PersonalInfo): boolean {
  return Object.values(value).some((v) => v.trim())
}

function hasEducationContent(value: Education[]): boolean {
  return value.some((item) => item.degree.trim() || item.school.trim() || item.year.trim())
}

function readLegacyPersonalInfo(): PersonalInfo | null {
  const raw = localStorage.getItem(LEGACY_STORAGE_KEY_PERSONAL)
  if (!raw) return null
  try { return normalizeResumePersonalInfo(JSON.parse(raw)) } catch { return null }
}

function readLegacyEducation(): Education[] | null {
  const raw = localStorage.getItem(LEGACY_STORAGE_KEY_EDUCATION)
  if (!raw) return null
  try { return normalizeResumeEducation(JSON.parse(raw)) } catch { return null }
}

export function getResumeDetailsForProfile(
  profile: AiProfile,
  legacyProfileId: string | null,
): { personalInfo: PersonalInfo; education: Education[] } {
  const personalInfo = normalizeResumePersonalInfo(profile.personalInfo)
  const education = normalizeResumeEducation(profile.education)

  if (
    legacyProfileId !== profile.id ||
    hasPersonalInfoContent(personalInfo) ||
    hasEducationContent(education)
  ) {
    return { personalInfo, education }
  }

  return {
    personalInfo: readLegacyPersonalInfo() || personalInfo,
    education: readLegacyEducation() || education,
  }
}

export function clearLegacyResumeSettings() {
  localStorage.removeItem(LEGACY_STORAGE_KEY_PERSONAL)
  localStorage.removeItem(LEGACY_STORAGE_KEY_EDUCATION)
}
