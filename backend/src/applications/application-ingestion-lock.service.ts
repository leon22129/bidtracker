import { Injectable } from '@nestjs/common';

/**
 * Serializes duplicate classification and insertion across every application-ingestion path.
 *
 * SQLite deployments run one backend replica, so one process-wide mutex closes the race where two
 * imports both classify a URL as new before either one inserts it. Keeping the critical section at
 * the service layer also covers CSV/XLSX imports, manual creation, and extension creation uniformly.
 */
@Injectable()
export class ApplicationIngestionLockService {
  private tail: Promise<void> = Promise.resolve();

  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.tail = previous.then(() => current);

    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
