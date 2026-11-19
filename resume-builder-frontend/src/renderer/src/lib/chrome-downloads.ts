import { withTimeout } from "../../../shared/with-timeout"

export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const chromeApi = (globalThis as {
    chrome?: {
      downloads?: {
        download: (options: { url: string; filename: string; saveAs?: boolean }, callback?: (downloadId: number) => void) => Promise<number> | void
        cancel?: (downloadId: number) => Promise<void> | void
      }
      runtime?: { lastError?: { message?: string } }
    }
  }).chrome
  const objectUrl = URL.createObjectURL(blob)
  try {
    if (chromeApi?.downloads) {
      try {
        const reader = new FileReader()
        const dataUrl = await withTimeout(new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(reader.error)
          reader.onabort = () => reject(new Error("Preparing the download was interrupted. Please try again."))
          reader.readAsDataURL(blob)
        }), 30_000, "Preparing the download took too long. Please try again.", { onTimeout: () => reader.abort() })
        await withTimeout(new Promise<number>((resolve, reject) => {
          let settled = false
          const finish = (error?: Error, downloadId?: number) => {
            if (settled) return
            settled = true
            error ? reject(error) : resolve(downloadId!)
          }
          const result = chromeApi.downloads!.download(
            { url: dataUrl, filename, saveAs: false },
            (downloadId) => {
              const runtimeError = chromeApi.runtime?.lastError
              if (runtimeError) {
                finish(new Error(runtimeError.message || "Chrome could not start the download."))
                return
              }
              if (typeof downloadId !== "number" || downloadId < 0) {
                finish(new Error("Chrome could not start the download."))
                return
              }
              finish(undefined, downloadId)
            },
          )
          if (result && typeof result.then === "function") {
            result.then((downloadId) => {
              if (typeof downloadId !== "number" || downloadId < 0) {
                finish(new Error("Chrome could not start the download."))
                return
              }
              finish(undefined, downloadId)
            }).catch((error: unknown) => finish(error instanceof Error ? error : new Error(String(error))))
          }
        }), 30_000, "Chrome did not respond to the download request. Check Chrome Downloads before trying again.", {
          onLateResult: (downloadId) => chromeApi.downloads?.cancel?.(downloadId),
        })
        return
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") throw error
        throw new Error("Chrome could not start the download. Check its download permissions and the selected folder.", { cause: error })
      }
    }
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}

export async function downloadText(content: string, filename: string): Promise<void> {
  await downloadBlob(new Blob([content], { type: "text/plain;charset=utf-8" }), filename)
}
