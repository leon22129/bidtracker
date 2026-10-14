import { pdf } from "@react-pdf/renderer"
import type React from "react"
import type { CoverLetterData, CoverLetterTemplateId } from "./types"
import { ClassicCoverLetterTemplate } from "./classic"
import { ModernCoverLetterTemplate } from "./modern"
import { MinimalCoverLetterTemplate } from "./minimal"
import { downloadBlob } from "@/lib/chrome-downloads"
import { getProfileDirectoryHandle } from "@/lib/extension-storage"
import { stripTrailingCoverLetterSigner } from "./text"

export { COVER_LETTER_TEMPLATES, DEFAULT_COVER_LETTER_TEMPLATE } from "./types"
export type { CoverLetterTemplateId, CoverLetterTemplateInfo, CoverLetterData } from "./types"

const templateComponents: Record<CoverLetterTemplateId, React.ComponentType<{ data: CoverLetterData }>> = {
  classic: ClassicCoverLetterTemplate,
  modern: ModernCoverLetterTemplate,
  minimal: MinimalCoverLetterTemplate,
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
  const TemplateComponent = templateComponents[templateId]
  const templateData = {
    ...data,
    text: stripTrailingCoverLetterSigner(data.text, data.personalInfo.fullName),
  }
  const blob = await pdf(<TemplateComponent data={templateData} />).toBlob()

  const chromeApi = (globalThis as { chrome?: { downloads?: unknown } }).chrome
  const savedDirectoryHandle = saveInFolder && profileId ? await getProfileDirectoryHandle(profileId) : null
  if (saveInFolder && downloadPath && chromeApi?.downloads && !savedDirectoryHandle) {
    const prefix = [downloadPath, folderName, filename].filter(Boolean).join("/")
    await downloadBlob(blob, prefix)
    return
  }

  if (saveInFolder) {
    try {
      // @ts-ignore
      if ((window as any).showDirectoryPicker) {
        const directoryHandleKey = profileId ? `resumeDirHandle:${profileId}` : "resumeDirHandle"

        async function getSavedDirHandle(): Promise<any | null> {
          if (!("indexedDB" in window)) return null
          return new Promise((resolve) => {
            const req = indexedDB.open("pdf-app-file-handles", 1)
            req.onupgradeneeded = () => { try { req.result.createObjectStore("handles") } catch { } }
            req.onsuccess = () => {
              try {
                const tx = req.result.transaction("handles", "readonly")
                const g = tx.objectStore("handles").get(directoryHandleKey)
                g.onsuccess = () => resolve(g.result ?? null)
                g.onerror = () => resolve(null)
              } catch { resolve(null) }
            }
            req.onerror = () => resolve(null)
          })
        }

        let parentHandle: any = await getSavedDirHandle()

        if (parentHandle) {
          try {
            const perm = await parentHandle.queryPermission?.({ mode: "readwrite" })
            if (perm !== "granted") {
              const req2 = await parentHandle.requestPermission?.({ mode: "readwrite" })
              if (req2 !== "granted") parentHandle = null
            }
          } catch { parentHandle = null }
        }

        if (!parentHandle) return

        const safeFolder = folderName?.trim() || "Resume"
        const dirHandle = await parentHandle.getDirectoryHandle(safeFolder, { create: true })
        const fileHandle = await dirHandle.getFileHandle(filename, { create: true })
        const writable = await fileHandle.createWritable()
        await writable.write(blob)
        await writable.close()

        return
      }
    } catch (err) {
      console.warn("Cover letter folder save failed", err)
      return
    }
  }

  await downloadBlob(blob, filename)
}
