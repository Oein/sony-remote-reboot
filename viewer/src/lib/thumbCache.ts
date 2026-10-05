import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { useEffect, useState } from 'react';

import type { CameraClient, PhotoItem } from '@/lib/camera';

/**
 * Thumbnail cache: the gallery's small thumbnails are kept on the phone so photos already seen
 * show at once and don't cost the camera's slow Wi-Fi again. Only thumbnails: previews and
 * originals are not stored. The user picks the size limit; past it the least recently used go.
 */

const DIR = new Directory(Paths.cache, 'thumbs');
const INDEX = new File(DIR, 'index.json');
const LIMIT_KEY = 'thumbCacheMaxMB';
/** At most this many downloads at once: the camera serves slowly. */
const MAX_PARALLEL = 3;

export const CACHE_SIZES_MB = [50, 100, 200, 500, 1000];
export const DEFAULT_CACHE_MB = 100;

type Entry = { size: number; used: number };

let index: Record<string, Entry> | null = null;
let maxBytes = DEFAULT_CACHE_MB * 1024 * 1024;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const pending = new Map<string, Promise<string | null>>();
const waiting: (() => void)[] = [];
let running = 0;
const listeners = new Set<() => void>();

AsyncStorage.getItem(LIMIT_KEY).then((saved) => {
  const mb = Number(saved);
  if (mb > 0) maxBytes = mb * 1024 * 1024;
});

function entries() {
  if (index) return index;
  try {
    if (!DIR.exists) DIR.create({ intermediates: true });
    index = INDEX.exists ? (JSON.parse(INDEX.textSync()) as Record<string, Entry>) : {};
  } catch {
    index = {};
  }
  return index;
}

function save() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      INDEX.write(JSON.stringify(entries()));
    } catch {
      // A lost index only means files get downloaded again
    }
  }, 1000);
  listeners.forEach((l) => l());
}

function keyFor(item: PhotoItem) {
  // Photo ids can be reused after the card is formatted: the capture time tells them apart
  return `${item.id}-${item.date}.jpg`;
}

/** Drops the least recently used thumbnails until the cache fits its limit. */
function evict() {
  const all = entries();
  let total = Object.values(all).reduce((sum, e) => sum + e.size, 0);
  const oldest = Object.keys(all).sort((a, b) => all[a].used - all[b].used);
  for (const name of oldest) {
    if (total <= maxBytes) break;
    total -= all[name].size;
    delete all[name];
    try {
      new File(DIR, name).delete();
    } catch {
      // Already gone
    }
  }
}

function slot<T>(work: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      running++;
      work()
        .then(resolve, reject)
        .finally(() => {
          running--;
          waiting.shift()?.();
        });
    };
    if (running < MAX_PARALLEL) start();
    else waiting.push(start);
  });
}

/** Local file URI of the photo's thumbnail, downloading it into the cache if needed; null if unavailable. */
export function cachedThumb(client: CameraClient, item: PhotoItem): Promise<string | null> {
  const name = keyFor(item);
  const all = entries();
  const file = new File(DIR, name);
  if (all[name] && file.exists) {
    all[name].used = Date.now();
    save();
    return Promise.resolve(file.uri);
  }
  const inFlight = pending.get(name);
  if (inFlight) return inFlight;
  const job = slot(async () => {
    try {
      if (file.exists) file.delete();
      const downloaded = await File.downloadFileAsync(client.smallUrl(item.id, item.date), file);
      all[name] = { size: downloaded.size ?? 0, used: Date.now() };
      evict();
      save();
      return downloaded.uri;
    } catch {
      return null;
    } finally {
      pending.delete(name);
    }
  });
  pending.set(name, job);
  return job;
}

/** The thumbnail's local URI once it's in the cache (undefined until then). */
export function useThumb(client: CameraClient, item: PhotoItem | null | undefined) {
  const [uri, setUri] = useState<{ key: string; uri: string } | null>(null);
  const key = item ? keyFor(item) : '';
  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    cachedThumb(client, item).then((u) => {
      if (!cancelled && u) setUri({ key: keyFor(item), uri: u });
    });
    return () => {
      cancelled = true;
    };
  }, [client, item]);
  return uri && uri.key === key ? uri.uri : undefined;
}

export function cacheUsage() {
  return Object.values(entries()).reduce((sum, e) => sum + e.size, 0);
}

export function cacheLimitMB() {
  return Math.round(maxBytes / 1024 / 1024);
}

export function setCacheLimitMB(mb: number) {
  maxBytes = mb * 1024 * 1024;
  AsyncStorage.setItem(LIMIT_KEY, String(mb));
  evict();
  save();
}

export function clearThumbCache() {
  const all = entries();
  for (const name of Object.keys(all)) delete all[name];
  try {
    if (DIR.exists) DIR.delete();
    DIR.create({ intermediates: true });
  } catch {
    // Nothing more to do
  }
  save();
}

/** Re-renders when the cache's contents or limit change. */
export function useCacheInfo() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return { used: cacheUsage(), limitMB: cacheLimitMB() };
}
