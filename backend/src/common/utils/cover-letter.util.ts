function normalizedSigner(value: string): string {
  return value
    .trim()
    .replace(/^\[|\]$/g, '')
    .replace(/[,.]+$/g, '')
    .trim()
    .toLowerCase();
}

export function stripTrailingCoverLetterSigner(text: string, fullName?: string | null): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

  const signer = normalizedSigner(lines[lines.length - 1] || '');
  const removableSigners = new Set([
    'candidate',
    'candidate name',
    'your name',
    ...(fullName?.trim() ? [normalizedSigner(fullName)] : []),
  ]);

  if (removableSigners.has(signer)) {
    lines.pop();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  }

  return lines.join('\n').trim();
}
