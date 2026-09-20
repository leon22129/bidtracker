import type { PersonalInfo } from "../parse-resume"

export type CoverLetterTemplateId = "classic" | "modern" | "minimal"

export interface CoverLetterTemplateInfo {
  id: CoverLetterTemplateId
  name: string
  description: string
}

export const COVER_LETTER_TEMPLATES: CoverLetterTemplateInfo[] = [
  {
    id: "classic",
    name: "Classic",
    description: "Serif font, traditional professional layout",
  },
  {
    id: "modern",
    name: "Modern",
    description: "Clean sans-serif with a subtle accent line",
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Plain and simple — maximum focus on content",
  },
]

export const DEFAULT_COVER_LETTER_TEMPLATE: CoverLetterTemplateId = "classic"

export type CoverLetterData = {
  text: string
  personalInfo: PersonalInfo
  companyName: string
}
