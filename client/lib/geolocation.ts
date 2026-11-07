export interface BrowserLocation {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}

export interface PositionOptions {
  timeout?: number;
  maximumAge?: number;
  enableHighAccuracy?: boolean;
}

const DEFAULT_POSITION_TIMEOUT_MS = 15000;
const DEFAULT_POSITION_MAX_AGE_MS = 30000;

export function currentPosition(options: PositionOptions = {}): Promise<BrowserLocation> {
  const {
    timeout = DEFAULT_POSITION_TIMEOUT_MS,
    maximumAge = DEFAULT_POSITION_MAX_AGE_MS,
    enableHighAccuracy = true,
  } = options;

  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('This browser does not expose the Geolocation API.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
        });
      },
      (error) => reject(new Error(describePositionError(error))),
      { enableHighAccuracy, timeout, maximumAge },
    );
  });
}

/**
 * Resolves with `work`, or rejects once `budgetMs` elapses. Keeps safety-critical
 * paths (the SOS button) from waiting on a sensor that may never answer.
 */
export function withDeadline<T>(work: Promise<T>, budgetMs: number, message?: string): Promise<T> {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) return work;

  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(message ?? `Operation exceeded ${budgetMs} ms.`)),
      budgetMs,
    );
  });

  return Promise.race([work, deadline]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

/** How long an SOS waits for coordinates before it is submitted without them. */
export const SOS_POSITION_BUDGET_MS = 3000;

/**
 * Position lookup for the SOS path: bounded to roughly three seconds and never
 * served from cache, so an emergency alert carries current coordinates or none.
 * A rejection here is expected and handled by the caller, which still sends the alert.
 */
export function currentPositionForSos(): Promise<BrowserLocation> {
  return withDeadline(
    currentPosition({ timeout: SOS_POSITION_BUDGET_MS, maximumAge: 0 }),
    SOS_POSITION_BUDGET_MS + 250,
    'Location lookup took longer than 3 seconds.',
  );
}

function describePositionError(error: GeolocationPositionError): string {
  switch (error.code) {
    case 1:
      return 'Location permission was denied. Allow location access for this site, then try again.';
    case 2:
      return 'Your device could not determine a location right now.';
    case 3:
      return 'Getting your location timed out. Try again.';
    default:
      return error.message.length > 0 ? error.message : 'Could not read your location.';
  }
}

interface BatteryLike {
  level: number;
}

export async function batteryPercent(): Promise<number | null> {
  if (typeof navigator === 'undefined') return null;
  const withBattery = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
  if (typeof withBattery.getBattery !== 'function') return null;

  try {
    const battery = await withBattery.getBattery();
    if (!Number.isFinite(battery.level)) return null;
    return Math.round(battery.level * 100);
  } catch {
    return null;
  }
}
