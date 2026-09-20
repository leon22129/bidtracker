export type ResumePersonalInfo = {
  fullName: string
  title: string
  phone: string
  email: string
  location: string
  linkedin: string
}

export type ResumeEducation = {
  degree: string
  school: string
  year: string
}

export type ResumeCertification = {
  name: string
  issuer: string
  year: string
}

export const DEFAULT_RESUME_PERSONAL_INFO: ResumePersonalInfo = {
  fullName: "",
  title: "",
  phone: "",
  email: "",
  location: "",
  linkedin: "",
}

export const DEFAULT_RESUME_EDUCATION: ResumeEducation[] = [
  {
    degree: "",
    school: "",
    year: "",
  },
]

export const DEFAULT_RESUME_CERTIFICATIONS: ResumeCertification[] = []

function readStringField(source: Record<string, unknown>, key: string): string {
  const value = source[key]
  return typeof value === "string" ? value : ""
}

export function normalizeResumePersonalInfo(value: unknown): ResumePersonalInfo {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {}

  return {
    fullName: readStringField(source, "fullName"),
    title: readStringField(source, "title"),
    phone: readStringField(source, "phone"),
    email: readStringField(source, "email"),
    location: readStringField(source, "location"),
    linkedin: readStringField(source, "linkedin"),
  }
}

function normalizeResumeEducationItem(value: unknown): ResumeEducation {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {}

  return {
    degree: readStringField(source, "degree"),
    school: readStringField(source, "school"),
    year: readStringField(source, "year"),
  }
}

function normalizeResumeCertificationItem(value: unknown): ResumeCertification {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {}

  return {
    name: readStringField(source, "name"),
    issuer: readStringField(source, "issuer"),
    year: readStringField(source, "year"),
  }
}

export function normalizeResumeEducation(value: unknown): ResumeEducation[] {
  const items = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? [value]
      : []

  const normalized = items
    .map(normalizeResumeEducationItem)
    .filter((item) => item.degree || item.school || item.year)

  return normalized.length
    ? normalized
    : DEFAULT_RESUME_EDUCATION.map((item) => ({ ...item }))
}

export function normalizeResumeCertifications(value: unknown): ResumeCertification[] {
  if (!Array.isArray(value)) return []

  return value
    .map(normalizeResumeCertificationItem)
    .filter((item) => item.name || item.issuer || item.year)
}
