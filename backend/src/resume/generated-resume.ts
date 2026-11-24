import { BadGatewayException } from '@nestjs/common';

const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const texts = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.every(text);

/** Reject incomplete documents before saving a draft or returning them to the PDF renderer. */
export function validateGeneratedResume(resume: Record<string, unknown>, profile: {
  career_path?: string; generate_cover_letter?: boolean; use_generated_role_titles?: boolean;
}) {
  const skills = resume.skills;
  const experience = resume.workexperience;
  const validSkills = Array.isArray(skills) && skills.length > 0 && (
    skills.every(text) || skills.every((group) => object(group) && text(group.category) && texts(group.items))
  );
  const validExperience = Array.isArray(experience)
    && (!profile.career_path?.trim() || experience.length > 0)
    && experience.every((entry) => object(entry) && text(entry.companyname) && text(entry.role)
      && typeof entry.duration === 'string' && texts(entry.experience)
      && (entry.original_role === undefined || typeof entry.original_role === 'string')
      && (profile.use_generated_role_titles !== false || text(entry.original_role)));
  if (resume.error || !text(resume.main_title) || !text(resume.summary)
    || typeof resume.rate_in_jd !== 'boolean' || !validSkills || !validExperience) {
    throw new BadGatewayException('The AI provider returned an incomplete or invalid resume. Please try again.');
  }
  if (profile.generate_cover_letter && !text(resume.coverletter)) {
    throw new BadGatewayException('The AI provider did not include the requested cover letter. Please try again.');
  }
}
