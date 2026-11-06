import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface SupabasePublicConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

/** Configuration problem that the UI can show verbatim. */
export class ConfigError extends Error {
  readonly problems: string[];

  constructor(message: string, problems: string[] = []) {
    super(message);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

function readProblems(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const problems = (payload as { problems?: unknown }).problems;
  if (!Array.isArray(problems)) return [];
  return problems.filter((problem): problem is string => typeof problem === 'string');
}

/**
 * Reads the browser-safe Supabase settings from the FamGuard server.
 * Only the publishable key is served; no secret ever reaches the client.
 */
export async function fetchSupabaseConfig(): Promise<SupabasePublicConfig> {
  let response: Response;
  try {
    response = await fetch('/api/config', { headers: { Accept: 'application/json' } });
  } catch {
    throw new ConfigError('Could not reach the FamGuard server to load Supabase settings.');
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const problems = readProblems(payload);
    throw new ConfigError(
      problems.length > 0
        ? 'Supabase settings are missing on the server.'
        : `Configuration request failed with status ${response.status}.`,
      problems,
    );
  }

  if (!payload || typeof payload !== 'object') {
    throw new ConfigError('The server returned an empty Supabase configuration.');
  }

  const { supabaseUrl, supabasePublishableKey } = payload as Partial<SupabasePublicConfig>;
  if (typeof supabaseUrl !== 'string' || typeof supabasePublishableKey !== 'string') {
    throw new ConfigError('The Supabase configuration is incomplete.');
  }

  return { supabaseUrl, supabasePublishableKey };
}

export function createSupabaseClient(config: SupabasePublicConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}
