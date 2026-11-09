import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { Client } from 'pg';
import { logEvent } from '../common/logging/structured-logger';

export type GenerationNotification = { job_id: string; status: string };
const CHANNEL = 'bidtracker_generation_jobs';

/** One PostgreSQL listener per API process; no per-browser database polling. */
@Injectable()
export class GenerationJobNotificationsService implements OnModuleInit, OnModuleDestroy {
  readonly events = new EventEmitter();
  private readonly logger = new Logger(GenerationJobNotificationsService.name);
  private client?: Client;
  private retry?: NodeJS.Timeout;
  private health?: NodeJS.Timeout;
  private stopping = false;
  private healthy = false;

  get ready() { return this.healthy; }

  onModuleInit() { return this.connect(); }

  private async connect() {
    if (this.stopping) return;
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) return;
    const schema = new URL(connectionString).searchParams.get('schema') || 'public';
    const client = new Client({ connectionString, connectionTimeoutMillis: 5000,
      query_timeout: 5000, keepAlive: true, keepAliveInitialDelayMillis: 10_000 });
    this.client = client;
    const disconnected = () => {
      if (this.client !== client) return;
      this.client = undefined;
      this.healthy = false;
      if (this.health) clearInterval(this.health);
      this.events.emit('disconnected');
      void client.end().catch(() => {});
      if (!this.stopping) {
        logEvent(this.logger, 'warn', 'generation_notifications_disconnected');
        this.retry = setTimeout(() => { void this.connect(); }, 5000);
        this.retry.unref();
      }
    };
    client.on('error', disconnected);
    client.on('end', disconnected);
    client.on('notification', (message) => {
      if (!this.healthy || message.channel !== CHANNEL || !message.payload) return;
      try {
        const event = JSON.parse(message.payload);
        if (event.schema === schema && typeof event.job_id === 'string'
          && ['queued', 'running', 'completed', 'failed'].includes(event.status)) {
          this.events.emit('status', { job_id: event.job_id, status: event.status } satisfies GenerationNotification);
        }
      } catch { /* Ignore malformed notifications without exposing their payload in logs. */ }
    });
    try {
      await client.connect();
      const installed = await client.query<{ installed: boolean }>(`
        SELECT EXISTS (
          SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relname = 'generation_jobs'
            AND t.tgname = 'generation_job_status_changed' AND t.tgenabled IN ('O', 'A')
        ) AS installed`, [schema]);
      if (!installed.rows[0]?.installed) throw new Error('Notification migration is not installed');
      await client.query(`LISTEN ${CHANNEL}`);
      if (this.client !== client || this.stopping) { await client.end(); return; }
      this.healthy = true;
      this.health = setInterval(() => { void client.query('SELECT 1').catch(disconnected); }, 30_000);
      this.health.unref();
      logEvent(this.logger, 'log', 'generation_notifications_connected');
    } catch { disconnected(); }
  }

  async onModuleDestroy() {
    this.stopping = true;
    this.healthy = false;
    if (this.retry) clearTimeout(this.retry);
    if (this.health) clearInterval(this.health);
    const client = this.client;
    this.client = undefined;
    this.events.emit('disconnected');
    await client?.end().catch(() => {});
  }
}
