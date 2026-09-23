import { ApplicationIngestionLockService } from './application-ingestion-lock.service';

describe('ApplicationIngestionLockService', () => {
  it('does not overlap concurrent ingestion critical sections', async () => {
    const lock = new ApplicationIngestionLockService();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const first = lock.runExclusive(async () => {
      events.push('first:start');
      await firstGate;
      events.push('first:end');
    });
    const second = lock.runExclusive(async () => {
      events.push('second:start');
      events.push('second:end');
    });

    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });
});
