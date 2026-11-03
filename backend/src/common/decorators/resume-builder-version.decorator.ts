import { SetMetadata } from '@nestjs/common';

export const REQUIRE_RESUME_BUILDER_VERSION = 'requireResumeBuilderVersion';

/** Require a version even for legacy clients that send no identifying headers. */
export const RequireResumeBuilderVersion = () => SetMetadata(REQUIRE_RESUME_BUILDER_VERSION, true);
