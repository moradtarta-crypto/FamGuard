export interface DbErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

export interface DescribedError {
  message: string;
  code: string | null;
  /** True when the database refused the operation because of privileges or row level security. */
  blockedByPolicy: boolean;
}

/**
 * Turns a PostgREST/Postgres error into an honest, actionable sentence.
 *
 * The app never tries to work around a refusal: when the database says no, the
 * screen says which table was refused and that a project owner must review the
 * policy. No RLS change is attempted from the client.
 */
export function describeDbError(error: DbErrorLike | null, action: string): DescribedError {
  if (!error) {
    return {
      message: `Could not ${action}: the database returned no result.`,
      code: null,
      blockedByPolicy: false,
    };
  }

  const code = error.code ?? null;
  const raw = (error.message ?? '').trim();
  const lower = raw.toLowerCase();

  if (code === '42501' || lower.includes('row-level security') || lower.includes('permission denied')) {
    return {
      message:
        `Could not ${action}: your Supabase row level security policies refused this operation. ` +
        'FamGuard does not change your database — a project owner needs to review the policy for this table.',
      code,
      blockedByPolicy: true,
    };
  }

  if (code === '42P01') {
    return {
      message: `Could not ${action}: a required table is missing from the public schema.`,
      code,
      blockedByPolicy: false,
    };
  }

  if (code === '42703') {
    return {
      message: `Could not ${action}: a column used by this screen does not exist. The app expects the verified FamGuard schema.`,
      code,
      blockedByPolicy: false,
    };
  }

  if (code === '23503') {
    return {
      message: `Could not ${action}: the record refers to a family or user that does not exist.`,
      code,
      blockedByPolicy: false,
    };
  }

  if (code === '23505') {
    return {
      message: `Could not ${action}: a record with the same key already exists.`,
      code,
      blockedByPolicy: false,
    };
  }

  if (code === '23514') {
    return {
      message: `Could not ${action}: a database check constraint rejected these values.`,
      code,
      blockedByPolicy: false,
    };
  }

  if (code === '22P02') {
    return {
      message: `Could not ${action}: a value did not match the expected database type (an enum value or an id).`,
      code,
      blockedByPolicy: false,
    };
  }

  if (code === 'PGRST116') {
    return {
      message: `Could not ${action}: more rows were returned than expected.`,
      code,
      blockedByPolicy: false,
    };
  }

  if (code === 'PGRST301' || code === 'PGRST302' || lower.includes('jwt')) {
    return {
      message: `Could not ${action}: your session is no longer valid. Sign in again.`,
      code,
      blockedByPolicy: false,
    };
  }

  return {
    message: `Could not ${action}: ${raw.length > 0 ? raw : 'the database request failed.'}`,
    code,
    blockedByPolicy: false,
  };
}

/** Reads a database error code from any thrown value, for diagnostics only. */
export function errorCode(cause: unknown): string | null {
  if (cause && typeof cause === 'object' && 'code' in cause) {
    const value = (cause as { code?: unknown }).code;
    if (typeof value === 'string') return value;
  }
  return null;
}
