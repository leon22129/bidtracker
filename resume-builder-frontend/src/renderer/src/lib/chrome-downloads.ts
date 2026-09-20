export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const chromeApi = (globalThis as {
    chrome?: {
      downloads?: { download: (options: { url: string; filename: string; saveAs?: boolean }, callback?: (downloadId: number) => void) => Promise<number> | void }
      runtime?: { lastError?: { message?: string } }
    }
  }).chrome
  const objectUrl = URL.createObjectURL(blob)
  try {
    if (chromeApi?.downloads) {
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(blob)
        })
        await new Promise<void>((resolve, reject) => {
          let settled = false
          const finish = (error?: Error) => {
            if (settled) return
            settled = true
            error ? reject(error) : resolve()
          }
          const result = chromeApi.downloads!.download(
            { url: dataUrl, filename, saveAs: false },
            (downloadId) => {
              const runtimeError = chromeApi.runtime?.lastError
              if (runtimeError) {
                finish(new Error(runtimeError.message || "Chrome could not start the download."))
                return
              }
              if (downloadId < 0) {
                finish(new Error("Chrome could not start the download."))
                return
              }
              finish()
            },
          )
          if (result && typeof result.then === "function") {
            result.then((downloadId) => {
              if (downloadId < 0) {
                finish(new Error("Chrome could not start the download."))
                return
              }
              finish()
            }).catch((error: unknown) => finish(error instanceof Error ? error : new Error(String(error))))
          }
        })
        return
      } catch (error) {
        console.warn("Chrome Downloads API failed; using browser download fallback.", error)
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