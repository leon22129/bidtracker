import { careerPathIncludesCompany, createJobFingerprint } from './job-fingerprint.util';

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

describe('careerPathIncludesCompany', () => {
  it.each([
    ['## Visa, Inc.\nSenior Software Engineer\n01/2020 - 02/2023', 'Visa'],
    ['Company: Visa Inc. | Senior Software Engineer | 2020 - 2023', 'Visa'],
    ['Visa - Senior Software Engineer - January 2020 to February 2023', 'Visa, Inc.'],
  ])('finds a normalized previous employer in free-form milestones', (careerPath, company) => {
    expect(careerPathIncludesCompany(careerPath, company)).toBe(true);
  });

  it('does not confuse ordinary prose with a previous employer', () => {
    expect(careerPathIncludesCompany(
      'Acme Corp\nHandled work authorization and visa sponsorship workflows.',
      'Visa',
    )).toBe(false);
  });

  it('does not match a different employer', () => {
    expect(careerPathIncludesCompany('Acme Corp\nEngineer\n2020 - 2023', 'Visa')).toBe(false);
  });
});
