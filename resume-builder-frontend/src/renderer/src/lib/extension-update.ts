export interface ExtensionUpdate {
  message: string
  latestVersion: string | null
  downloadUrl: string | null
}

export function parseExtensionUpdate(data: unknown): ExtensionUpdate {
  const body = data && typeof data === "object" ? data as Record<string, unknown> : {}
  let downloadUrl: string | null = null
  if (typeof body.download_url === "string") {
    try {
      const url = new URL(body.download_url)
      if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) downloadUrl = url.href
    } catch { /* Older servers may not provide a download link. */ }
  }
  const version = body.latest_version ?? body.minimum_version
  return {
    message: typeof body.message === "string" && body.message.trim()
      ? body.message
      : "A new version of Resume Builder is available. Download the latest version, then reload the extension in Chrome.",
    latestVersion: typeof version === "string" ? version : null,
    downloadUrl,
  }
}
