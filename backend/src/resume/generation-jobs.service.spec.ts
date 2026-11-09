import { BadGatewayException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { GenerationJobsService } from './generation-jobs.service';

describe('background generation jobs', () => {
  const user = { id: 'u1', username: 'bidder', email: 'bidder@example.test', role: 'bidder' as const };
  const dto = { workspace_id: 'w1', url: 'https://example.test/job', job_description: 'Remote engineer job' };
  let rows: Map<string, any>;
  let prisma: any;
  let access: any;
  let generation: any;
  let service: GenerationJobsService;

  const matches = (row: any, where: any): boolean => Object.entries(where || {}).every(([key, value]: [string, any]) => {
    if (key === 'OR') return value.some((clause: any) => matches(row, clause));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('in' in value) return value.in.includes(row[key]);
      if ('lt' in value) return row[key] != null && row[key] < value.lt;
      if ('gte' in value) return row[key] != null && row[key] >= value.gte;
    }
    return row[key] === value;
  });
  const settle = () => Promise.all([...(service as any).active.values()]);

  beforeEach(() => {
    rows = new Map();
    prisma = {
      generationJob: {
        findUnique: jest.fn(async ({ where }) => rows.get(where.id) || null),
        findMany: jest.fn(async ({ where, take }) => [...rows.values()].filter((row) => matches(row, where)).slice(0, take)),
        count: jest.fn(async ({ where }) => [...rows.values()].filter((row) => matches(row, where)).length),
        create: jest.fn(async ({ data }) => { const row = { ...data, status: 'queued', created_at: new Date() }; rows.set(row.id, row); return row; }),
        updateMany: jest.fn(async ({ where, data }) => {
          let count = 0;
          for (const row of rows.values()) if (matches(row, where)) { Object.assign(row, data); count++; }
          return { count };
        }),
        deleteMany: jest.fn(async ({ where }) => {
          for (const row of rows.values()) if (matches(row, where)) rows.delete(row.id);
          return { count: 0 };
        }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ ...user, is_active: true }) },
      resumeProfile: { findUnique: jest.fn().mockResolvedValue({ workspace_id: 'w1' }) },
      resumeConversation: { findUnique: jest.fn().mockResolvedValue({ user_id: 'u1', workspace_id: 'w1' }) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    prisma.$transaction = jest.fn((fn) => fn(prisma));
    access = { assertCanEdit: jest.fn().mockResolvedValue(undefined), assertCanView: jest.fn().mockResolvedValue(undefined) };
    generation = { generate: jest.fn().mockResolvedValue({ eligible: true, conversation_id: 'local-session' }),
      generateProfilePrompt: jest.fn().mockResolvedValue({ tailored_resume: 'resume' }),
      answerQuestions: jest.fn().mockResolvedValue({ answers: [] }) };
    service = new GenerationJobsService(prisma, access, generation);
    (service as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  });

  afterEach(() => jest.useRealTimers());

  it('returns immediately, survives a 130-second provider wait, and returns the same result to polls', async () => {
    jest.useFakeTimers();
    generation.generate.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ conversation_id: 'local-session' }), 130_000)));
    const ticket = await service.submit(user, 'application', dto, randomUUID());
    expect(ticket.status).toBe('queued');
    expect(generation.generate).not.toHaveBeenCalled();
    await service.dispatch();
    await jest.advanceTimersByTimeAsync(90_000);
    await service.maintain();
    await jest.advanceTimersByTimeAsync(36_000);
    expect((await service.get(user, ticket.job_id)).status).toBe('running');
    await jest.advanceTimersByTimeAsync(4000);
    await settle();
    expect(await service.get(user, ticket.job_id)).toEqual({ job_id: ticket.job_id, status: 'completed', result: { conversation_id: 'local-session' } });
    expect(rows.get(ticket.job_id).request_json).toBeNull();
    expect(generation.generate).toHaveBeenCalledTimes(1);
  });

  it('reuses an accepted submission after its response is lost, including after completion', async () => {
    const id = randomUUID();
    await service.submit(user, 'application', dto, id);
    await service.submit(user, 'application', dto, id);
    await service.dispatch();
    await settle();
    expect((await service.submit(user, 'application', dto, id)).status).toBe('completed');
    expect(prisma.generationJob.create).toHaveBeenCalledTimes(1);
    expect(generation.generate).toHaveBeenCalledTimes(1);
    await expect(service.submit(user, 'application', { ...dto, job_description: 'Changed JD' }, id)).rejects.toThrow('different request');
  });

  it('does not let another user poll or reuse someone else\'s job', async () => {
    const { job_id } = await service.submit(user, 'application', dto);
    const other = { ...user, id: 'other' };
    await expect(service.get(other, job_id)).rejects.toThrow('not found');
    await expect(service.submit(other, 'application', dto, job_id)).rejects.toThrow('not found');
  });

  it('checks workspace access both before queueing and before spending on a provider', async () => {
    access.assertCanEdit.mockRejectedValueOnce(new NotFoundException());
    await expect(service.submit(user, 'application', dto)).rejects.toThrow();
    expect(prisma.generationJob.create).not.toHaveBeenCalled();
    const job = await service.submit(user, 'application', dto);
    access.assertCanEdit.mockRejectedValueOnce(new NotFoundException('Workspace not found'));
    await service.dispatch();
    await settle();
    expect(generation.generate).not.toHaveBeenCalled();
    expect((await service.get(user, job.job_id)).status).toBe('failed');
  });

  it('does not run a job another worker has already claimed', async () => {
    await service.submit(user, 'application', dto);
    prisma.generationJob.updateMany.mockResolvedValueOnce({ count: 0 });
    await service.dispatch();
    expect(generation.generate).not.toHaveBeenCalled();
  });

  it('bounds pending submissions and validates IDs', async () => {
    await expect(service.submit(user, 'application', dto, 'bad-id')).rejects.toThrow('UUID');
    for (let i = 0; i < 3; i++) await service.submit(user, 'application', dto);
    await expect(service.submit(user, 'application', dto)).rejects.toThrow('wait');
  });

  it('preserves provider error messages while hiding unexpected internal errors', async () => {
    generation.generate.mockRejectedValueOnce(new BadGatewayException('DeepSeek is temporarily unavailable (HTTP 524).'));
    const first = await service.submit(user, 'application', dto);
    await service.dispatch(); await settle();
    expect(await service.get(user, first.job_id)).toMatchObject({ status: 'failed', error_status: 502, message: expect.stringContaining('524') });
    generation.generate.mockRejectedValueOnce(new Error('private connection details'));
    const second = await service.submit(user, 'application', dto);
    await service.dispatch(); await settle();
    expect(await service.get(user, second.job_id)).toMatchObject({ status: 'failed', message: 'Generation failed. Please try again.' });
  });

  it('expires interrupted work without replaying it and removes old results', async () => {
    const job = await service.submit(user, 'application', dto);
    Object.assign(rows.get(job.job_id), { status: 'running', lease_expires_at: new Date(Date.now() - 1000) });
    await service.maintain();
    await service.dispatch();
    expect(generation.generate).not.toHaveBeenCalled();
    expect(await service.get(user, job.job_id)).toMatchObject({ status: 'failed', error_status: 503 });
    rows.get(job.job_id).completed_at = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await service.maintain();
    await expect(service.get(user, job.job_id)).rejects.toThrow('not found');
  });

  it('uses the same queue for profile generation and conversation answers', async () => {
    await service.submit(user, 'profile', { profile_id: 'p1', url: dto.url, kind: 'resume', job_description: dto.job_description });
    await service.submit(user, 'answers', { conversation_id: 'c1', questions: [{ question: 'Why?' }] });
    await service.dispatch(); await settle();
    expect(generation.generateProfilePrompt).toHaveBeenCalledTimes(1);
    expect(generation.answerQuestions).toHaveBeenCalledTimes(1);
    prisma.resumeConversation.findUnique.mockResolvedValueOnce({ user_id: 'other' });
    await expect(service.submit(user, 'answers', { conversation_id: 'other', questions: [] })).rejects.toThrow('not found');
  });
});
