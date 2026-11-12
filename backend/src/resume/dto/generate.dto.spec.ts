import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GenerateApplicationDto } from './generate.dto';

describe('GenerateApplicationDto application modes', () => {
  const input = { workspace_id: 'workspace-1', job_description: 'Acme is hiring a remote engineer in the US.' };

  it('accepts a manual JD without a URL', async () => {
    expect(await validate(plainToInstance(GenerateApplicationDto, { ...input, mode: 'manual' }))).toHaveLength(0);
  });

  it.each([undefined, 'linked'])('requires a URL for mode %s', async (mode) => {
    const errors = await validate(plainToInstance(GenerateApplicationDto, { ...input, mode }));
    expect(errors.some((error) => error.property === 'url')).toBe(true);
  });

  it.each(['manual', 'linked'])('rejects a malformed URL in mode %s', async (mode) => {
    const errors = await validate(plainToInstance(GenerateApplicationDto, { ...input, mode, url: 'invalid' }));
    expect(errors.some((error) => error.property === 'url')).toBe(true);
  });

  it('rejects unknown modes', async () => {
    const errors = await validate(plainToInstance(GenerateApplicationDto, { ...input, mode: 'other', url: 'https://example.com/jobs/1' }));
    expect(errors.some((error) => error.property === 'mode')).toBe(true);
  });
});
