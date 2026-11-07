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
