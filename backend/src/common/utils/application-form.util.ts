import { BadRequestException } from '@nestjs/common';

export interface CapturedFormField {
  id: string;
  question: string;
  answer: string;
  section: string;
  field_type: string;
}

export interface CapturedFormStep {
  key: string;
  step: string;
  url: string;
  captured_at: number;
  fields: CapturedFormField[];
}

export interface CapturedApplicationForm {
  version: 1;
  source: 'form';
  steps: CapturedFormStep[];
}

export function validateCapturedStep(value: unknown): CapturedFormStep {
  const fail = () => { throw new BadRequestException('Invalid application form capture'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const step = value as CapturedFormStep;
  const text = (value: unknown, max: number, required = false) =>
    typeof value === 'string' && value.length <= max && (!required || Boolean(value.trim()));
  if (!text(step.key, 2000, true) || !text(step.step, 300) || !text(step.url, 2000, true)
    || !Number.isSafeInteger(step.captured_at) || step.captured_at <= 0
    || step.captured_at > Date.now() + 300_000
    || !Array.isArray(step.fields) || step.fields.length > 500) return fail();
  try { if (!['http:', 'https:'].includes(new URL(step.url).protocol)) return fail(); } catch { return fail(); }
  const ids = new Set<string>();
  const fields = step.fields.map((field) => {
    if (!field || !text(field.id, 1000, true) || ids.has(field.id)
      || !text(field.question, 1000, true) || !text(field.answer, 20000)
      || !text(field.section, 300) || !text(field.field_type, 40, true)
      || ['password', 'hidden'].includes(field.field_type)) return fail();
    ids.add(field.id);
    return { id: field.id, question: field.question, answer: field.answer,
      section: field.section, field_type: field.field_type };
  });
  const result = { key: step.key, step: step.step, url: step.url, captured_at: step.captured_at, fields };
  if (JSON.stringify(result).length > 90_000) throw new BadRequestException('This form step is too large to save');
  return result;
}

export function parseCapturedForm(json?: string | null): CapturedApplicationForm {
  if (!json) return { version: 1, source: 'form', steps: [] };
  const form = JSON.parse(json) as CapturedApplicationForm;
  if (form.version !== 1 || form.source !== 'form' || !Array.isArray(form.steps)) {
    throw new BadRequestException('Invalid saved application form');
  }
  return form;
}

export function mergeCapturedStep(json: string | null | undefined, step: CapturedFormStep): string {
  const form = parseCapturedForm(json);
  const index = form.steps.findIndex((item) => item.key === step.key);
  // Retried requests must not replace a newer observation of the same step.
  if (index < 0) form.steps.push(step);
  else if (form.steps[index].captured_at < step.captured_at) form.steps[index] = step;
  const result = JSON.stringify(form);
  if (form.steps.length > 100 || result.length > 500_000) {
    throw new BadRequestException('Application form capture is too large to save');
  }
  return result;
}

export function capturedFormHistory(json?: string | null) {
  const form = parseCapturedForm(json);
  const answers = form.steps.flatMap((step) => step.fields.map((field) => ({
    ...field, step: step.step, url: step.url, captured_at: new Date(step.captured_at).toISOString(),
  })));
  return { answers, questions: answers.map(({ question }) => ({ question, options: [] })),
    answers_source: json ? 'form' as const : null };
}
