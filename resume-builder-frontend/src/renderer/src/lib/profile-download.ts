import { downloadBlob } from "./chrome-downloads"
import { getProfileDirectoryHandle } from "./extension-storage"

type WritableDirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission?: (options: { mode: "readwrite" }) => Promise<PermissionState>
  requestPermission?: (options: { mode: "readwrite" }) => Promise<PermissionState>
}

// Resolve the destination before rendering a PDF, while the download click can
// still grant folder permission. Both documents use the same destination rules.
export async function createProfileDownload(
  inFolder: boolean,
  folderName?: string,
  profileId?: string,
  downloadPath?: string,
): Promise<(blob: Blob, filename: string) => Promise<void>> {
  if (!inFolder) return downloadBlob

  const parent = profileId ? await getProfileDirectoryHandle(profileId) as WritableDirectoryHandle | null : null
  if (parent) {
    try {
      const options = { mode: "readwrite" } as const
      if (parent.queryPermission && await parent.queryPermission(options) !== "granted") {
        if (await parent.requestPermission?.(options) !== "granted") {
          throw new Error("Folder permission was not granted.")
        }
      }
      const directory = await parent.getDirectoryHandle(folderName?.trim() || "Resume", { create: true })
      return async (blob, filename) => {
        try {
          const file = await directory.getFileHandle(filename, { create: true })
          const writable = await file.createWritable()
          try {
            await writable.write(blob)
            await writable.close()
          } catch (error) {
            await writable.abort().catch(() => {})
            throw error
          }
        } catch (cause) {
          throw new Error(`Could not save ${filename}. Check the selected folder in profile settings.`, { cause })
        }
      }
    } catch (cause) {
      throw new Error("Could not access the selected folder. Choose it again in profile settings.", { cause })
    }
  }

  const chromeApi = (globalThis as { chrome?: { downloads?: unknown } }).chrome
  if (!chromeApi?.downloads) {
    throw new Error("Choose a download folder in profile settings before downloading as a directory.")
  }
  const prefix = [downloadPath || "Resumes", folderName].filter(Boolean).join("/")
  return (blob, filename) => downloadBlob(blob, `${prefix}/${filename}`)
}
