import { ApplicationAnswerCache, answerContextFingerprint } from './application-answer-cache';

describe('ApplicationAnswerCache', () => {
  const question = { question: 'Choose a language', options: ['C++', 'C#'] };
  const fingerprint = answerContextFingerprint(['resume', 'JD', 'profile', 'model']);

  it('requires the same context, question and choices after persistence', () => {
    const cache = new ApplicationAnswerCache(fingerprint);
    cache.set(question, 'C++');
    const serialized = cache.serialize();
    expect(new ApplicationAnswerCache(fingerprint, serialized).get(question)).toBe('C++');
    expect(new ApplicationAnswerCache('changed', serialized).get(question)).toBeUndefined();
    expect(cache.get({ ...question, options: ['Java'] })).toBeUndefined();
    expect(cache.get({ ...question, question: 'Choose another language' })).toBeUndefined();
  });

  it.each(['{', 'null', '{"version":1}', 'x'.repeat(500_001)])('ignores malformed or oversized persisted data', (serialized) => {
    expect(new ApplicationAnswerCache(fingerprint, serialized).get(question)).toBeUndefined();
  });

  it('bounds the persisted cache while keeping recent answers', () => {
    const cache = new ApplicationAnswerCache(fingerprint);
    for (let i = 0; i < 250; i++) cache.set({ question: String(i) }, 'Answer '.repeat(2000));
    const serialized = cache.serialize();
    expect(serialized.length).toBeLessThanOrEqual(500_000);
    const restored = new ApplicationAnswerCache(fingerprint, serialized);
    expect(restored.get({ question: '0' })).toBeUndefined();
    expect(restored.get({ question: '249' })).toBeDefined();
  });
});
