/** Fetches and caches FIGfonts. */

import { parseFigFont, type FigFont } from "./figfont";
import { figFontUrl } from "./figfonts";

const cache = new Map<string, FigFont>();
const inFlight = new Map<string, Promise<FigFont>>();

export function getCachedFigFont(name: string): FigFont | null {
  return cache.get(name) ?? null;
}

export async function loadFigFont(
  name: string,
  signal?: AbortSignal
): Promise<FigFont> {
  const cached = cache.get(name);
  if (cached) return cached;

  const pending = inFlight.get(name);
  if (pending) return pending;

  const request = (async () => {
    const response = await fetch(figFontUrl(name), { signal });
    if (!response.ok) {
      throw new Error(`Could not load the ${name} font (${response.status}).`);
    }
    const font = parseFigFont(await response.text());
    cache.set(name, font);
    return font;
  })();

  inFlight.set(name, request);
  try {
    return await request;
  } finally {
    inFlight.delete(name);
  }
}
