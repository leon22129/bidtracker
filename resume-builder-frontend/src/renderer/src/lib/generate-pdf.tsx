// Keep the PDF renderer and template styles out of the initial application bundle.
export async function generateResumePDF(...args: Parameters<typeof import("./pdf-templates").generateResumePDF>) {
  const renderer = await import("./pdf-templates")
  return renderer.generateResumePDF(...args)
}

export async function generateCoverLetterPDF(...args: Parameters<typeof import("./cover-letter-templates").generateCoverLetterPDF>) {
  const renderer = await import("./cover-letter-templates")
  return renderer.generateCoverLetterPDF(...args)
}
