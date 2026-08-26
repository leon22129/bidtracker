import 'reflect-metadata';
// Loads backend/.env for local development. In Docker every variable arrives from compose, and dotenv
// never overwrites an already-set variable, so this line is a no-op there.
import 'dotenv/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';

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
  const logger = new Logger('Bootstrap');
  assertProductionSecrets(logger);

  const app = await NestFactory.create(AppModule, {
    // Trust the reverse proxy / Cloudflare Tunnel for client IPs.
    bodyParser: true,
  });

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,             // strip unknown properties...
      forbidNonWhitelisted: false, // ...but don't 400 on them: clients may send extra display fields
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalFilters(new PrismaExceptionFilter());

  // CORS: the frontend is normally same-origin behind the tunnel, but a split-origin dev setup
  // (localhost:3000 -> localhost:3001) and a separate tunnel hostname both need this.
  const origins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins.includes('*') ? true : origins,
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
  logger.log(`Duplicate detection scope: ${process.env.DUPLICATE_SCOPE || 'global'}`);
  logger.log(`URL enrichment: ${process.env.ENABLE_URL_ENRICHMENT === 'false' ? 'disabled' : 'enabled'}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
