import { appendFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ConsoleLogger, LogLevel, LoggerService } from '@nestjs/common';

function jsonReplacer(_key: string, value: unknown) {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

function structuredMessage(message: unknown): Record<string, unknown> | null {
  if (typeof message !== 'string' || !message.startsWith('{')) return null;
  try {
    const parsed: unknown = JSON.parse(message);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/** Writes one JSON object per line while retaining Nest's normal console output. */
export class DailyFileLogger implements LoggerService {
  private readonly consoleLogger = new ConsoleLogger();
  private readonly logDirectory: string;
  private readonly enabledLevels: Set<LogLevel>;
  private fileErrorReported = false;
  private writeQueue: Promise<void>;
  private retentionCheckedDate = new Date().toISOString().slice(0, 10);

  constructor(levels: LogLevel[], logDirectory = resolve(__dirname, '../../../logs')) {
    this.enabledLevels = new Set(levels);
    this.logDirectory = logDirectory;
    this.writeQueue = mkdir(this.logDirectory, { recursive: true })
      .then(() => this.removeExpiredLogs())
      .catch((error) => this.reportFileError(error));
  }

  log(message: unknown, ...optionalParams: unknown[]) {
    this.write('log', 'info', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]) {
    this.write('error', 'error', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]) {
    this.write('warn', 'warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]) {
    this.write('debug', 'debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]) {
    this.write('verbose', 'verbose', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]) {
    this.write('fatal', 'fatal', message, optionalParams);
  }

  private write(
    nestLevel: LogLevel,
    fileLevel: string,
    message: unknown,
    optionalParams: unknown[],
  ) {
    if (!this.enabledLevels.has(nestLevel)) return;

    if (nestLevel === 'error') this.consoleLogger.error(message, ...optionalParams);
    else if (nestLevel === 'warn') this.consoleLogger.warn(message, ...optionalParams);
    else if (nestLevel === 'debug') this.consoleLogger.debug(message, ...optionalParams);
    else if (nestLevel === 'verbose') this.consoleLogger.verbose(message, ...optionalParams);
    else if (nestLevel === 'fatal') this.consoleLogger.fatal(message, ...optionalParams);
    else this.consoleLogger.log(message, ...optionalParams);

    const lastParameter = optionalParams.at(-1);
    const context = typeof lastParameter === 'string' ? lastParameter : undefined;
    const details = context ? optionalParams.slice(0, -1) : optionalParams;
    const parsed = structuredMessage(message);
    const suppliedTimestamp = typeof parsed?.timestamp === 'string' ? parsed.timestamp : '';
    const timestamp = /^\d{4}-\d{2}-\d{2}T/.test(suppliedTimestamp)
      && Number.isFinite(Date.parse(suppliedTimestamp))
      ? suppliedTimestamp
      : new Date().toISOString();
    const entry = parsed
      ? { ...parsed, timestamp, level: fileLevel, context: parsed.context ?? context }
      : {
          timestamp,
          level: fileLevel,
          context,
          message,
          ...(details.length ? { details } : {}),
        };

    const date = timestamp.slice(0, 10);
    const line = `${JSON.stringify(entry, jsonReplacer)}\n`;
    if (this.retentionCheckedDate !== date) {
      this.retentionCheckedDate = date;
      this.writeQueue = this.writeQueue
        .then(() => this.removeExpiredLogs())
        .catch((error) => this.reportFileError(error));
    }
    this.writeQueue = this.writeQueue
      .then(() => appendFile(resolve(this.logDirectory, `${date}.log`), line, 'utf8'))
      .catch((error) => this.reportFileError(error));
  }

  /** Primarily for graceful shutdown and deterministic tests. */
  async flush() {
    await this.writeQueue;
  }

  private async removeExpiredLogs() {
    const configured = Number(process.env.LOG_RETENTION_DAYS ?? 30);
    const days = Number.isFinite(configured)
      ? Math.min(3650, Math.max(1, Math.trunc(configured)))
      : 30;
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const files = await readdir(this.logDirectory);
    await Promise.all(files
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.log$/.test(name) && name.slice(0, 10) < cutoff)
      .map((name) => unlink(resolve(this.logDirectory, name))));
  }

  private reportFileError(error: unknown) {
    if (this.fileErrorReported) return;
    this.fileErrorReported = true;
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Unable to write backend log file: ${message}\n`);
  }
}
