/**
 * Address geocoding, in the browser.
 *
 * The US Census Bureau geocoder is public domain, needs no key, and covers the
 * United States only - which is exactly FortyGuard's coverage, so an address it
 * cannot resolve is very likely one we could not answer for anyway.
 *
 * It does not send CORS headers, so a plain fetch from a page is blocked. It
 * does honour a `callback` parameter, so we load it as JSONP. That keeps the
 * whole application static: no server, no proxy, no key.
 */

export interface GeocodeMatch {
  matchedAddress: string;
  lat: number;
  lon: number;
}

export class GeocodeError extends Error {
  constructor(
    message: string,
    readonly kind: "no-match" | "network" | "timeout",
  ) {
    super(message);
    this.name = "GeocodeError";
  }
}

const ENDPOINT = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
let counter = 0;

interface CensusResponse {
  result?: {
    addressMatches?: {
      matchedAddress: string;
      coordinates: { x: number; y: number };
    }[];
  };
}

export function geocode(address: string, timeoutMs = 12_000): Promise<GeocodeMatch> {
  const query = address.trim();
  if (!query) {
    return Promise.reject(new GeocodeError("Enter an address to look up.", "no-match"));
  }

  return new Promise((resolve, reject) => {
    const name = `__tddGeo${Date.now().toString(36)}${counter++}`;
    const script = document.createElement("script");
    let settled = false;

    const cleanup = () => {
      delete (window as unknown as Record<string, unknown>)[name];
      script.remove();
      clearTimeout(timer);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new GeocodeError("The address lookup service did not respond.", "timeout"));
    }, timeoutMs);

    (window as unknown as Record<string, unknown>)[name] = (data: CensusResponse) => {
      if (settled) return;
      settled = true;
      cleanup();
      const match = data?.result?.addressMatches?.[0];
      if (!match) {
        reject(
          new GeocodeError(
            "No US address matched that. Try including the city and state, for example “5100 Bellaire Blvd, Bellaire, TX”.",
            "no-match",
          ),
        );
        return;
      }
      resolve({
        matchedAddress: match.matchedAddress,
        // Census returns x as longitude and y as latitude. Swapping these is
        // the classic way to end up querying the middle of the ocean.
        lat: match.coordinates.y,
        lon: match.coordinates.x,
      });
    };

    script.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new GeocodeError("Could not reach the address lookup service.", "network"));
    };

    script.src =
      `${ENDPOINT}?address=${encodeURIComponent(query)}` +
      `&benchmark=Public_AR_Current&format=json&callback=${name}`;
    document.head.appendChild(script);
  });
}
