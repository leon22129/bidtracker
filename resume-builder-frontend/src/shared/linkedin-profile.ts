export function getLinkedInProfile(value: string | null | undefined): { href: string; label: string } | null {
  const input = typeof value === "string" ? value.trim() : ""
  if (!input || /[\s\\]/u.test(input)) return null

  let href: string
  if (/^https?:\/\//i.test(input)) {
    href = input
  } else if (input.startsWith("//")) {
    href = `https:${input}`
  } else if (/^(?:[a-z\d-]+\.)*linkedin\.com(?:[/?#]|$)/i.test(input)) {
    href = `https://${input}`
  } else {
    const profile = input.replace(/^\/+|\/+$/g, "")
    if (/^(?:in|pub)$/i.test(profile)) return null
    if (/^(?:in|pub)\/[^/]+/i.test(profile)) {
      href = `https://www.linkedin.com/${profile}`
    } else if (/^(?:[\p{L}\p{N}_-]|%[a-f\d]{2})+$/iu.test(profile)) {
      href = `https://www.linkedin.com/in/${profile}`
    } else {
      return null
    }
  }

  try {
    const url = new URL(href)
    if (
      !/(^|\.)linkedin\.com$/i.test(url.hostname) ||
      url.username || url.password || url.port
    ) return null

    return { href: url.href, label: "linkedin" }
  } catch {
    return null
  }
}
