import express, { type NextFunction, type Request, type Response } from 'express';

/** Browser-safe Supabase settings. Never contains a secret or service-role key. */
export interface SupabasePublicConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

export interface ConfigResult {
  config: SupabasePublicConfig | null;
  problems: string[];
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Rejects anything that is not safe to hand to a browser.
 * The app only ever needs the publishable (anon) key: row level security in the
 * user's existing Supabase project is the enforcement layer.
 */
export function keyRejectionReason(key: string): string | null {
  const trimmed = key.trim();
  if (trimmed.length === 0) return 'SUPABASE_PUBLISHABLE_KEY is empty.';
  if (trimmed.startsWith('sb_secret_')) {
    return 'SUPABASE_PUBLISHABLE_KEY is a secret key. Use the publishable key only.';
  }
  if (trimmed.toLowerCase().startsWith('service_role')) {
    return 'SUPABASE_PUBLISHABLE_KEY looks like a service-role key. Use the publishable key only.';
  }
  const payload = decodeJwtPayload(trimmed);
  if (payload && payload.role === 'service_role') {
    return 'SUPABASE_PUBLISHABLE_KEY is a service-role token. Use the publishable key only.';
  }
  return null;
}

export function readSupabaseConfig(env: NodeJS.ProcessEnv = process.env): ConfigResult {
  const problems: string[] = [];
  const url = (env.SUPABASE_URL ?? '').trim();
  const key = (env.SUPABASE_PUBLISHABLE_KEY ?? '').trim();

  if (url.length === 0) {
    problems.push('SUPABASE_URL is not set.');
  } else {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        problems.push('SUPABASE_URL must be an http(s) URL.');
      }
    } catch {
      problems.push('SUPABASE_URL is not a valid URL.');
    }
  }

  if (key.length === 0) {
    problems.push('SUPABASE_PUBLISHABLE_KEY is not set.');
  } else {
    const reason = keyRejectionReason(key);
    if (reason) problems.push(reason);
  }

  return {
    config:
      problems.length === 0 ? { supabaseUrl: url, supabasePublishableKey: key } : null,
    problems,
  };
}

export function createApp(env: NodeJS.ProcessEnv = process.env) {
  const app = express();
  app.disable('x-powered-by');

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
  });

  // Serves the browser-safe Supabase settings at runtime so rotating the
  // publishable key never requires rebuilding the client bundle.
  app.get('/api/config', (_req: Request, res: Response) => {
    const { config, problems } = readSupabaseConfig(env);
    res.setHeader('Cache-Control', 'no-store');
    if (!config) {
      res.status(503).json({ error: 'Supabase is not configured.', problems });
      return;
    }
    res.json(config);
  });

  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Endpoint not found.' });
  });

  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    console.error('Unhandled API error:', error);
    res.status(500).json({ error: 'Unexpected server error.' });
  });

  return app;
}
