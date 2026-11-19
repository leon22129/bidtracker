import { pdf } from "@react-pdf/renderer"
import { withTimeout } from "../../../shared/with-timeout"

const PDF_TIMEOUT_MS = 60_000
type PdfStream = NodeJS.ReadableStream & { destroy?: () => void }

export function renderPdfBlob(document: Parameters<typeof pdf>[0]): Promise<Blob> {
  let stream: PdfStream | undefined
  let expired = false
  const message = "Preparing the PDF took too long. Your generated resume is still available. Please try downloading again."
  const render = async () => {
    // toBlob() listens for data/end but not error/close, leaving failed streams pending.
    stream = await pdf(document).toBuffer()
    if (expired) {
      stream.destroy?.()
      throw new Error(message)
    }
    const source = stream
    return new Promise<Blob>((resolve, reject) => {
      const chunks: Uint8Array[] = []
      const cleanup = () => {
        source.removeListener("data", onData)
        source.removeListener("end", onEnd)
        source.removeListener("error", onError)
        source.removeListener("close", onClose)
      }
      const onData = (chunk: Uint8Array) => chunks.push(new Uint8Array(chunk))
      const onError = (error: unknown) => {
        cleanup()
        reject(new Error("Could not prepare the PDF. Your generated resume is still available. Please try downloading again.", { cause: error }))
        source.destroy?.()
      }
      const onClose = () => onError(new Error("PDF stream closed before completion"))
      const onEnd = () => {
        cleanup()
        if (!chunks.length) { reject(new Error("The PDF was empty. Please try downloading again.")); return }
        try { resolve(new Blob(chunks, { type: "application/pdf" })) } catch (error) { reject(error) }
      }
      source.on("error", onError)
      source.on("close", onClose)
      source.on("end", onEnd)
      source.on("data", onData)
    })
  }
  return withTimeout(render(), PDF_TIMEOUT_MS, message, {
    onTimeout: () => { expired = true; stream?.destroy?.() },
  })
}
