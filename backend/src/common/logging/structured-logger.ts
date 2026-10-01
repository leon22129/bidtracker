import { AsyncLocalStorage } from 'node:async_hooks';
import type { LoggerService } from '@nestjs/common';

interface RequestContext {
  requestId: string;
}

type LogFields = Record<string, unknown>;

const requestContext = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(requestId: string, callback: () => T): T {
  return requestContext.run({ requestId }, callback);
}

export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}

function serialize(_key: string, value: unknown) {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  return value;
}

export function logEvent(
  logger: LoggerService,
  level: 'log' | 'warn' | 'error' | 'debug',
  event: string,
  fields: LogFields = {},
) {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    ...(getRequestId() ? { request_id: getRequestId() } : {}),
    ...fields,
  }, serialize);

  if (level === 'error') logger.error(entry);
  else if (level === 'warn') logger.warn(entry);
  else if (level === 'debug') logger.debug?.(entry);
  else logger.log(entry);
}

export function errorFields(error: unknown): LogFields {
  if (error instanceof Error) {
    const cause = 'cause' in error ? error.cause : undefined;
    return {
      error_name: error.name,
      error_message: error.message,
      error_stack: error.stack,
      ...(cause ? { error_cause: cause } : {}),
    };
  }
  return { error_message: String(error) };
}
