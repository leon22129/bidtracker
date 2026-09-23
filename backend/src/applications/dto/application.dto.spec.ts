import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  BulkUpdateApplicationsDto,
  BulkUpdatePatchDto,
  CreateGeneratedApplicationDto,
  CreateManualApplicationDto,
} from './application.dto';

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
