import { createHash } from 'node:crypto';
import { ApplicationQuestionInput } from './original-prompts';

const MAX_ENTRIES = 200;
const MAX_JSON_LENGTH = 500_000;

export function answerContextFingerprint(context: unknown): string {
  return createHash('sha256').update(JSON.stringify(context)).digest('hex');
}

/** Scoped to one owned conversation. Context changes invalidate all previous entries. */
export class ApplicationAnswerCache {
  private readonly entries = new Map<string, string>();

  constructor(private readonly fingerprint: string, serialized?: string | null) {
    if (!serialized || serialized.length > MAX_JSON_LENGTH) return;
    try {
      const saved = JSON.parse(serialized);
      if (saved.version !== 1 || saved.fingerprint !== fingerprint || !Array.isArray(saved.entries)) return;
      for (const entry of saved.entries.slice(-MAX_ENTRIES)) {
        if (Array.isArray(entry) && /^[a-f0-9]{64}$/.test(entry[0])
          && typeof entry[1] === 'string' && entry[1].trim() && entry[1].length <= 20_000) {
          this.entries.set(entry[0], entry[1]);
        }
      }
    } catch { /* A damaged cache must not prevent regenerating answers. */ }
  }

  get(question: ApplicationQuestionInput): string | undefined {
    return this.entries.get(this.key(question));
  }

  set(question: ApplicationQuestionInput, answer: string) {
    if (!answer.trim() || answer.length > 20_000) return;
    const key = this.key(question);
    this.entries.delete(key);
    this.entries.set(key, answer);
    if (this.entries.size > MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
  }

  serialize(): string {
    const entries = [...this.entries];
    let result: string;
    do {
      result = JSON.stringify({ version: 1, fingerprint: this.fingerprint, entries });
      if (result.length <= MAX_JSON_LENGTH) return result;
      entries.shift();
    } while (entries.length);
    return JSON.stringify({ version: 1, fingerprint: this.fingerprint, entries: [] });
  }

  private key(question: ApplicationQuestionInput) {
    return answerContextFingerprint([question.question, question.options ?? []]);
  }
}
