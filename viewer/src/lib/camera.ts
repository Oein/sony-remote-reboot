/** Client for the HTTP API served by ILCE Remote on the camera (port 8080). */

export const DEFAULT_HOST = '192.168.122.1';
export const PORT = 8080;

export type CameraInfo = {
  app: string;
  appVersion: string;
  model: string;
  firmware: string;
  pmcaApi: number;
  android: string;
};

export type CameraMode = 'auto' | 'program' | 'aperture' | 'shutter' | 'manual' | 'other';

export type MagnifierState = { on: boolean; factor: number; x: number; y: number };

/** Width / height of an aspect like "3:2"; 16:9 if unknown. */
export function aspectRatio(aspect: string | undefined): number {
  const [w, h] = (aspect ?? '').split(':').map(Number);
  return w > 0 && h > 0 ? w / h : 16 / 9;
}

export type CameraState = {
  mode: CameraMode;
  sceneMode: string;
  sceneModeValues: string[];
  iso: number;
  isoValues: number[];
  shutter: [number, number];
  shutterText: string;
  aperture: number;
  ev: number;
  evMin: number;
  evMax: number;
  evStep: number;
  whiteBalance: string;
  whiteBalanceValues: string[];
  driveMode: string;
  driveModeValues: string[];
  selfTimer?: number;
  selfTimerValues?: number[];
  focusMode: string;
  focusModeValues?: string[];
  /** "af-s" / "af-c" while focusMode is auto. */
  afMode?: string;
  /** Whether the lens can be focused from the app (otherwise MF is by the focus ring). */
  focusDriveSupported?: boolean;
  focusPosition?: number;
  focusMaxPosition?: number;
  colorTemperature?: number;
  colorTemperatureMin?: number;
  colorTemperatureMax?: number;
  /** White balance fine tuning: amber (-) .. blue (+). */
  wbAB?: number;
  wbABMin?: number;
  wbABMax?: number;
  /** White balance fine tuning: green (-) .. magenta (+). */
  wbGM?: number;
  wbGMMin?: number;
  wbGMMax?: number;
  /** Latest AF result; areas are fractions of the (unrotated) frame. */
  af?: { status: 'lock' | 'warn' | 'working' | 'clear' | 'continuous' | 'none'; areas: AfArea[] };
  /** Camera battery 0..100, -1 if unknown. */
  battery?: number;
  /** Photos that still fit on the card at the current settings, -1 if unknown. */
  shotsLeft?: number;
  /** Optical zoom as magnification x100: now, and at the long end (100 = widest; max 100 = no zoom lens). */
  zoom?: { magnification: number; max: number };
  /** Focus magnifier; x / y are the window center, -1000..1000 from the frame center. */
  magnifier?: MagnifierState;
  /** Photo aspect ratio, "3:2" or "16:9"; the live view frames have the same shape. */
  imageAspect?: string;
  /** Clockwise turn that makes the live view upright (camera's accelerometer), -1 if unknown. */
  orientation?: number;
  /** Raw roll value from the camera body (see rollToDegrees). */
  roll?: number;
  errors?: Record<string, string>;
};

export type AfArea = { x: number; y: number; w: number; h: number };

export type CameraChanges = Partial<{
  sceneMode: string;
  iso: number;
  ev: number;
  whiteBalance: string;
  driveMode: string;
  selfTimer: number;
  shutter: string;
  shutterStep: number;
  aperture: number;
  apertureStep: number;
  focusMode: string;
  colorTemperature: number;
  wbAB: number;
  wbGM: number;
}>;

export type PhotoItem = {
  id: number;
  folder: number;
  file: number;
  /** Camera-local wall clock time as epoch ms. */
  date: number;
  jpeg: boolean;
  raw: boolean;
};

export type PhotoList = { total: number; offset: number; items: PhotoItem[] };

export type PhotoDetails = {
  id: number;
  name: string;
  folder: string;
  date: string;
  width: number;
  height: number;
  /** EXIF orientation: 1 normal, 3 = 180°, 6 = 90° CW, 8 = 90° CCW. */
  orientation: number;
  aperture: number;
  exposureTime: number;
  focalLength: number;
  iso: number;
};

export type ShutterResult = { status: 'ok' | 'canceled' | 'error' | 'timeout'; ms: number };

export class CameraError extends Error {}

export function baseUrl(host: string) {
  return `http://${host}:${PORT}`;
}

async function request<T>(host: string, path: string, init?: RequestInit, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(baseUrl(host) + path, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new CameraError(`${path}: HTTP ${response.status} ${await response.text()}`);
    }
    return (await response.json()) as T;
  } catch (e) {
    if (e instanceof CameraError) throw e;
    throw new CameraError(controller.signal.aborted ? `${path}: timed out` : `${path}: ${String(e)}`);
  } finally {
    clearTimeout(timer);
  }
}

function post<T>(host: string, path: string, body?: unknown, timeoutMs?: number) {
  return request<T>(
    host,
    path,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) },
    timeoutMs,
  );
}

export function createCameraClient(host: string) {
  return {
    host,
    info: () => request<CameraInfo>(host, '/api/info', undefined, 3000),
    state: () => request<CameraState>(host, '/api/camera'),
    /** Shutter/aperture steps wait for the camera, so allow extra time. */
    apply: (changes: CameraChanges) => post<CameraState>(host, '/api/camera', changes, 20000),
    shoot: () => post<ShutterResult>(host, '/api/camera/shutter', undefined, 35000),
    /** Half-press: "start" focuses and locks (resolves when AF is done), "stop" releases. */
    focus: (action: 'start' | 'stop') =>
      post<{ focusing: boolean; focused: boolean; timeout: boolean }>(host, '/api/camera/focus', { action }, 6000),
    focusDrive: (direction: 'near' | 'far', speed = 0) =>
      post<{ position: number; max: number }>(host, '/api/camera/focusdrive', { direction, speed }),
    zoom: (direction: 'tele' | 'wide' | 'stop', speed = 0) => post<{ zoom: string }>(host, '/api/camera/zoom', { direction, speed }),
    /** Zoom to a position, 0 widest .. 1 longest; the camera drives the lens there. */
    zoomTo: (target: number) => post<{ target: number }>(host, '/api/camera/zoom', { target }),
    /** Focus magnifier: cycle (off -> levels -> off), off, center, or pan by fractions of the view. */
    magnify: (action: 'cycle' | 'off' | 'center' | 'pan', dx = 0, dy = 0) =>
      post<MagnifierState>(host, '/api/camera/magnify', { action, dx, dy }),
    photos: (offset: number, limit: number) => request<PhotoList>(host, `/api/photos?offset=${offset}&limit=${limit}`),
    photo: (id: number) => request<PhotoDetails>(host, `/api/photos/${id}`),
    liveViewUrl: () => `${baseUrl(host)}/api/liveview`,
    // Photo ids can be reused after the card is formatted, and images are cached by URL, so the
    // capture time goes into the URL as a version (the camera ignores the query)
    smallUrl: (id: number, version?: string | number) => photoUrl(host, id, 'small', version),
    previewUrl: (id: number, version?: string | number) => photoUrl(host, id, 'preview', version),
    fullUrl: (id: number) => `${baseUrl(host)}/api/photos/${id}/full`,
  };
}

function photoUrl(host: string, id: number, kind: string, version?: string | number) {
  const url = `${baseUrl(host)}/api/photos/${id}/${kind}`;
  return version === undefined ? url : `${url}?v=${encodeURIComponent(String(version))}`;
}

export type CameraClient = ReturnType<typeof createCameraClient>;

/** "1/250", "2\"" etc. from an exposure time in seconds. */
export function formatExposure(seconds: number) {
  if (seconds <= 0) return '-';
  if (seconds >= 0.4) return `${Math.round(seconds * 10) / 10}"`;
  return `1/${Math.round(1 / seconds)}`;
}

/** EV index (in evStep units) as "+0.7" / "-1.0" / "±0.0". */
export function formatEv(index: number, step: number) {
  const value = index * step;
  if (Math.abs(value) < 0.05) return '±0.0';
  return `${value > 0 ? '+' : '-'}${Math.abs(value).toFixed(1)}`;
}

/**
 * Degrees to turn the live view so it appears upright, from the camera's raw roll value.
 * Assumes the display manager reports quarter turns 0..3 clockwise; confirm against the camera's
 * "Camera roll" log lines and adjust if it uses another encoding.
 */
export function rollToDegrees(roll: number | undefined) {
  switch (roll) {
    case 1:
      return 90;
    case 2:
      return 180;
    case 3:
      return 270;
    default:
      return 0;
  }
}

/** An AF area of the camera frame, as placed after the live view is turned by {@code rotation}. */
/** A point on the rotated live view (fractions) back in the camera frame (inverse of rotateArea). */
export function unrotatePoint(u: number, v: number, rotation: number): { x: number; y: number } {
  switch (rotation) {
    case 90:
      return { x: v, y: 1 - u };
    case 180:
      return { x: 1 - u, y: 1 - v };
    case 270:
      return { x: 1 - v, y: u };
    default:
      return { x: u, y: v };
  }
}

export function rotateArea(a: AfArea, rotation: number): AfArea {
  switch (rotation) {
    case 90:
      return { x: 1 - (a.y + a.h), y: a.x, w: a.h, h: a.w };
    case 180:
      return { x: 1 - (a.x + a.w), y: 1 - (a.y + a.h), w: a.w, h: a.h };
    case 270:
      return { x: a.y, y: 1 - (a.x + a.w), w: a.h, h: a.w };
    default:
      return a;
  }
}
