import { downloadBlob } from "./chrome-downloads"
import { getProfileDirectoryHandle } from "./extension-storage"
import { withTimeout } from "../../../shared/with-timeout"

const folderTimeout = "The selected download folder is not responding. Choose it again in extension Settings, or use the Downloads folder."
const saveTimeout = "Saving the file took too long. Check the selected folder before trying again."

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
      if (parent.queryPermission && await withTimeout(parent.queryPermission(options), 30_000, folderTimeout) !== "granted") {
        if (!parent.requestPermission || await withTimeout(parent.requestPermission(options), 60_000,
          "Permission to save in this folder was not confirmed. Please try again and allow folder access.") !== "granted") {
          throw new Error("Folder permission was not granted.")
        }
      }
      const directory = await withTimeout(parent.getDirectoryHandle(folderName?.trim() || "Resume", { create: true }), 30_000, folderTimeout)
      return async (blob, filename) => {
        try {
          const file = await withTimeout(directory.getFileHandle(filename, { create: true }), 30_000, saveTimeout)
          const writable = await withTimeout(file.createWritable(), 30_000, saveTimeout, {
            onLateResult: (lateWriter) => lateWriter.abort(),
          })
          try {
            await withTimeout(writable.write(blob), 30_000, saveTimeout)
            await withTimeout(writable.close(), 30_000, saveTimeout)
          } catch (error) {
            // A disconnected drive may also hang abort(); do not keep the UI waiting for cleanup.
            void writable.abort().catch(() => {})
            throw error
          }
        } catch (cause) {
          if (cause instanceof Error && cause.name === "TimeoutError") throw cause
          throw new Error(`Could not save ${filename}. Check the selected folder in extension Settings under Profile download locations.`, { cause })
        }
      }
    } catch (cause) {
      if (cause instanceof Error && cause.name === "TimeoutError") throw cause
      throw new Error("Could not access the selected folder. Choose it again in extension Settings under Profile download locations.", { cause })
    }
  }

  const chromeApi = (globalThis as { chrome?: { downloads?: unknown } }).chrome
  if (!chromeApi?.downloads) {
    throw new Error("Choose a download folder in extension Settings under Profile download locations before downloading as a directory.")
  }
  const prefix = [downloadPath || "Resumes", folderName].filter(Boolean).join("/")
  return (blob, filename) => downloadBlob(blob, `${prefix}/${filename}`)
}
