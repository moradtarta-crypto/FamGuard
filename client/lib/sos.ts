import type { SupabaseClient } from '@supabase/supabase-js';
import { raiseSos } from './data';
import { currentPositionForSos } from './geolocation';
import type { BrowserLocation } from './geolocation';
import type { SosEventRow } from './schema';

export interface NewSosRequest {
  familyId: string;
  childUserId: string;
  note: string | null;
}

export interface SosSubmission {
  event: SosEventRow;
  /** `null` when no position could be read; the alert is still recorded. */
  coordinates: BrowserLocation | null;
}

/**
 * Sends an SOS alert.
 *
 * Coordinates are best effort and bounded by `currentPositionForSos` (~3 seconds, never
 * cached). A denied permission, a missing sensor or a slow fix must never stop the alert
 * from being recorded, so a failed lookup is caught here and the row is written without
 * coordinates. Database failures still propagate so the screen can report them.
 */
export async function submitSos(
  client: SupabaseClient,
  request: NewSosRequest,
  locate: () => Promise<BrowserLocation> = currentPositionForSos,
): Promise<SosSubmission> {
  let coordinates: BrowserLocation | null = null;
  try {
    coordinates = await locate();
  } catch {
    coordinates = null;
  }

  const event = await raiseSos(client, {
    familyId: request.familyId,
    childUserId: request.childUserId,
    latitude: coordinates ? coordinates.latitude : null,
    longitude: coordinates ? coordinates.longitude : null,
    note: request.note,
  });

  return { event, coordinates };
}

/** Shown when the alert was stored but no position could be read for it. */
export const SOS_WITHOUT_LOCATION_WARNING =
  'The alert was saved, but your location could not be read, so your family cannot see where you are. Call them or share your location manually.';

export type SosOutcome =
  | { ok: true; submission: SosSubmission; warning: string | null }
  | { ok: false; error: string };

/**
 * The handler behind the SOS button.
 *
 * A stored alert is never reported as a failure: `submitSos` only rejects when the database
 * refused the row, so a missing position becomes a warning attached to a success instead of
 * an error. Real database failures still come back as `ok: false` with the database message,
 * so the screen can keep showing them as errors.
 */
export async function sendSosAlert(
  client: SupabaseClient,
  request: NewSosRequest,
  submit: (client: SupabaseClient, request: NewSosRequest) => Promise<SosSubmission> = submitSos,
): Promise<SosOutcome> {
  try {
    const submission = await submit(client, request);
    return {
      ok: true,
      submission,
      warning: submission.coordinates === null ? SOS_WITHOUT_LOCATION_WARNING : null,
    };
  } catch (cause) {
    return {
      ok: false,
      error:
        cause instanceof Error && cause.message.length > 0
          ? cause.message
          : 'Could not send the SOS alert.',
    };
  }
}
