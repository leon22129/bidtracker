import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { REQUIRE_RESUME_BUILDER_VERSION } from '../decorators/resume-builder-version.decorator';

export const RESUME_BUILDER_VERSION_HEADER = 'x-resume-builder-version';
export const DEFAULT_RESUME_BUILDER_MIN_VERSION = '0.9.3';

function versionParts(value: unknown): number[] | null {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(value)) return null;
  const parts = value.split('.').map(Number);
  return parts.every((part) => Number.isSafeInteger(part) && part <= 65535) ? parts : null;
}

function atLeast(current: number[], minimum: number[]): boolean {
  for (let index = 0; index < 4; index++) {
    const difference = (current[index] ?? 0) - (minimum[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

@Injectable()
export class ResumeBuilderVersionGuard implements CanActivate {
  private readonly minimumVersion: string;
  private readonly minimumParts: number[];

  constructor(private readonly reflector: Reflector) {
    this.minimumVersion = process.env.RESUME_BUILDER_MIN_VERSION?.trim() || DEFAULT_RESUME_BUILDER_MIN_VERSION;
    const parts = versionParts(this.minimumVersion);
    if (!parts) throw new Error('RESUME_BUILDER_MIN_VERSION must contain three or four numeric version components (for example 0.9.3).');
    this.minimumParts = parts;
  }

  canActivate(context: ExecutionContext): boolean {
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

    const parts = versionParts(version);
    if (parts && atLeast(parts, this.minimumParts)) return true;

    throw new HttpException({
      statusCode: 426,
      code: 'RESUME_BUILDER_UPDATE_REQUIRED',
      message: `Update Resume Builder to version ${this.minimumVersion} or newer, then reload the extension in Chrome.`,
      minimum_version: this.minimumVersion,
      current_version: parts ? version : null,
    }, 426);
  }
}
