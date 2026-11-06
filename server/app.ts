import express, { type NextFunction, type Request, type Response } from 'express';
import { ALERT_TYPES, MEMBER_ROLES, MEMBER_STATUSES } from './types.js';
import type { AlertStatus, AlertType, MemberRole, MemberStatus } from './types.js';
import type { FamGuardStore } from './store.js';

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function requireBody(req: Request): Record<string, unknown> {
  const body: unknown = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }
  return body as Record<string, unknown>;
}

function requireParam(req: Request, name: string): string {
  const value: unknown = req.params[name];
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new HttpError(404, 'Resource not found.');
  }
  return raw;
}

function requireString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpError(400, `"${field}" is required and must be a non-empty string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new HttpError(400, `"${field}" must be at most ${maxLength} characters.`);
  }
  return trimmed;
}

function requireEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new HttpError(400, `"${field}" must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

export function createApp(store: FamGuardStore) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
  });

  app.get('/api/overview', (_req: Request, res: Response) => {
    res.json(store.overview());
  });

  app.get('/api/members', (_req: Request, res: Response) => {
    const members = store.listMembers().map((member) => ({
      ...member,
      openAlerts: store.openAlertCount(member.id),
    }));
    res.json({ members });
  });

  app.post('/api/members', (req: Request, res: Response) => {
    const body = requireBody(req);
    const name = requireString(body.name, 'name', 80);
    const role: MemberRole = requireEnum(body.role, 'role', MEMBER_ROLES);
    const member = store.addMember({ name, role });
    res.status(201).json({ member });
  });

  app.get('/api/members/:id', (req: Request, res: Response) => {
    const member = store.getMember(req.params.id ?? '');
    if (!member) throw new HttpError(404, 'Family member not found.');
    res.json({ member, openAlerts: store.openAlertCount(member.id) });
  });

  app.patch('/api/members/:id/checkin', (req: Request, res: Response) => {
    const member = store.checkIn(req.params.id ?? '');
    if (!member) throw new HttpError(404, 'Family member not found.');
    res.json({ member });
  });

  app.patch('/api/members/:id/status', (req: Request, res: Response) => {
    const body = requireBody(req);
    const status: MemberStatus = requireEnum(body.status, 'status', MEMBER_STATUSES);
    const member = store.setStatus(req.params.id ?? '', status);
    if (!member) throw new HttpError(404, 'Family member not found.');
    res.json({ member });
  });

  app.get('/api/alerts', (req: Request, res: Response) => {
    const statusParam = req.query.status;
    const status: AlertStatus | undefined =
      statusParam === undefined ? undefined : requireEnum(statusParam, 'status', ['open', 'acknowledged'] as const);
    const memberId = typeof req.query.memberId === 'string' ? req.query.memberId : undefined;
    const alerts = store.listAlerts({ status, memberId });
    res.json({ alerts });
  });

  app.post('/api/alerts', (req: Request, res: Response) => {
    const body = requireBody(req);
    const memberId = requireString(body.memberId, 'memberId', 120);
    const type: AlertType = requireEnum(body.type, 'type', ALERT_TYPES);
    const message = requireString(body.message, 'message', 280);
    const alert = store.createAlert({ memberId, type, message });
    if (!alert) throw new HttpError(404, 'Family member not found.');
    res.status(201).json({ alert });
  });

  app.patch('/api/alerts/:id/acknowledge', (req: Request, res: Response) => {
    const alert = store.acknowledgeAlert(req.params.id ?? '');
    if (!alert) throw new HttpError(404, 'Alert not found.');
    res.json({ alert });
  });

  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Endpoint not found.' });
  });

  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: 'Request body must be valid JSON.' });
      return;
    }
    console.error('Unhandled API error:', error);
    res.status(500).json({ error: 'Unexpected server error.' });
  });

  return app;
}
