// Mock of the ILCE Remote camera API, for developing the viewer without the camera.
// usage: npm run mock   (port 8080; samples from `swift mock/generate-samples.swift`)
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';

const PORT = Number(process.env.PORT ?? 8080);
const samples = new URL('./samples/', import.meta.url);
// Sources; the camera build minifies them (MOCK_WEB=dir serves a build instead, to check it)
const webApp = process.env.MOCK_WEB ? new URL(`file://${process.env.MOCK_WEB.replace(/\/?$/, '/')}`) : new URL('../../camera/web/', import.meta.url);
const read = (name) => readFileSync(new URL(name, samples));

const liveFrames = Array.from({ length: 20 }, (_, i) => read(`live-${String(i).padStart(2, '0')}.jpg`));
const sampleMeta = JSON.parse(read('photos.json'));

// Newest last; ids grow as "shots" are taken
const photos = sampleMeta.map((m, i) => ({ ...m, sample: m.id, taken: Date.UTC(2026, 8, 20 + (i % 8), 9 + i, 30) }));
let nextId = photos.length + 1;

const SHUTTER = [[30, 1], [15, 1], [8, 1], [4, 1], [2, 1], [1, 1], [1, 2], [1, 4], [1, 8], [1, 15], [1, 30], [1, 60], [1, 125], [1, 250], [1, 500], [1, 1000], [1, 2000], [1, 4000]];
const APERTURE = [3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 14, 16, 18, 20, 22];
const MODES = { 'program-auto': 'program', 'aperture-priority': 'aperture', 'shutter-speed': 'shutter', 'manual-exposure': 'manual', auto: 'auto' };

const state = {
  sceneMode: 'manual-exposure',
  sceneModeValues: ['program-auto', 'aperture-priority', 'shutter-speed', 'manual-exposure', 'auto', 'portrait', 'landscape', 'night', 'night-portrait', 'sunset', 'sports', 'hand-held-twilight', 'anti-motion-blur', 'macro'],
  iso: 400,
  isoValues: [0, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6400, 8000, 10000, 12800, 16000],
  shutterIndex: 12,
  apertureIndex: 4,
  ev: 0, evMin: -9, evMax: 9, evStep: 0.33333,
  whiteBalance: 'auto',
  whiteBalanceValues: ['auto', 'daylight', 'shade', 'cloudy-daylight', 'fluorescent-coolwhite', 'fluorescent-daywhite', 'fluorescent-daylight', 'warm-fluorescent', 'incandescent', 'flash', 'custom', 'color-temp', 'underwater-auto'],
  driveMode: 'single',
  driveModeValues: ['single', 'burst', 'bracket', 'speed-prior-burst'],
  selfTimer: 0,
  selfTimerValues: [0, 2, 10],
  focusMode: 'auto',
  magnifier: { on: false, factor: 1, x: 0, y: 0 },
  zoom: { magnification: 100, max: 312 },
  imageAspect: '16:9', // the mock's frames are 16:9
  focusModeValues: ['manual', 'auto', 'dmf'],
  afMode: 'af-s',
  focusDriveSupported: true,
  focusPosition: 40,
  focusMaxPosition: 100,
  colorTemperature: 5500, colorTemperatureMin: 2500, colorTemperatureMax: 9900,
  wbAB: 0, wbABMin: -7, wbABMax: 7,
  wbGM: 0, wbGMMin: -7, wbGMMax: 7,
  // Camera body roll; MOCK_ROLL cycles it to test the phone's live view rotation
  roll: Number(process.env.MOCK_ROLL ?? 0),
  // Like the α5000: no live orientation (-1); MOCK_ORIENTATION=0/90/180/270 fakes one
  orientation: Number(process.env.MOCK_ORIENTATION ?? -1),
  af: { status: 'none', areas: [] },
};

function cameraState() {
  const [n, d] = SHUTTER[state.shutterIndex];
  const { shutterIndex, apertureIndex, ...rest } = state;
  return {
    ...rest,
    mode: MODES[state.sceneMode] ?? 'other',
    shutter: [n, d],
    shutterText: n === 1 && d > 1 ? `1/${d}` : `${n / d}"`,
    aperture: APERTURE[state.apertureIndex],
  };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function apply(changes) {
  for (const key of ['sceneMode', 'iso', 'ev', 'whiteBalance', 'driveMode', 'selfTimer', 'focusMode', 'colorTemperature', 'wbAB', 'wbGM']) {
    if (key in changes) state[key] = changes[key];
  }
  if (changes.shutterStep) state.shutterIndex = clamp(state.shutterIndex + changes.shutterStep, 0, SHUTTER.length - 1);
  if (changes.apertureStep) state.apertureIndex = clamp(state.apertureIndex + changes.apertureStep, 0, APERTURE.length - 1);
  if (changes.shutter) {
    const [n, d] = String(changes.shutter).replace('"', '').split('/').map(Number);
    const target = d ? n / d : n;
    state.shutterIndex = SHUTTER.reduce((best, [sn, sd], i) => (Math.abs(sn / sd - target) < Math.abs(SHUTTER[best][0] / SHUTTER[best][1] - target) ? i : best), 0);
  }
  if (changes.aperture) state.apertureIndex = APERTURE.reduce((best, f, i) => (Math.abs(f - changes.aperture) < Math.abs(APERTURE[best] - changes.aperture) ? i : best), 0);
}

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
};
const jpeg = (res, data, cache = true) => {
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': data.length, 'Cache-Control': cache ? 'max-age=86400' : 'no-store' });
  res.end(data);
};
const body = (req) => new Promise((resolve) => {
  let data = '';
  req.on('data', (c) => (data += c));
  req.on('end', () => resolve(data ? JSON.parse(data) : {}));
});
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

let frameIndex = 0;
setInterval(() => (frameIndex = (frameIndex + 1) % liveFrames.length), 1000 / 12);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  const post = req.method === 'POST';
  console.log(req.method, req.url);
  try {
    if (path === '/api/info') {
      return json(res, 200, { app: 'ilce-remote', appVersion: 'mock', model: 'ILCE-5000', firmware: '1.10', pmcaApi: 3, android: '2.3.7' });
    }
    if (path === '/api/camera') {
      if (post) {
        const changes = await body(req);
        await delay(changes.shutterStep || changes.apertureStep || changes.shutter || changes.aperture ? 300 : 60);
        apply(changes);
      }
      return json(res, 200, cameraState());
    }
    if (path === '/api/camera/shutter' && post) {
      await delay(state.selfTimer * 1000 + 150);
      const sample = ((nextId - 1) % sampleMeta.length) + 1;
      photos.push({ ...sampleMeta[sample - 1], id: nextId++, sample, taken: Date.now() });
      return json(res, 200, { status: 'ok', ms: 150 });
    }
    if (path === '/api/camera/focus' && post) {
      const { action } = await body(req);
      await delay(action === 'stop' ? 30 : 450);
      // Pretend two AF points just above the centre came into focus
      state.af = action === 'stop'
        ? { status: 'clear', areas: [] }
        : { status: 'lock', areas: [{ x: 0.42, y: 0.36, w: 0.07, h: 0.1 }, { x: 0.51, y: 0.36, w: 0.07, h: 0.1 }] };
      return json(res, 200, { focusing: action !== 'stop', focused: action !== 'stop', timeout: false });
    }
    if (path === '/api/camera/focusdrive' && post) {
      const { direction } = await body(req);
      state.focusPosition = clamp(state.focusPosition + (direction === 'far' ? 2 : -2), 0, state.focusMaxPosition);
      return json(res, 200, { position: state.focusPosition, max: state.focusMaxPosition });
    }
    if (path === '/api/camera/magnify' && post) {
      const { action, dx = 0, dy = 0 } = await body(req);
      const m = state.magnifier;
      if (action === 'cycle') {
        m.factor = !m.on ? 5.9 : m.factor < 11 ? 11.7 : 1;
        m.on = m.factor > 1;
        if (!m.on) Object.assign(m, { x: 0, y: 0 });
      } else if (action === 'off') Object.assign(m, { on: false, factor: 1, x: 0, y: 0 });
      else if (action === 'center') Object.assign(m, { x: 0, y: 0 });
      else if (action === 'pan' && m.on) {
        const max = 1000 - 1000 / m.factor;
        m.x = clamp(Math.round(m.x + (dx * 2000) / m.factor), -max, max);
        m.y = clamp(Math.round(m.y + (dy * 2000) / m.factor), -max, max);
      }
      return json(res, 200, m);
    }
    if (path === '/api/camera/zoom' && post) {
      const { direction, target } = await body(req);
      if (typeof target === 'number') {
        state.zoom.magnification = Math.round(100 + clamp(target, 0, 1) * (state.zoom.max - 100));
        return json(res, 200, { target });
      }
      return json(res, 200, { zoom: direction });
    }
    if (path === '/api/liveview.jpg') return jpeg(res, liveFrames[frameIndex], false);
    if (path === '/api/liveview') {
      res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=ilceframe', 'Cache-Control': 'no-store' });
      let last = -1;
      const timer = setInterval(() => {
        if (frameIndex === last) return;
        last = frameIndex;
        const frame = liveFrames[frameIndex];
        res.write(`\r\n--ilceframe\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
        res.write(frame);
      }, 20);
      req.on('close', () => clearInterval(timer));
      return;
    }
    if (path === '/api/photos') {
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? 100);
      const newest = [...photos].reverse();
      const items = newest.slice(offset, offset + limit).map((p) => ({
        id: p.id, folder: 100, file: 4000 + p.id, date: p.taken, jpeg: true, raw: p.id % 3 === 0,
      }));
      await delay(80);
      return json(res, 200, { total: photos.length, offset, items });
    }
    const match = path.match(/^\/api\/photos\/(\d+)(?:\/(thumb|small|preview|full|raw))?$/);
    if (match) {
      const photo = photos.find((p) => p.id === Number(match[1]));
      if (!photo) return json(res, 404, { error: 'not found' });
      const kind = match[2];
      if (!kind) {
        const d = new Date(photo.taken);
        return json(res, 200, {
          id: photo.id, name: `_DSC${4000 + photo.id}.JPG`, folder: '100MSDCF',
          date: d.toISOString().slice(0, 19).replace('T', ' ').replace(/-/g, ':'),
          width: photo.width, height: photo.height, orientation: photo.orientation,
          aperture: 5.6, exposureTime: 1 / 250, focalLength: 16 + (photo.id * 7) % 34, iso: 400,
        });
      }
      await delay(kind === 'full' ? 400 : 60);
      if (kind === 'small' || kind === 'thumb') return jpeg(res, read(`small-${photo.sample}.jpg`));
      if (kind === 'preview') return jpeg(res, read(`preview-${photo.sample}.jpg`));
      if (kind === 'full') return jpeg(res, read(`full-${photo.sample}.jpg`));
      // No real ARW here: the full JPEG's bytes under an .ARW name, enough to try the download
      if (!(photo.id % 3 === 0)) return json(res, 404, { error: 'no raw for this photo' });
      const raw = read(`full-${photo.sample}.jpg`);
      res.writeHead(200, { 'Content-Type': 'image/x-sony-arw', 'Content-Length': raw.length, 'Content-Disposition': `inline; filename="_DSC${4000 + photo.id}.ARW"` });
      return res.end(raw);
    }
    // The camera's web app, as the camera serves it
    if (!path.startsWith('/api/')) {
      const file = path === '/' ? 'index.html' : path.slice(1);
      if (!file.includes('..')) {
        try {
          const data = readFileSync(new URL(file, webApp));
          const type = { html: 'text/html; charset=utf-8', js: 'application/javascript', css: 'text/css', png: 'image/png', ttf: 'font/ttf', webmanifest: 'application/manifest+json' }[file.split('.').pop()];
          res.writeHead(200, { 'Content-Type': type ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
          return res.end(data);
        } catch {
          // fall through to 404
        }
      }
    }
    json(res, 404, { error: `Not found: ${path}` });
  } catch (e) {
    json(res, 500, { error: String(e) });
  }
});

server.listen(PORT, () => {
  const addresses = Object.values(networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal);
  console.log(`mock camera on port ${PORT}: ${addresses.map((a) => a.address).join(', ')} (and 127.0.0.1)`);
});
