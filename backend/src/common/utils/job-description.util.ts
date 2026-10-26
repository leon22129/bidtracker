const SECTION_NAMES = [
  'Job Information', 'Job Description', 'Key Responsibilities', 'Core Responsibilities',
  'Responsibilities', 'Essential Skills', 'Minimum Qualifications', 'Required Qualifications',
  'Preferred Qualifications', 'Qualifications', 'Requirements', 'Required Skills', 'Preferred Skills',
  'About the Company', 'About the Role', 'About the role', 'About Us', 'Who We Are', 'Who we are',
  'Our Culture', 'Our culture', 'What You Will Do', 'What you will do', 'What You’ll Do', "What You'll Do",
  'What We Offer', 'What we offer', 'What You Bring', 'What you bring', 'Your Impact',
  'Compensation and Benefits', 'Compensation & Benefits', 'Compensation', 'Benefits', 'Overview',
  'Equal Opportunity', 'Equal Employment Opportunity', 'Additional Information', 'How to Apply',
];
const SECTION_PATTERN = new RegExp(`(${SECTION_NAMES.slice().sort((a, b) => b.length - a.length)
  .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}):?(?=[ \t]+[A-Z0-9]|[A-Z]|\\n|$)`, 'g');
const SECTION_KEYS = new Set(SECTION_NAMES.map((name) => name.toLowerCase()));
const METADATA_LINE = /^(?:Title|Company|Location|Workplace|Department|Employment Type|Salary|Annual|Hourly|Source|URL):\s/i;
const SENTENCES = new Intl.Segmenter('en', { granularity: 'sentence' });

/** Deterministic plain-text layout: retain the JD's wording, amounts, and original section order. */
export function formatJobDescription(value: string): string {
  let text = value.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ')
    .replace(/[ \t]+$/gm, '').replace(/^[ \t]+$/gm, '').trim();
  if (!text) return '';
  text = text.replace(/[ \t]*[•▪◦●‣][ \t]*/g, '\n- ');

  // Repair common headings in older descriptions whose HTML block boundaries were lost.
  for (let pass = 0; pass < 2; pass++) {
    text = text.split('\n').map((line) => METADATA_LINE.test(line) ? line : line.replace(
      SECTION_PATTERN, (heading: string, name: string, offset: number) => {
        if (line.trim() === heading.trim()) return heading;
        const before = line.slice(0, offset).trimEnd();
        const gluedHeading = name.includes(' ') && offset > 0
          && /[A-Z]/.test(line[offset + heading.length] ?? '');
        return !before || /[.!?:]$/.test(before) || heading.endsWith(':') || gluedHeading
          ? `\n\n${heading}\n\n` : heading;
      },
    )).join('\n');
  }
  const result: string[] = [];
  const gap = () => { if (result.length && result[result.length - 1] !== '') result.push(''); };

  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/[ \t]{2,}/g, ' ');
    if (!line) { gap(); continue; }
    const heading = line.replace(/:$/, '').toLowerCase();
    const metadataHeading = heading === 'job information' || /^expected rate(?:\s*\(.*\))?$/.test(heading);
    if (metadataHeading || SECTION_KEYS.has(heading)) {
      gap();
      result.push(line);
      if (!metadataHeading) gap();
      continue;
    }
    if (METADATA_LINE.test(line)) { result.push(line); continue; }
    const bullet = raw.match(/^(\s*)([-*]|\d+[.)])\s+(.+)$/);
    if (bullet) {
      const indent = ' '.repeat(Math.min(8, bullet[1].length));
      const marker = bullet[2] === '*' ? '-' : bullet[2];
      result.push(...wrap(`${indent}${marker} ${bullet[3]}`, 100, `${indent}  `));
      continue;
    }
    if (/^ {2,}\S/.test(raw)) {
      const indent = raw.match(/^ +/)![0];
      result.push(...wrap(raw, 100, indent));
      continue;
    }
    // Long copied paragraphs become shorter paragraphs at sentence boundaries, without rewriting.
    const sentences = [...SENTENCES.segment(line)]
      .map(({ segment }) => segment.trim());
    let paragraph = '';
    for (const sentence of sentences) {
      if (paragraph.length >= 280) { result.push(...wrap(paragraph)); gap(); paragraph = ''; }
      paragraph += `${paragraph ? ' ' : ''}${sentence}`;
    }
    if (paragraph) result.push(...wrap(paragraph));
  }
  return result.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function wrap(text: string, width = 100, continuation = ''): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = text.match(/^\s*/)?.[0] ?? '';
  for (const word of words) {
    if (line.trim() && line.length + word.length + 1 > width) {
      lines.push(line); line = continuation;
    }
    line += `${line.trim() ? ' ' : ''}${word}`;
  }
  if (line.trim()) lines.push(line);
  return lines;
}
