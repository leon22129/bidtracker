export function getLinkedInProfile(value: string): { href: string; label: string } | null {
  const input = value.trim();
  if (!input) return null;

  const href = /^https?:\/\//i.test(input)
    ? input
    : /^www\.linkedin\.com\//i.test(input) || /^linkedin\.com\//i.test(input)
      ? `https://${input}`
      : `https://www.linkedin.com/in/${input.replace(/^\/+|\/+$/g, '')}`;

  try {
    const url = new URL(href);
    const profileMatch = url.pathname.match(/\/in\/([^/]+)/i);
    return { href, label: profileMatch?.[1] ?? input };
  } catch {
    return { href, label: input };
  }
}
