import { stripTrailingCoverLetterSigner } from './cover-letter.util';

describe('stripTrailingCoverLetterSigner', () => {
  it.each([
    'Candidate',
    'Candidate Name',
    '[Candidate Name]',
    'Your Name',
    '[Your Name]',
  ])('removes a trailing %s placeholder', (placeholder) => {
    expect(stripTrailingCoverLetterSigner(`Thank you for your consideration.\n\nSincerely,\n${placeholder}`))
      .toBe('Thank you for your consideration.\n\nSincerely,');
  });

  it('removes a duplicate saved full name', () => {
    expect(stripTrailingCoverLetterSigner(
      'Thank you for your consideration.\n\nBest regards,\nJane Candidate',
      'Jane Candidate',
    )).toBe('Thank you for your consideration.\n\nBest regards,');
  });

  it('does not remove candidate when it is part of the letter body', () => {
    const text = 'I would welcome the opportunity to discuss why I am a strong candidate.';
    expect(stripTrailingCoverLetterSigner(text, 'Jane Candidate')).toBe(text);
  });

  it('preserves a non-placeholder signer', () => {
    const text = 'Sincerely,\nHiring Team';
    expect(stripTrailingCoverLetterSigner(text, 'Jane Candidate')).toBe(text);
  });
});
