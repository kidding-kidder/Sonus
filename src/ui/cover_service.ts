const artworkCache = new Map<string, string | null>();

/**
 * Clean artist and track title for music metadata search queries
 */
export function cleanQueryText(text: string): string {
  if (!text) return "";
  return text
    .replace(/^\d+[\s.-]+/, "") // Strip leading track numbering (e.g., "01 - ", "1. ")
    .replace(/\.(mp3|flac|wav|m4a|ogg|opus)$/i, "") // Strip audio extensions
    .replace(/\([^)]*?\)/g, "") // Strip parenthesis content
    .replace(/\[[^\]]*?\]/g, "") // Strip brackets content
    .replace(/\b(feat\.|ft\.|prod\.|prod by)\b.*/i, "") // Strip featured artist tags
    .replace(/\b(official|music video|video|audio|visualizer|remastered|lyrics|4k|hd|hq)\b/gi, "")
    .replace(/[\-_/\\|]/g, " ") // Replace dashes/slashes with spaces
    .replace(/\s+/g, " ")
    .trim();
}

export function getCachedArtwork(artist: string, title: string): string | null {
  const cleanTitle = cleanQueryText(title);
  const cleanArtist = cleanQueryText(artist);
  const key = `${cleanArtist} - ${cleanTitle}`.toLowerCase();
  return artworkCache.get(key) ?? null;
}

async function queryItunes(term: string): Promise<string | null> {
  if (!term.trim()) return null;
  try {
    const query = encodeURIComponent(term.trim());
    const res = await fetch(`https://itunes.apple.com/search?term=${query}&entity=song&limit=1`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(2400),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      const rawUrl: string = data.results[0]?.artworkUrl100 ?? "";
      if (rawUrl) return rawUrl.replace("100x100bb", "200x200bb");
    }
  } catch {}
  return null;
}

async function queryDeezer(term: string): Promise<string | null> {
  if (!term.trim()) return null;
  try {
    const query = encodeURIComponent(term.trim());
    const res = await fetch(`https://api.deezer.com/search?q=${query}&limit=1`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(2400),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.data && data.data.length > 0) {
      const album = data.data[0]?.album;
      const url = album?.cover_big || album?.cover_medium || album?.cover_small;
      if (url && typeof url === "string") return url;
    }
  } catch {}
  return null;
}

/**
 * Fetch high-resolution track artwork from iTunes and Deezer concurrently.
 */
export async function fetchTrackArtwork(artist: string, title: string): Promise<string | null> {
  const cleanTitle = cleanQueryText(title);
  const cleanArtist = cleanQueryText(artist);
  if (!cleanTitle && !cleanArtist) return null;

  const cacheKey = `${cleanArtist} - ${cleanTitle}`.toLowerCase();
  if (artworkCache.has(cacheKey)) {
    return artworkCache.get(cacheKey) ?? null;
  }

  const combined = cleanArtist && cleanTitle ? `${cleanArtist} ${cleanTitle}` : cleanTitle || cleanArtist;

  // Query iTunes and Deezer concurrently for maximum speed
  const [itunes, deezer] = await Promise.all([
    queryItunes(combined).catch(() => null),
    queryDeezer(combined).catch(() => null),
  ]);
  let cover = itunes || deezer;

  // Fallback with just title if both failed
  if (!cover && cleanTitle.length > 2) {
    const [itunesTitle, deezerTitle] = await Promise.all([
      queryItunes(cleanTitle).catch(() => null),
      queryDeezer(cleanTitle).catch(() => null),
    ]);
    cover = itunesTitle || deezerTitle;
  }

  if (artworkCache.size >= 150) {
    const oldest = artworkCache.keys().next().value;
    if (oldest !== undefined) artworkCache.delete(oldest);
  }
  artworkCache.set(cacheKey, cover);
  return cover;
}
