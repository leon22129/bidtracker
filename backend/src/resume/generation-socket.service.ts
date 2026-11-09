import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Server, IncomingMessage } from 'node:http';
import { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { isUUID } from 'class-validator';
import { JwtPayload, JwtStrategy } from '../auth/jwt.strategy';
import { ExtensionReleaseService } from '../extension-release/extension-release.service';
import { atLeast, versionParts } from '../extension-release/extension-version';
import { GenerationJobsService } from './generation-jobs.service';
import { GenerationJobNotificationsService, GenerationNotification } from './generation-job-notifications.service';

export const GENERATION_SOCKET_PATH = '/api/resume/jobs/events';
type Connection = { jobId?: string; userId?: string; authenticating: boolean; alive: boolean; authTimer: NodeJS.Timeout };

@Injectable()
export class GenerationSocketService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false });
  private readonly connections = new Map<WebSocket, Connection>();
  private server?: Server;
  private heartbeat?: NodeJS.Timeout;

  constructor(
    private readonly adapter: HttpAdapterHost,
    private readonly jwt: JwtService,
    private readonly users: JwtStrategy,
    private readonly release: ExtensionReleaseService,
    private readonly jobs: GenerationJobsService,
    private readonly notifications: GenerationJobNotificationsService,
  ) {}

  onApplicationBootstrap() {
    this.server = this.adapter.httpAdapter.getHttpServer();
    this.server!.on('upgrade', this.upgrade);
    this.notifications.events.on('status', this.notify);
    this.notifications.events.on('disconnected', this.disconnect);
    this.sockets.on('connection', (socket) => this.connected(socket));
    this.heartbeat = setInterval(() => {
      for (const [socket, connection] of this.connections) {
        if (!connection.alive) { socket.terminate(); continue; }
        connection.alive = false;
        socket.ping();
        if (connection.jobId) socket.send(JSON.stringify({ type: 'heartbeat' }));
      }
    }, 25_000);
    this.heartbeat.unref();
  }

  private upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (request.url !== GENERATION_SOCKET_PATH) { socket.destroy(); return; }
    if (!this.notifications.ready || this.connections.size >= 200) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    this.sockets.handleUpgrade(request, socket, head, (ws) => this.sockets.emit('connection', ws, request));
  };

  private connected(socket: WebSocket) {
    const connection: Connection = { authenticating: false, alive: true,
      authTimer: setTimeout(() => socket.close(1008, 'Authentication required'), 10_000) };
    this.connections.set(socket, connection);
    socket.on('error', () => socket.terminate());
    socket.on('pong', () => { connection.alive = true; });
    socket.on('close', () => { clearTimeout(connection.authTimer); this.connections.delete(socket); });
    socket.on('message', (data, binary) => {
      if (binary || connection.authenticating || connection.jobId) { socket.close(1008, 'One subscription per connection'); return; }
      connection.authenticating = true;
      void this.subscribe(socket, connection, data.toString()).catch(() => socket.close(1008, 'Subscription rejected'));
    });
  }

  private async subscribe(socket: WebSocket, connection: Connection, raw: string) {
    const input = JSON.parse(raw);
    if (input.type !== 'subscribe' || !isUUID(input.job_id, '4') || typeof input.token !== 'string') throw new Error('Invalid subscription');
    const version = versionParts(input.version);
    const release = await this.release.get();
    if (!version || !atLeast(version, versionParts(release.latest_version)!)) throw new Error('Update required');
    const payload = await this.jwt.verifyAsync<JwtPayload>(input.token);
    const user = await this.users.validate(payload);
    if ([...this.connections.values()].filter((item) => item.userId === user.id).length >= 6) throw new Error('Too many subscriptions');
    // Establish ownership before registering, then read once more after registering so a completion
    // between authorization and registration cannot be missed. Resume content never goes on the socket.
    await this.jobs.getStatus(user, input.job_id);
    if (socket.readyState !== WebSocket.OPEN || !this.notifications.ready) { socket.close(1012, 'Reconnect'); return; }
    connection.userId = user.id;
    connection.jobId = input.job_id;
    clearTimeout(connection.authTimer);
    const current = await this.jobs.getStatus(user, input.job_id);
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'subscribed', job_id: current.job_id }));
    socket.send(JSON.stringify({ type: 'status', job_id: current.job_id, status: current.status }));
  }

  private notify = (event: GenerationNotification) => {
    for (const [socket, connection] of this.connections) {
      if (connection.jobId === event.job_id && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'status', ...event }));
      }
    }
  };

  private disconnect = () => {
    for (const socket of this.connections.keys()) socket.close(1012, 'Notifications reconnecting');
  };

  onModuleDestroy() {
    this.server?.off('upgrade', this.upgrade);
    this.notifications.events.off('status', this.notify);
    this.notifications.events.off('disconnected', this.disconnect);
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const socket of this.connections.keys()) socket.terminate();
    this.sockets.close();
  }
}
