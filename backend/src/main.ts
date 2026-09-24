import 'reflect-metadata';
// Loads backend/.env for local development. dotenv never overwrites variables already supplied by
// the host process, so production service managers can provide configuration directly.
import 'dotenv/config';
import { Logger, LogLevel, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { logEvent, runWithRequestContext } from './common/logging/structured-logger';
import { RequestErrorLoggingInterceptor } from './common/logging/request-error-logging.interceptor';
import { DailyFileLogger } from './common/logging/daily-file.logger';

function enabledLogLevels(): LogLevel[] {
  const level = (process.env.LOG_LEVEL || 'info').trim().toLowerCase();
  if (level === 'fatal') return ['fatal'];
  if (level === 'error') return ['fatal', 'error'];
  if (level === 'warn') return ['fatal', 'error', 'warn'];
  if (level === 'debug') return ['fatal', 'error', 'warn', 'log', 'debug'];
  if (level === 'verbose') return ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'];
  return ['fatal', 'error', 'warn', 'log'];
}

/**
 * A production deploy with the built-in development secret would let anyone who has read this
 * repository mint a valid admin token. Refusing to boot is the only safe behaviour; in development the
 * fallback secret is a convenience worth keeping.
 */
function assertProductionSecrets(logger: Logger) {
  if (process.env.NODE_ENV !== 'production') {
    if (!process.env.JWT_SECRET) {
      logger.warn('JWT_SECRET is not set — using the insecure development fallback.');
    }
    return;
  }
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error(
      'JWT_SECRET must be set to at least 32 characters in production. ' +
        'Generate one with: openssl rand -base64 48',
    );
  }
}

async function bootstrap() {
  const fileLogger = new DailyFileLogger(enabledLogLevels());
  Logger.overrideLogger(fileLogger);
  const logger = new Logger('Bootstrap');
  assertProductionSecrets(logger);

  const app = await NestFactory.create(AppModule, {
    // Reverse proxies and Cloudflare Tunnel can sit in front of this server when needed.
    bodyParser: true,
    logger: fileLogger,
  });

  app.setGlobalPrefix('api');

  const httpLogger = new Logger('Http');
  app.use((req: any, res: any, next: any) => {
    const suppliedRequestId = req.get?.('x-request-id');
    const requestId = typeof suppliedRequestId === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(suppliedRequestId)
      ? suppliedRequestId
      : randomUUID();
    const startedAt = performance.now();
    const isHealthCheck = req.path === '/api/health';
    res.setHeader('X-Request-Id', requestId);

    runWithRequestContext(requestId, () => {
      logEvent(httpLogger, isHealthCheck ? 'debug' : 'log', 'http_request_started', {
        method: req.method,
        path: req.path,
        ip: req.ip || req.socket?.remoteAddress,
      });

      res.once('finish', () => {
        const statusCode = res.statusCode;
        const level = statusCode >= 500
          ? 'error'
          : statusCode >= 400
            ? 'warn'
            : isHealthCheck ? 'debug' : 'log';
        logEvent(httpLogger, level, 'http_request_completed', {
          method: req.method,
          path: req.path,
          status_code: statusCode,
          duration_ms: Number((performance.now() - startedAt).toFixed(2)),
          response_bytes: Number(res.getHeader('content-length')) || undefined,
          user_id: req.user?.id,
        });
      });

      next();
    });
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,             // strip unknown properties...
      forbidNonWhitelisted: false, // ...but don't 400 on them: clients may send extra display fields
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalFilters(new PrismaExceptionFilter());
  app.useGlobalInterceptors(new RequestErrorLoggingInterceptor());

  // CORS: the frontend is normally same-origin behind the tunnel, but a split-origin dev setup
  // (localhost:3000 -> localhost:3001) and a separate tunnel hostname both need this.
  const origins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || origins.includes('*') || origins.includes(origin) || origin.startsWith('chrome-extension://')) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // Minimal hardening without pulling in helmet: these are the headers that matter for a JWT-in-
  // localStorage app behind a TLS-terminating tunnel.
  app.use((_req: any, res: any, next: any) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    next();
  });

  app.enableShutdownHooks();

  const port = Number(process.env.PORT || 3001);
  await app.listen(port, '0.0.0.0');
  logger.log(`API listening on http://0.0.0.0:${port}/api`);
  logger.log('Duplicate detection scope: global (database-enforced for active URLs)');
  logger.log(`Job fingerprint window: ${process.env.JOB_FINGERPRINT_WINDOW_DAYS || '90'} days`);
}

bootstrap().catch((err) => {
  const logger = new Logger('Bootstrap');
  logger.fatal('Fatal startup error', err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
