const MB_BASE = "https://musicbrainz.org/ws/2";
const MB_USER_AGENT = "Grub/1.0 (sthefanyflorianog@gmail.com)";
const DISCOGS_BASE = "https://api.discogs.com";
const SPOTIFY_ACCOUNTS_BASE = "https://accounts.spotify.com/api";
const SPOTIFY_API_BASE = "https://api.spotify.com/v1";

let spotifyTokenCache:
  | {
      accessToken: string;
      expiresAt: number;
    }
  | null = null;

export interface MusicBrainzCandidate {
  id: string;
  name: string;
  score: number;
  country?: string;
  disambiguation?: string;
  tags: string[];
}

export interface DiscogsCandidate {
  id: string;
  title: string;
  genres: string[];
  styles: string[];
  year?: string | number;
}

export interface SpotifyCandidate {
  id: string;
  name: string;
  popularity: number;
  genres: string[];
}

async function jsonFetch<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Upstream ${response.status} ${response.statusText} for ${url}`);
  }
  return (await response.json()) as T;
}

function isRecoverableSpotifyError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /Upstream (401|403|429)\b/.test(error.message);
}

export async function searchMusicBrainzArtist(
  artistName: string,
): Promise<MusicBrainzCandidate[]> {
  const query = encodeURIComponent(`artist:${artistName}`);
  const url = `${MB_BASE}/artist?query=${query}&fmt=json&limit=5`;
  const data = await jsonFetch<{ artists?: Array<Record<string, unknown>> }>(url, {
    headers: { "User-Agent": MB_USER_AGENT },
  });

  return (data.artists ?? []).map((artist) => ({
    id: String(artist.id ?? ""),
    name: String(artist.name ?? artist.sort_name ?? ""),
    score: Number(artist.score ?? 0),
    country: typeof artist.country === "string" ? artist.country : undefined,
    disambiguation:
      typeof artist.disambiguation === "string"
        ? artist.disambiguation
        : undefined,
    tags: Array.isArray(artist.tags)
      ? artist.tags
          .map((tag) => {
            if (!tag || typeof tag !== "object") return null;
            const name = (tag as Record<string, unknown>).name;
            return typeof name === "string" ? name : null;
          })
          .filter((value): value is string => Boolean(value))
      : [],
  }));
}

export async function searchDiscogsArtist(
  artistName: string,
): Promise<DiscogsCandidate[]> {
  const token = Deno.env.get("DISCOGS_USER_TOKEN") ?? "";
  const consumerKey = Deno.env.get("DISCOGS_CONSUMER_KEY") ?? "";
  const consumerSecret = Deno.env.get("DISCOGS_CONSUMER_SECRET") ?? "";
  if (!token && (!consumerKey || !consumerSecret)) return [];

  const url = new URL(`${DISCOGS_BASE}/database/search`);
  url.searchParams.set("type", "artist");
  url.searchParams.set("q", artistName);
  url.searchParams.set("per_page", "5");
  if (!token && consumerKey && consumerSecret) {
    url.searchParams.set("key", consumerKey);
    url.searchParams.set("secret", consumerSecret);
  }

  const data = await jsonFetch<{ results?: Array<Record<string, unknown>> }>(
    url.toString(),
    {
      headers: {
        "User-Agent": MB_USER_AGENT,
        ...(token ? { Authorization: `Discogs token=${token}` } : {}),
      },
    },
  );

  return (data.results ?? []).map((item) => ({
    id: String(item.id ?? ""),
    title: String(item.title ?? item.name ?? ""),
    genres: Array.isArray(item.genre)
      ? item.genre.filter((value): value is string => typeof value === "string")
      : [],
    styles: Array.isArray(item.style)
      ? item.style.filter((value): value is string => typeof value === "string")
      : [],
    year:
      typeof item.year === "string" || typeof item.year === "number"
        ? item.year
        : undefined,
  }));
}

async function getSpotifyAccessToken(): Promise<string | null> {
  const clientId = Deno.env.get("SPOTIFY_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("SPOTIFY_CLIENT_SECRET") ?? "";

  if (!clientId || !clientSecret) return null;

  if (spotifyTokenCache && spotifyTokenCache.expiresAt > Date.now() + 30_000) {
    return spotifyTokenCache.accessToken;
  }

  const credentials = btoa(`${clientId}:${clientSecret}`);
  const response = await fetch(`${SPOTIFY_ACCOUNTS_BASE}/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });

  if (!response.ok) return null;

  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!data.access_token) return null;

  spotifyTokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };

  return spotifyTokenCache.accessToken;
}

export async function searchSpotifyArtist(
  artistName: string,
): Promise<SpotifyCandidate[]> {
  const accessToken = await getSpotifyAccessToken();
  if (!accessToken) return [];

  const url = new URL(`${SPOTIFY_API_BASE}/search`);
  url.searchParams.set("q", artistName);
  url.searchParams.set("type", "artist");
  url.searchParams.set("limit", "3");

  let data: {
    artists?: { items?: Array<Record<string, unknown>> };
  };

  try {
    data = await jsonFetch<{
      artists?: { items?: Array<Record<string, unknown>> };
    }>(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch (error) {
    if (isRecoverableSpotifyError(error)) {
      spotifyTokenCache = null;
      console.warn("[music-provider-clients] spotify fallback disabled for this request", error);
      return [];
    }
    throw error;
  }

  return (data.artists?.items ?? []).map((artist) => ({
    id: String(artist.id ?? ""),
    name: String(artist.name ?? ""),
    popularity: Number(artist.popularity ?? 0),
    genres: Array.isArray(artist.genres)
      ? artist.genres.filter((value): value is string => typeof value === "string")
      : [],
  }));
}
