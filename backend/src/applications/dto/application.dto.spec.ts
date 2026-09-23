import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BulkUpdateApplicationsDto, BulkUpdatePatchDto } from './application.dto';

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
