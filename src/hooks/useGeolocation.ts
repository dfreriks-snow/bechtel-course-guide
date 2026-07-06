import { useEffect, useRef, useState } from "react";

export interface Fix {
  lat: number;
  lng: number;
  accuracy: number;
  heading: number | null;
  speed: number | null;
  ts: number;
}

export interface GeoState {
  fix: Fix | null;
  error: string | null;
  active: boolean;
}

/**
 * Continuously track device location while `enabled`.
 * Uses high-accuracy watchPosition (best for in-vehicle following).
 */
export function useGeolocation(enabled: boolean): GeoState {
  const [fix, setFix] = useState<Fix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
      return;
    }
    if (!("geolocation" in navigator)) {
      setError("Geolocation is not available on this device.");
      return;
    }
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        setError(null);
        setFix({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: pos.coords.heading ?? null,
          speed: pos.coords.speed ?? null,
          ts: pos.timestamp,
        });
      },
      (err) => setError(err.message),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
    return () => {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
    };
  }, [enabled]);

  return { fix, error, active: enabled && !!fix };
}
