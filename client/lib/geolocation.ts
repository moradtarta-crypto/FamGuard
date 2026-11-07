export interface BrowserLocation {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}

export function currentPosition(): Promise<BrowserLocation> {
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
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  });
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
