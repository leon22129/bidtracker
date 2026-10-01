import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConsoleLogger } from '@nestjs/common';
import { DailyFileLogger } from './daily-file.logger';

describe('DailyFileLogger', () => {
  it('writes JSON lines asynchronously to a date-named log file', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'bidtracker-logs-'));
    const consoleSpy = jest.spyOn(ConsoleLogger.prototype, 'log').mockImplementation();
    try {
      const logger = new DailyFileLogger(['log'], directory);
      logger.log(JSON.stringify({ event: 'test_event', request_id: 'request-1' }), 'TestContext');
      await logger.flush();

      const date = new Date().toISOString().slice(0, 10);
      const line = readFileSync(join(directory, `${date}.log`), 'utf8').trim();
      expect(JSON.parse(line)).toMatchObject({
        level: 'info',
        context: 'TestContext',
        event: 'test_event',
        request_id: 'request-1',
      });
    } finally {
      consoleSpy.mockRestore();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('removes date-named log files beyond the retention period', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'bidtracker-logs-'));
    const oldLog = join(directory, '2000-01-01.log');
    writeFileSync(oldLog, 'expired\n');
    try {
      const logger = new DailyFileLogger([], directory);
      await logger.flush();
      expect(existsSync(oldLog)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
