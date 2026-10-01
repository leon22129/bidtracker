import { createJobFingerprint } from './job-fingerprint.util';

describe('createJobFingerprint', () => {
  it('normalizes punctuation, legal suffixes, whitespace, and title levels', () => {
    expect(createJobFingerprint('Acme, Inc.', 'Software Engineer II')).toBe(
      createJobFingerprint('  ACME  ', 'Software Engineer 2'),
    );
  });

  it('requires both company and job title', () => {
    expect(createJobFingerprint('Acme', null)).toBeNull();
    expect(createJobFingerprint(null, 'Engineer')).toBeNull();
  });

  it('does not equate different job titles', () => {
    expect(createJobFingerprint('Acme', 'Engineer')).not.toBe(
      createJobFingerprint('Acme', 'Designer'),
    );
  });
});
