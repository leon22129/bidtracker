import { capturedFormHistory, mergeCapturedStep, validateCapturedStep } from './application-form.util';

const step = (key: string, answer = 'Typed answer', time = Date.now()) => ({
  key, step: key, url: 'https://jobs.example.test/apply', captured_at: time,
  fields: [{ id: 'field-1', question: 'Company name', answer, section: 'Employment 1', field_type: 'text' },
    { id: 'field-2', question: 'Company name', answer: 'Second company', section: 'Employment 2', field_type: 'text' }],
});

describe('captured application form history', () => {
  it('keeps steps and repeated questions, and replaces a revisited step including blanks/deletions', () => {
    const now = Date.now();
    let json = mergeCapturedStep(null, validateCapturedStep(step('Experience', 'First', now)));
    json = mergeCapturedStep(json, validateCapturedStep(step('Questions', 'Second', now + 1)));
    const corrected = step('Experience', '', now + 2);
    corrected.fields.pop();
    json = mergeCapturedStep(json, validateCapturedStep(corrected));
    json = mergeCapturedStep(json, validateCapturedStep(step('Experience', 'Stale retry', now)));
    const history = capturedFormHistory(json);
    expect(history.answers_source).toBe('form');
    expect(history.answers.map((item) => item.answer)).toEqual(['', 'Second', 'Second company']);
    expect(history.answers[0].step).toBe('Experience');
  });

  it('returns no purported form answers when no capture exists', () => {
    expect(capturedFormHistory(null)).toEqual({ answers: [], questions: [], answers_source: null });
  });

  it('validates sizes, URLs, duplicate field ids and excludes credential fields', () => {
    const valid = step('Details');
    expect(() => validateCapturedStep({ ...valid, url: 'javascript:alert(1)' })).toThrow();
    expect(() => validateCapturedStep({ ...valid, fields: [valid.fields[0], valid.fields[0]] })).toThrow();
    expect(() => validateCapturedStep({ ...valid, fields: [{ ...valid.fields[0], field_type: 'password' }] })).toThrow();
    expect(() => validateCapturedStep({ ...valid, fields: [{ ...valid.fields[0], answer: 'x'.repeat(20001) }] })).toThrow();
    expect(() => validateCapturedStep({ ...valid, captured_at: Date.now() + 600_000 })).toThrow();
  });
});
