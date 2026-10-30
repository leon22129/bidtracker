import { BASE_PROMPT_TEXT } from '../resume/original-prompts';
import { DEFAULT_RESUME_PROMPT, renderResumePrompt, RESUME_OUTPUT_INSTRUCTIONS, RESUME_PROMPT_VARIABLES, validateResumePrompt } from './resume-prompt';

describe('Resume prompt templates', () => {
  it('retains the original instructions and output fields when adding data placeholders', () => {
    expect(RESUME_PROMPT_VARIABLES.reduce((text, token) => text.replace(`\n${token}`, ''), DEFAULT_RESUME_PROMPT)).toBe(BASE_PROMPT_TEXT);
    expect(validateResumePrompt(DEFAULT_RESUME_PROMPT)).toBeNull();
    expect(RESUME_OUTPUT_INSTRUCTIONS).toContain('"workexperience"');
    expect(RESUME_OUTPUT_INSTRUCTIONS).toContain('"coverletter"');
  });

  it('inserts candidate data literally without interpreting replacement syntax or embedded placeholders', () => {
    const result = renderResumePrompt('{{job_description}}\n{{career_milestones}}\n{{candidate_location}}\n{{candidate_info}}', {
      '{{job_description}}': 'Salary $&; {{candidate_info}} is literal JD content',
      '{{career_milestones}}': 'Company $1', '{{candidate_location}}': 'Chicago', '{{candidate_info}}': 'Candidate',
    });
    expect(result).toBe('Salary $&; {{candidate_info}} is literal JD content\nCompany $1\nChicago\nCandidate');
  });

  it('requires all data placeholders and a nonempty prompt within the length limit', () => {
    for (const token of RESUME_PROMPT_VARIABLES) {
      expect(() => validateResumePrompt(DEFAULT_RESUME_PROMPT.replace(token, ''))).toThrow(token);
    }
    expect(() => validateResumePrompt('   ')).toThrow('characters');
    expect(() => validateResumePrompt('a'.repeat(50001))).toThrow('characters');
  });
});
