import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  BulkUpdateApplicationsDto,
  BulkUpdatePatchDto,
  CreateGeneratedApplicationDto,
  CreateManualApplicationDto,
  QueryApplicationsDto,
  UpdateApplicationDto,
  UpdatePipelineDto,
} from './application.dto';

describe('QueryApplicationsDto cursor pagination', () => {
  it.each([['true', true], ['false', false]])('transforms has_screenshot=%s', async (input, expected) => {
    const value = plainToInstance(QueryApplicationsDto, {
      workspace_id: 'workspace-1', has_screenshot: input,
    });
    await expect(validate(value)).resolves.toHaveLength(0);
    expect(value.has_screenshot).toBe(expected);
  });

  it('accepts the Banned status filter', async () => {
    await expect(validate(plainToInstance(QueryApplicationsDto, {
      workspace_id: 'workspace-1',
      application_status: ['Banned'],
    }))).resolves.toHaveLength(0);
  });

  it('accepts cursors and transforms include_total', async () => {
    const value = plainToInstance(QueryApplicationsDto, {
      workspace_id: 'workspace-1',
      cursor_after: 'application-1',
      include_total: 'false',
    });
    await expect(validate(value)).resolves.toHaveLength(0);
    expect(value.include_total).toBe(false);
  });
});

describe.each([UpdateApplicationDto, BulkUpdatePatchDto])('%s banned application status', (Dto) => {
  it('accepts Cancelled for application status updates', async () => {
    await expect(validate(plainToInstance(Dto, {
      application_status: 'Cancelled',
    }))).resolves.toHaveLength(0);
  });
  it('accepts Banned for application status updates', async () => {
    await expect(validate(plainToInstance(Dto, {
      application_status: 'Banned',
    }))).resolves.toHaveLength(0);
  });
});

describe('BulkUpdateApplicationsDto', () => {
  it('loads runtime decorator metadata and validates its nested patch DTO', async () => {
    const value = plainToInstance(BulkUpdateApplicationsDto, {
      ids: ['application-1'],
      patch: { application_status: 'Applied' },
    });

    expect(value.patch).toBeInstanceOf(BulkUpdatePatchDto);
    await expect(validate(value)).resolves.toHaveLength(0);
  });
});

describe('UpdatePipelineDto', () => {
  it('accepts interview scheduling metadata and nullable clearing values', async () => {
    await expect(validate(plainToInstance(UpdatePipelineDto, {
      pipeline_status: 'Recruiter Interview',
      interview_date: '2026-09-30T15:00:00.000Z',
      interview_note: 'Video call',
    }))).resolves.toHaveLength(0);
    await expect(validate(plainToInstance(UpdatePipelineDto, {
      interview_date: null,
      interview_note: null,
    }))).resolves.toHaveLength(0);
  });

  it('rejects an invalid interview date', async () => {
    const errors = await validate(plainToInstance(UpdatePipelineDto, {
      interview_date: 'not-a-date',
    }));
    expect(errors.some((error) => error.property === 'interview_date')).toBe(true);
  });
});

describe.each([
  ['manual', CreateManualApplicationDto, { application_status: 'Applied' }],
  ['resume-builder', CreateGeneratedApplicationDto, {}],
])('%s application creation DTO', (_name, Dto, extras) => {
  const valid = {
    workspace_id: 'workspace-1',
    url: 'https://example.com/jobs/1',
    job_title: 'Engineer',
    company_name: 'Acme',
    ...extras,
  };

  it.each(['job_title', 'company_name'] as const)('rejects a blank %s', async (field) => {
    const value = plainToInstance(Dto as any, { ...valid, [field]: '   ' }) as object;
    const errors = await validate(value);
    expect(errors.some((error) => error.property === field)).toBe(true);
  });

  it('accepts complete application metadata', async () => {
    await expect(validate(plainToInstance(Dto as any, valid) as object)).resolves.toHaveLength(0);
  });
});
