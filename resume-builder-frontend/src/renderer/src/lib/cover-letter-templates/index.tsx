import { pdf } from "@react-pdf/renderer"
import type React from "react"
import type { CoverLetterData, CoverLetterTemplateId } from "./types"
import { ClassicCoverLetterTemplate } from "./classic"
import { ModernCoverLetterTemplate } from "./modern"
import { MinimalCoverLetterTemplate } from "./minimal"
import { createProfileDownload } from "@/lib/profile-download"
import { stripTrailingCoverLetterSigner } from "./text"

export { COVER_LETTER_TEMPLATES, DEFAULT_COVER_LETTER_TEMPLATE } from "./types"
export type { CoverLetterTemplateId, CoverLetterTemplateInfo, CoverLetterData } from "./types"

const templateComponents: Record<CoverLetterTemplateId, React.ComponentType<{ data: CoverLetterData }>> = {
  classic: ClassicCoverLetterTemplate, modern: ModernCoverLetterTemplate, minimal: MinimalCoverLetterTemplate,
}

export async function generateCoverLetterPDF(
  data: CoverLetterData,
  filename: string,
  saveInFolder: boolean,
  templateId: CoverLetterTemplateId = "classic",
  folderName?: string,
  profileId?: string,
  downloadPath?: string,
): Promise<void> {
  const save = await createProfileDownload(saveInFolder, folderName, profileId, downloadPath)
  const TemplateComponent = templateComponents[templateId] || ClassicCoverLetterTemplate
  const templateData = { ...data, text: stripTrailingCoverLetterSigner(data.text, data.personalInfo.fullName) }
  const blob = await pdf(<TemplateComponent data={templateData} />).toBlob()
  await save(blob, filename)
}
