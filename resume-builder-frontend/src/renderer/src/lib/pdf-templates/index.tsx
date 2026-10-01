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
import { downloadBlob, downloadText } from "@/lib/chrome-downloads"
import { getProfileDirectoryHandle } from "@/lib/extension-storage"

export { TEMPLATES, DEFAULT_TEMPLATE } from "./types"
export type { TemplateId, TemplateInfo } from "./types"

const templateComponents: Record<TemplateId, React.ComponentType<{ data: ResumeData }>> = {
  classic: ClassicTemplate,
  modern: ModernTemplate,
  minimal: MinimalTemplate,
  executive: ExecutiveTemplate,
  academic: AcademicTemplate,
  tech: TechTemplate,
  elegant: ElegantTemplate,
  bold: BoldTemplate,
  corporate: CorporateTemplate,
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
  const TemplateComponent = templateComponents[templateId]
  const blob = await pdf(<TemplateComponent data={data} />).toBlob()

  const chromeApi = (globalThis as { chrome?: { downloads?: unknown } }).chrome
  const savedDirectoryHandle = isDirectory && profileId ? await getProfileDirectoryHandle(profileId) : null
  if (isDirectory && downloadPath && chromeApi?.downloads && !savedDirectoryHandle) {
    const prefix = [downloadPath, folderName, filename].filter(Boolean).join("/")
    await downloadBlob(blob, prefix)
    if (jdContent?.trim()) {
      const jdPrefix = [downloadPath, folderName, "job-description.txt"].filter(Boolean).join("/")
      await downloadText(jdContent, jdPrefix)
    }
    return {}
  }

  // Try File System Access API first (allows creating directories)
  // If unavailable, fall back to standard download link
  if (isDirectory) {
    try {
      // @ts-ignore - these APIs may not exist in all browsers
      if ((window as any).showDirectoryPicker) {
        // Helpers for persisting directory handle in IndexedDB
        const directoryHandleKey = profileId ? `resumeDirHandle:${profileId}` : 'resumeDirHandle'

        async function getSavedDirHandle(): Promise<any | null> {
          if (!('indexedDB' in window)) return null
          return new Promise((resolve) => {
            const req = indexedDB.open('pdf-app-file-handles', 1)
            req.onupgradeneeded = () => {
              try {
                req.result.createObjectStore('handles')
              } catch (e) {
                // ignore
              }
            }
            req.onsuccess = () => {
              try {
                const db = req.result
                const tx = db.transaction('handles', 'readonly')
                const store = tx.objectStore('handles')
                const g = store.get(directoryHandleKey)
                g.onsuccess = () => resolve(g.result ?? null)
                g.onerror = () => resolve(null)
              } catch (e) {
                resolve(null)
              }
            }
            req.onerror = () => resolve(null)
          })
        }

        async function saveDirHandle(handle: any): Promise<void> {
          if (!('indexedDB' in window)) return
          return new Promise((resolve) => {
            const req = indexedDB.open('pdf-app-file-handles', 1)
            req.onupgradeneeded = () => {
              try {
                req.result.createObjectStore('handles')
              } catch (e) {
                // ignore
              }
            }
            req.onsuccess = () => {
              try {
                const db = req.result
                const tx = db.transaction('handles', 'readwrite')
                const store = tx.objectStore('handles')
                store.put(handle, directoryHandleKey)
                tx.oncomplete = () => resolve()
                tx.onerror = () => resolve()
              } catch (e) {
                resolve()
              }
            }
            req.onerror = () => resolve()
          })
        }

        async function clearSavedDirHandle(): Promise<void> {
          if (!('indexedDB' in window)) return
          return new Promise((resolve) => {
            const req = indexedDB.open('pdf-app-file-handles', 1)
            req.onsuccess = () => {
              try {
                const db = req.result
                const tx = db.transaction('handles', 'readwrite')
                const store = tx.objectStore('handles')
                store.delete(directoryHandleKey)
                tx.oncomplete = () => resolve()
                tx.onerror = () => resolve()
              } catch (e) {
                resolve()
              }
            }
            req.onerror = () => resolve()
          })
        }

        // eslint-disable-next-line no-undef
        let parentHandle: any = null

        try {
          parentHandle = await getSavedDirHandle()

          if (parentHandle) {
            // Check permission for the saved handle
            try {
              const perm = await parentHandle.queryPermission?.({ mode: 'readwrite' })
              if (perm === 'granted') {
                // okay to use
              } else if (perm === 'prompt') {
                const req = await parentHandle.requestPermission?.({ mode: 'readwrite' })
                if (req !== 'granted') {
                  parentHandle = null
                }
              } else {
                // denied
                parentHandle = null
              }
            } catch (e) {
              // If permission check fails, clear saved handle and prompt
              await clearSavedDirHandle()
              parentHandle = null
            }
          }

          if (!parentHandle) {
            // Prompt user to pick a parent folder and persist it
            parentHandle = await (window as any).showDirectoryPicker()
            await saveDirHandle(parentHandle)
          }

          // Sanitize folder name and use fallback if none provided
          const safeFolder = folderName && String(folderName).trim().length > 0 ? String(folderName) : 'Resume'

          // Create (or get) the dated/company folder
          const dirHandle = await parentHandle.getDirectoryHandle(safeFolder, { create: true })

          // Create (or get) the file handle
          const fileHandle = await dirHandle.getFileHandle(filename, { create: true })
          const writable = await fileHandle.createWritable()
          await writable.write(blob)
          await writable.close()

          // If job description content provided, write it to the same folder
          if (jdContent && String(jdContent).trim().length > 0) {
            try {
              const jdName = 'job-description.txt'
              const jdHandle = await dirHandle.getFileHandle(jdName, { create: true })
              const jdWritable = await jdHandle.createWritable()
              const jdBlob = new Blob([jdContent], { type: 'text/plain;charset=utf-8' })
              await jdWritable.write(jdBlob)
              await jdWritable.close()
            } catch (e) {
              throw new Error("Could not save the job description in the selected folder.", { cause: e })
            }
          }

          return {}
        } catch (e) {
          try {
            await clearSavedDirHandle()
          } catch (err) {
            // ignore
          }

          throw new Error(
            'Could not access the selected folder. Choose the download location again in Settings.',
            { cause: e },
          )
        }
      }
    } catch (err) {
      // If something goes wrong with FS API, we'll fallback to download below
      // eslint-disable-next-line no-console
      console.warn('File System Access API failed, falling back to download', err)
      return {}
    }
  } else {
    await downloadBlob(blob, filename)
  }

  return {}
}
