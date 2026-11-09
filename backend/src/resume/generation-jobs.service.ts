import {
  BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { createHash, randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import { GenerationJob, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { logEvent, runWithRequestContext } from '../common/logging/structured-logger';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';
import { ApplicationGenerationService } from './resume.service';
import { AnswerApplicationQuestionsDto, GenerateApplicationDto, GenerateProfilePromptDto } from './dto/generate.dto';

type JobKind = 'application' | 'profile' | 'answers';
type JobInput = GenerateApplicationDto | GenerateProfilePromptDto | AnswerApplicationQuestionsDto;
const LEASE_MS = 120_000;
const RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_CONCURRENT = 4;

@Injectable()
export class GenerationJobsService implements OnModuleDestroy {
  private readonly logger = new Logger(GenerationJobsService.name);
  private readonly active = new Map<string, Promise<void>>();
  private dispatching = false;
  private maintaining = false;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly generation: ApplicationGenerationService,
  ) {}

  async submit(user: AuthUser, kind: JobKind, input: JobInput, requestId?: string) {
    const id = requestId || randomUUID();
    if (!isUUID(id, '4')) throw new BadRequestException('X-Generation-Id must be a UUID v4');
    const requestJson = JSON.stringify(input);
    const requestHash = createHash('sha256').update(`${kind}\n${requestJson}`).digest('hex');
    const existing = await this.prisma.generationJob.findUnique({ where: { id } });
    if (existing) return this.existing(user, existing, requestHash);

    const workspaceId = await this.workspaceFor(user, kind, input);
    await this.access.assertCanEdit(user, workspaceId);
    // Serialize submissions by user, including simultaneous retries of the same request.
    const job = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`);
      const repeated = await tx.generationJob.findUnique({ where: { id } });
      if (repeated) return repeated;
      const pending = await tx.generationJob.count({ where: { user_id: user.id, status: { in: ['queued', 'running'] } } });
      if (pending >= 3) throw new HttpException('Please wait for your current generations to finish.', 429);
      return tx.generationJob.create({ data: {
        id, user_id: user.id, workspace_id: workspaceId, kind,
        request_hash: requestHash, request_json: requestJson,
      } });
    });
    return this.existing(user, job, requestHash);
  }

  async get(user: AuthUser, id: string) {
    const job = await this.prisma.generationJob.findUnique({ where: { id } });
    if (!job || job.user_id !== user.id) throw new NotFoundException('Generation job not found');
    await this.access.assertCanView(user, job.workspace_id);
    return this.view(job);
  }

  private async existing(user: AuthUser, job: GenerationJob, hash: string) {
    if (job.user_id !== user.id) throw new NotFoundException('Generation job not found');
    if (job.request_hash !== hash) throw new ConflictException('This generation ID was already used for a different request');
    await this.access.assertCanView(user, job.workspace_id);
    return this.view(job);
  }

  private view(job: GenerationJob) {
    return {
      job_id: job.id,
      status: job.status,
      ...(job.status === 'completed' ? { result: JSON.parse(job.result_json!) } : {}),
      ...(job.status === 'failed' ? { message: job.error_message, error_status: job.error_status } : {}),
    };
  }

  private async workspaceFor(user: AuthUser, kind: JobKind, input: JobInput): Promise<string> {
    if (kind === 'application') {
      const dto = input as GenerateApplicationDto;
      if (dto.profile_id) {
        const profile = await this.prisma.resumeProfile.findUnique({ where: { id: dto.profile_id }, select: { workspace_id: true } });
        if (profile?.workspace_id !== dto.workspace_id) throw new BadRequestException('The selected profile is not assigned to this workspace');
      }
      return dto.workspace_id;
    }
    if (kind === 'profile') {
      const profile = await this.prisma.resumeProfile.findUnique({ where: { id: (input as GenerateProfilePromptDto).profile_id }, select: { workspace_id: true } });
      if (!profile) throw new NotFoundException('Profile not found');
      return profile.workspace_id;
    }
    const conversation = await this.prisma.resumeConversation.findUnique({
      where: { id: (input as AnswerApplicationQuestionsDto).conversation_id },
      select: { user_id: true, workspace_id: true, profile: { select: { workspace_id: true } } },
    });
    if (!conversation || conversation.user_id !== user.id) throw new NotFoundException('Conversation not found');
    return conversation.workspace_id || conversation.profile.workspace_id;
  }

  // Each queued -> running transition is atomic across API processes. Never automatically replay
  // a running job after a crash: the provider might already have billed it or saved a draft.
  @Interval(2000)
  async dispatch() {
    if (this.stopping || this.dispatching || this.active.size >= MAX_CONCURRENT) return;
    this.dispatching = true;
    try {
      const jobs = await this.prisma.generationJob.findMany({
        where: { status: 'queued', created_at: { gte: new Date(Date.now() - RETENTION_MS) } },
        orderBy: { created_at: 'asc' }, take: MAX_CONCURRENT - this.active.size,
      });
      for (const job of jobs) {
        if (this.stopping) break;
        const claimed = await this.prisma.generationJob.updateMany({
          where: { id: job.id, status: 'queued' },
          data: { status: 'running', lease_expires_at: new Date(Date.now() + LEASE_MS) },
        });
        if (!claimed.count) continue;
        const task = runWithRequestContext(job.id, () => this.execute(job))
          .catch(() => logEvent(this.logger, 'error', 'generation_job_persistence_failed', { job_id: job.id }))
          .finally(() => this.active.delete(job.id));
        this.active.set(job.id, task);
      }
    } catch {
      logEvent(this.logger, 'error', 'generation_job_dispatch_failed');
    } finally {
      this.dispatching = false;
    }
  }

  private async execute(job: GenerationJob) {
    logEvent(this.logger, 'log', 'generation_job_started', { job_id: job.id, kind: job.kind });
    try {
      const account = await this.prisma.user.findUnique({ where: { id: job.user_id } });
      if (!account?.is_active) throw new HttpException('Your account is no longer active.', 403);
      const user: AuthUser = { id: account.id, username: account.username, email: account.email, role: account.role as AuthUser['role'] };
      await this.access.assertCanEdit(user, job.workspace_id);
      const input = JSON.parse(job.request_json!);
      const result = job.kind === 'application' ? await this.generation.generate(user, input)
        : job.kind === 'profile' ? await this.generation.generateProfilePrompt(user, input)
          : await this.generation.answerQuestions(user, input);
      await this.prisma.generationJob.updateMany({ where: { id: job.id, status: 'running' }, data: {
        status: 'completed', result_json: JSON.stringify(result), request_json: null,
        completed_at: new Date(), lease_expires_at: null,
      } });
      logEvent(this.logger, 'log', 'generation_job_completed', { job_id: job.id, kind: job.kind });
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 500;
      const message = error instanceof HttpException ? error.message : 'Generation failed. Please try again.';
      await this.prisma.generationJob.updateMany({ where: { id: job.id, status: 'running' }, data: {
        status: 'failed', error_message: message, error_status: status,
        request_json: null, completed_at: new Date(), lease_expires_at: null,
      } });
      logEvent(this.logger, 'warn', 'generation_job_failed', { job_id: job.id, kind: job.kind, status_code: status });
    }
  }

  @Interval(15_000)
  async maintain() {
    if (this.maintaining || this.stopping) return;
    this.maintaining = true;
    try {
      const now = new Date();
      if (this.active.size) await this.prisma.generationJob.updateMany({
        where: { id: { in: [...this.active.keys()] }, status: 'running' },
        data: { lease_expires_at: new Date(Date.now() + LEASE_MS) },
      });
      await this.prisma.generationJob.updateMany({ where: {
        OR: [
          { status: 'running', lease_expires_at: { lt: now } },
          { status: 'queued', created_at: { lt: new Date(Date.now() - RETENTION_MS) } },
        ],
      }, data: {
        status: 'failed', error_status: 503,
        error_message: 'Generation was interrupted by a server restart or outage. Restore the last prepared job before starting again.',
        request_json: null, completed_at: now, lease_expires_at: null,
      } });
      await this.prisma.generationJob.deleteMany({ where: { completed_at: { lt: new Date(Date.now() - RETENTION_MS) } } });
    } catch {
      logEvent(this.logger, 'error', 'generation_job_maintenance_failed');
    } finally {
      this.maintaining = false;
    }
  }

  onModuleDestroy() { this.stopping = true; }
}
