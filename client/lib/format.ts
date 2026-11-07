export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelative(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return 'unknown time';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown time';

  const seconds = Math.round((now - then) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 90) return '1 min ago';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;

  return formatDateTime(iso);
}

export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_M = 6371008.8;

/** Great-circle distance in metres, used only for on-screen labels. */
export function distanceMeters(a: Coordinates, b: Coordinates): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = toRad(b.latitude - a.latitude);
  const deltaLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1] ?? '' : '';
  const value = `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
  return value.length > 0 ? value : '?';
}

export function formatBattery(percent: number | null | undefined): string {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) {
    return 'battery unknown';
  }
  return `battery ${Math.round(percent)}%`;
}

export function formatCoordinates(latitude: number, longitude: number): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}
