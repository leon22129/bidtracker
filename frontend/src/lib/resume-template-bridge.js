// JavaScript bridge keeps the shared TSX templates out of this app's TypeScript program. The two
// apps intentionally use different React type versions, while Next still compiles these sources.
export { ClassicTemplate } from '../../../resume-builder-frontend/src/renderer/src/lib/pdf-templates/classic';
export { ModernTemplate } from '../../../resume-builder-frontend/src/renderer/src/lib/pdf-templates/modern';
export { MinimalTemplate } from '../../../resume-builder-frontend/src/renderer/src/lib/pdf-templates/minimal';
export { ExecutiveTemplate } from '../../../resume-builder-frontend/src/renderer/src/lib/pdf-templates/executive';
export { AcademicTemplate } from '../../../resume-builder-frontend/src/renderer/src/lib/pdf-templates/academic';
export { TechTemplate } from '../../../resume-builder-frontend/src/renderer/src/lib/pdf-templates/tech';
export { ElegantTemplate } from '../../../resume-builder-frontend/src/renderer/src/lib/pdf-templates/elegant';
export { BoldTemplate } from '../../../resume-builder-frontend/src/renderer/src/lib/pdf-templates/bold';
export { CorporateTemplate } from '../../../resume-builder-frontend/src/renderer/src/lib/pdf-templates/corporate';
export { ClassicCoverLetterTemplate } from '../../../resume-builder-frontend/src/renderer/src/lib/cover-letter-templates/classic';
export { ModernCoverLetterTemplate } from '../../../resume-builder-frontend/src/renderer/src/lib/cover-letter-templates/modern';
export { MinimalCoverLetterTemplate } from '../../../resume-builder-frontend/src/renderer/src/lib/cover-letter-templates/minimal';
