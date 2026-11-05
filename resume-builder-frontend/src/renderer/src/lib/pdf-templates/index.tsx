import { pdf } from "@react-pdf/renderer"
import type React from "react"
import type { ResumeData } from "../parse-resume"
import type { TemplateId } from "./types"
import { ClassicTemplate } from "./classic"
import { ModernTemplate } from "./modern"
import { MinimalTemplate } from "./minimal"
import { ExecutiveTemplate } from "./executive"
import { AcademicTemplate } from "./academic"
import { TechTemplate } from "./tech"
import { ElegantTemplate } from "./elegant"
import { BoldTemplate } from "./bold"
import { CorporateTemplate } from "./corporate"
import { createProfileDownload } from "@/lib/profile-download"

export { TEMPLATES, DEFAULT_TEMPLATE } from "./types"
export type { TemplateId, TemplateInfo } from "./types"

const templateComponents: Record<TemplateId, React.ComponentType<{ data: ResumeData }>> = {
  classic: ClassicTemplate, modern: ModernTemplate, minimal: MinimalTemplate,
  executive: ExecutiveTemplate, academic: AcademicTemplate, tech: TechTemplate,
  elegant: ElegantTemplate, bold: BoldTemplate, corporate: CorporateTemplate,
}

export async function generateResumePDF(
  data: ResumeData,
  filename: string,
  isDirectory: boolean,
  templateId: TemplateId = "classic",
  folderName?: string,
  jdContent?: string,
  profileId?: string,
  downloadPath?: string,
): Promise<{ folderPath?: string }> {
  const save = await createProfileDownload(isDirectory, folderName, profileId, downloadPath)
  const TemplateComponent = templateComponents[templateId] || ClassicTemplate
  const blob = await pdf(<TemplateComponent data={data} />).toBlob()
  await save(blob, filename)
  if (isDirectory && jdContent?.trim()) {
    await save(new Blob([jdContent], { type: "text/plain;charset=utf-8" }), "job-description.txt")
  }
  return {}
}
