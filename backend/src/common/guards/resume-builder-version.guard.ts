import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { REQUIRE_RESUME_BUILDER_VERSION } from '../decorators/resume-builder-version.decorator';
import { ExtensionReleaseService } from '../../extension-release/extension-release.service';
import { atLeast, versionParts } from '../../extension-release/extension-version';

export const RESUME_BUILDER_VERSION_HEADER = 'x-resume-builder-version';

@Injectable()
export class ResumeBuilderVersionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly release: ExtensionReleaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.method === 'OPTIONS') return true;

    const version = request.headers[RESUME_BUILDER_VERSION_HEADER];
    const extensionOrigin = [request.headers.origin, request.headers.referer]
      .some((value) => typeof value === 'string' && value.startsWith('chrome-extension://'));
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRE_RESUME_BUILDER_VERSION, [
      context.getHandler(), context.getClass(),
    ]);
    // Shared dashboard routes remain available to normal web clients. Resume
    // workflow routes require the header regardless of Origin or login state.
    if (!required && !extensionOrigin && version === undefined) return true;

    const release = await this.release.get();
    const parts = versionParts(version);
    if (parts && atLeast(parts, versionParts(release.latest_version)!)) return true;

    throw new HttpException({
      statusCode: 426,
      code: 'RESUME_BUILDER_UPDATE_REQUIRED',
      message: `A new version of Resume Builder is available. Update to version ${release.latest_version} or newer, then reload the extension in Chrome.`,
      minimum_version: release.latest_version,
      latest_version: release.latest_version,
      download_url: release.download_url,
      current_version: parts ? version : null,
    }, 426);
  }
}
