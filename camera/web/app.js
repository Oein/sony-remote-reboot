/*
 * ILCE Remote web app: the phone app (viewer/) for any browser, served by the camera itself.
 * Screens, sizes and behaviour follow the app's sources; comments name the matching file.
 * Plain script, no build step needed (the camera build minifies it).
 */
(function () {
  'use strict';

  var STATE_POLL_MS = 1000;
  var LATEST_POLL_MS = 4000;
  var PAGE = 60;
  var SCRUB_STEP_PX = 26;
  var AP_HOST = '192.168.122.1';
  // app/(tabs)/index.tsx
  var CAPTURE_COLUMN_W = 92;
  var SIDE_PANEL_W = 300;
  var MIN_OVERLAY_W = 520;
  // Wide screens: the settings row and the shutter row under the live view take about this much
  var STAGE_CONTROLS_H = 200;

  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function each(list, fn) { Array.prototype.forEach.call(list, fn); }

  // --- API (lib/camera.ts) -------------------------------------------------------------------------

  function request(path, options, timeoutMs) {
    var controller = window.AbortController ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs || 8000) : null;
    var init = options || {};
    if (controller) init.signal = controller.signal;
    return fetch(path, init).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) return res.text().then(function (t) { throw new Error(t || res.status); });
      return res.json();
    }, function (e) { if (timer) clearTimeout(timer); throw e; });
  }
  function post(path, body, timeoutMs) {
    return request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }, timeoutMs);
  }
  var api = {
    info: function () { return request('/api/info', null, 3000); },
    state: function () { return request('/api/camera'); },
    apply: function (changes) { return post('/api/camera', changes, 20000); },
    shoot: function () { return post('/api/camera/shutter', {}, 35000); },
    focus: function (action) { return post('/api/camera/focus', { action: action }, 6000); },
    focusDrive: function (direction) { return post('/api/camera/focusdrive', { direction: direction, speed: 0 }); },
    zoom: function (direction) { return post('/api/camera/zoom', { direction: direction, speed: 0 }); },
    zoomTo: function (target) { return post('/api/camera/zoom', { target: target }); },
    magnify: function (action, dx, dy) { return post('/api/camera/magnify', { action: action, dx: dx || 0, dy: dy || 0 }); },
    photos: function (offset, limit) { return request('/api/photos?offset=' + offset + '&limit=' + limit); },
    photo: function (id) { return request('/api/photos/' + id); },
  };
  // Images are cached by URL and photo ids can be reused, so the capture time versions them
  function photoUrl(item, kind) { return '/api/photos/' + item.id + '/' + kind + '?v=' + item.date; }

  // --- labels (lib/labels.ts) ----------------------------------------------------------------------

  var SCENE_MODES = {
    auto: '인텔리전트 자동', 'program-auto': '프로그램 자동', 'aperture-priority': '조리개 우선', 'shutter-speed': '셔터 우선',
    'manual-exposure': '수동 노출', portrait: '인물', sports: '스포츠 동작', macro: '매크로', landscape: '풍경', sunset: '일몰',
    night: '야경', 'night-portrait': '야경 인물', 'hand-held-twilight': '손에 들고 야경', 'anti-motion-blur': '움직임 흐림 방지',
  };
  var MODE_BADGES = { auto: 'iA', 'program-auto': 'P', 'aperture-priority': 'A', 'shutter-speed': 'S', 'manual-exposure': 'M' };
  var WHITE_BALANCE = {
    auto: '자동 WB', daylight: '일광', shade: '그늘', 'cloudy-daylight': '흐림', incandescent: '백열등',
    'fluorescent-coolwhite': '형광등: 온백색', 'fluorescent-daywhite': '형광등: 주백색', 'fluorescent-daylight': '형광등: 주광색',
    'warm-fluorescent': '형광등: 따뜻한 백색', flash: '플래시', custom: '사용자 정의', 'color-temp': '색온도', 'underwater-auto': '수중 자동',
  };
  var DRIVE_MODES = { single: '단일 촬영', burst: '연속 촬영', 'speed-prior-burst': '속도 우선 연속 촬영', bracket: '브라케팅' };
  var FOCUS_MODES = { auto: 'AF', manual: 'MF', dmf: 'DMF' };
  var SHUTTER_SPEEDS = ['30"', '25"', '20"', '15"', '13"', '10"', '8"', '6"', '5"', '4"', '3.2"', '2.5"', '2"', '1.6"', '1.3"', '1"',
    '0.8"', '0.6"', '0.5"', '0.4"', '1/3', '1/4', '1/5', '1/6', '1/8', '1/10', '1/13', '1/15', '1/20', '1/25', '1/30', '1/40', '1/50',
    '1/60', '1/80', '1/100', '1/125', '1/160', '1/200', '1/250', '1/320', '1/400', '1/500', '1/640', '1/800', '1/1000', '1/1250',
    '1/1600', '1/2000', '1/2500', '1/3200', '1/4000'];
  var APERTURES = [1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 14, 16, 18, 20, 22];

  function sceneName(m) { return SCENE_MODES[m] || m; }
  function driveName(d, timer) { return timer > 0 ? '셀프 타이머: ' + timer + '초' : (DRIVE_MODES[d] || d); }
  function focusName(mode, af) { return mode === 'auto' && af ? af.toUpperCase() : (FOCUS_MODES[mode] || mode); }
  function formatEv(index, step) {
    var v = index * step;
    if (Math.abs(v) < 0.05) return '±0.0';
    return (v > 0 ? '+' : '-') + Math.abs(v).toFixed(1);
  }
  function formatExposure(seconds) {
    if (seconds <= 0) return '-';
    if (seconds >= 0.4) return Math.round(seconds * 10) / 10 + '"';
    return '1/' + Math.round(1 / seconds);
  }
  function range(from, to) {
    var out = [], step = from <= to ? 1 : -1;
    for (var i = from; step > 0 ? i <= to : i >= to; i += step) out.push(i);
    return out;
  }
  function withCurrent(values, current) { return values.indexOf(current) >= 0 ? values : [current].concat(values); }
  function aspectOf(text) {
    var p = String(text || '').split(':');
    var w = Number(p[0]), h = Number(p[1]);
    return w > 0 && h > 0 ? w / h : 16 / 9;
  }
  function exifRotation(o) { return o === 6 ? 90 : o === 3 ? 180 : o === 8 ? 270 : 0; }
  function mb(bytes) { return (bytes / 1048576).toFixed(1); }
  function fit(w, h, aspect) { return w / aspect > h ? { width: h * aspect, height: h } : { width: w, height: w / aspect }; }
  function haptic(ms) { if (navigator.vibrate) navigator.vibrate(ms || 8); }

  // --- thumbnail cache (lib/thumbCache.ts) ------------------------------------------------------------
  // The gallery's small thumbnails are kept in this browser (IndexedDB, which works over http) so
  // photos already seen show at once and don't cost the camera's Wi-Fi again. Thumbnails only;
  // past the user's size limit the least recently used go.

  var MB = 1024 * 1024;
  var CACHE_SIZES_MB = [50, 100, 200, 500, 1000];
  var thumbCache = (function () {
    var LIMIT_KEY = 'thumbCacheMaxMB';
    var maxBytes = 100 * MB;
    try { maxBytes = (Number(localStorage.getItem(LIMIT_KEY)) || 100) * MB; } catch (e) { /* default */ }
    var meta = {};          // key -> { size, used }
    var urls = {};          // key -> object URL
    var pending = {};
    var waiting = [], running = 0;
    var listeners = [];
    var db = new Promise(function (resolve) {
      try {
        var open = indexedDB.open('ilce-thumbs', 1);
        open.onupgradeneeded = function () { open.result.createObjectStore('thumbs', { keyPath: 'key' }); };
        open.onsuccess = function () {
          var d = open.result;
          // Sizes and last use of everything stored, for the limit
          var cursor = d.transaction('thumbs').objectStore('thumbs').openCursor();
          cursor.onsuccess = function () {
            var c = cursor.result;
            if (c) { meta[c.value.key] = { size: c.value.size, used: c.value.used }; c.continue(); }
            else { changed(); resolve(d); }
          };
          cursor.onerror = function () { resolve(d); };
        };
        open.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    function changed() { listeners.forEach(function (l) { l(); }); }
    function store(d, mode) { return d.transaction('thumbs', mode).objectStore('thumbs'); }
    function keyFor(item) { return item.id + '-' + item.date; }
    function usage() { var t = 0; for (var k in meta) t += meta[k].size; return t; }
    function evict(d) {
      var total = usage();
      Object.keys(meta).sort(function (a, b) { return meta[a].used - meta[b].used; }).forEach(function (k) {
        if (total <= maxBytes) return;
        total -= meta[k].size;
        delete meta[k];
        if (urls[k]) { URL.revokeObjectURL(urls[k]); delete urls[k]; }
        if (d) store(d, 'readwrite').delete(k);
      });
    }
    function slot(work) {
      return new Promise(function (resolve) {
        var start = function () {
          running++;
          work().then(resolve, function () { resolve(null); }).then(function () { running--; var next = waiting.shift(); if (next) next(); });
        };
        if (running < 3) start(); else waiting.push(start);
      });
    }
    // Object URL of the thumbnail, from the cache or downloaded into it
    function get(item) {
      var key = keyFor(item);
      if (urls[key]) { if (meta[key]) meta[key].used = Date.now(); return Promise.resolve(urls[key]); }
      if (pending[key]) return pending[key];
      pending[key] = db.then(function (d) {
        var cached = !d || !meta[key] ? Promise.resolve(null) : new Promise(function (resolve) {
          var req = store(d, 'readonly').get(key);
          req.onsuccess = function () { resolve(req.result || null); };
          req.onerror = function () { resolve(null); };
        });
        return cached.then(function (record) {
          if (record) {
            record.used = Date.now();
            meta[key].used = record.used;
            store(d, 'readwrite').put(record);
            return record.blob;
          }
          return slot(function () {
            return fetch(photoUrl(item, 'small')).then(function (res) {
              if (!res.ok) throw new Error(res.status);
              return res.blob();
            }).then(function (blob) {
              var now = Date.now();
              meta[key] = { size: blob.size, used: now };
              if (d) store(d, 'readwrite').put({ key: key, blob: blob, size: blob.size, used: now });
              evict(d);
              changed();
              return blob;
            });
          });
        });
      }).then(function (blob) {
        delete pending[key];
        if (!blob) return null;
        urls[key] = URL.createObjectURL(blob);
        return urls[key];
      }, function () { delete pending[key]; return null; });
      return pending[key];
    }
    return {
      get: get,
      usage: usage,
      limitMB: function () { return Math.round(maxBytes / MB); },
      setLimitMB: function (mb) {
        maxBytes = mb * MB;
        try { localStorage.setItem(LIMIT_KEY, String(mb)); } catch (e) { /* session only */ }
        db.then(function (d) { evict(d); changed(); });
      },
      clear: function () {
        meta = {};
        db.then(function (d) { if (d) store(d, 'readwrite').clear(); changed(); });
      },
      onChange: function (l) { listeners.push(l); },
    };
  })();
  // A thumbnail into an <img> or a background, once it's cached
  function showThumb(target, item) {
    thumbCache.get(item).then(function (url) {
      if (!url) return;
      if (target.tagName === 'IMG') target.src = url;
      else target.style.backgroundImage = 'url("' + url + '")';
    });
  }

  // --- viewport -------------------------------------------------------------------------------------
  // Opened from the home screen, iOS reports a viewport short by the status bar (innerHeight 812
  // on an 874 pt screen) and pins "bottom: 0" there, leaving a gap; only 100lvh is right, so the
  // layout goes by it there (in Safari, with toolbars, lvh would be too tall instead)
  // (That happens with a translucent status bar, as home-screen icons added before 0.19 have; the
  // page now asks for an opaque one, which also keeps iOS from darkening the top of the screen.)
  var probe = el('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;' +
    'height:100lvh;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.appendChild(probe);
  var standalone = window.navigator.standalone === true &&
    probe.getBoundingClientRect().height - window.innerHeight > 1 && parseFloat(getComputedStyle(probe).paddingTop) > 0;
  if (standalone) document.documentElement.classList.add('standalone');
  function viewport() {
    var cs = getComputedStyle(probe);
    return {
      width: window.innerWidth,
      height: standalone ? probe.getBoundingClientRect().height || window.innerHeight : window.innerHeight,
      top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0,
    };
  }

  // Tablets and computers (the short side 600 or more: no phone is that wide) get their own layout:
  // a sidebar instead of the tab bar, the controls beside the live view (under it when upright),
  // sheets as dialogs
  function isWide() {
    var vp = viewport();
    return Math.min(vp.width, vp.height) >= 600;
  }
  function applyWide() { document.body.classList.toggle('wide', isWide()); }
  applyWide();

  // --- state ---------------------------------------------------------------------------------------

  var state = null;
  var info = null;
  var connected = false;
  var busy = false;
  var af = 'idle';
  var manualRotation = 0;
  var latest = null;
  var latestId = null;
  var tab = 'shoot';

  function cameraKnowsOrientation() { return !!state && state.orientation >= 0; }
  // As index.tsx: the camera's orientation, else its display roll, else the latest shot / button
  function rollToDegrees(roll) { return roll === 1 ? 90 : roll === 2 ? 180 : roll === 3 ? 270 : 0; }
  function rotation() {
    if (cameraKnowsOrientation()) return state.orientation;
    if (state && state.roll >= 0) return rollToDegrees(state.roll);
    return manualRotation;
  }

  function pollState() {
    if (busy) return;
    api.state().then(function (s) {
      state = s;
      setConnected(true);
      render();
    }, function () { setConnected(false); });
  }

  function setConnected(on) {
    if (on === connected) return;
    connected = on;
    if (on) {
      startLive();
      api.info().then(function (i) { info = i; render(); renderConnect(); }, function () {});
      refreshLatest();
    } else {
      live.removeAttribute('src');
    }
    render();
    renderConnect();
  }

  function apply(changes) {
    busy = true;
    render();
    return api.apply(changes).then(function (s) { state = s; }, function (e) { toast('설정 실패: ' + e.message); })
      .then(function () { busy = false; render(); });
  }

  var toastTimer;
  function toast(text) {
    var t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2500);
  }

  // --- live view (components/LiveView.tsx) --------------------------------------------------------

  var live = $('live');
  function startLive() { if (!document.hidden) live.src = '/api/liveview?t=' + Date.now(); }
  live.onerror = function () {
    // The stream drops when Wi-Fi hiccups; reconnect
    setTimeout(function () { if (connected) startLive(); }, 1000);
  };
  // Safari doesn't always report a dropped MJPEG stream; a broken image means start over
  setInterval(function () {
    if (connected && !document.hidden && live.complete && live.naturalWidth === 0) startLive();
  }, 3000);

  // --- layout: portrait / landscape with the settings over the live view / beside it ----------------

  var liveBox = { width: 0, height: 0 };
  function layout() {
    var vp = viewport();
    var landscape = vp.width > vp.height;
    var deg = rotation();
    var frameAspect = aspectOf(state && state.imageAspect);
    var liveAspect = deg === 90 || deg === 270 ? 1 / frameAspect : frameAspect;
    var mode = 'portrait';
    var panelW = 0;
    if (isWide() && landscape) {
      // The controls beside the live view or under it: whichever leaves the larger picture (a 16:9
      // view in an ordinary window is far bigger with them under it)
      var availW = vp.width - $('tabs').offsetWidth - vp.right;
      var availH = vp.height - vp.top - vp.bottom;
      var beside = fit(availW - (vp.width >= 1200 ? 420 : 360) - 32, availH - 32, liveAspect);
      var under = fit(availW - 32, availH - STAGE_CONTROLS_H - 32, liveAspect);
      mode = under.width * under.height > beside.width * beside.height * 1.1 ? 'stage' : 'desk';
    } else if (landscape) {
      var landscapeW = vp.width - CAPTURE_COLUMN_W - vp.left - vp.right;
      var landscapeH = vp.height - vp.top - vp.bottom;
      mode = fit(landscapeW, landscapeH, liveAspect).width >= MIN_OVERLAY_W ? 'overlay' : 'side';
      liveBox = fit(mode === 'overlay' ? landscapeW : landscapeW - SIDE_PANEL_W, landscapeH, liveAspect);
      panelW = landscapeW - liveBox.width;
    }
    document.body.setAttribute('data-orientation', landscape ? 'landscape' : 'portrait');
    if (document.body.getAttribute('data-layout') !== mode) {
      document.body.setAttribute('data-layout', mode);
      placeControls(mode);
    }
    if (!landscape || mode === 'desk' || mode === 'stage') {
      // The live view gets what the dial, focus row and capture bar (or the side panel) leave
      var area = $('live-area');
      liveBox = fit(area.clientWidth, area.clientHeight, liveAspect);
    } else {
      $('live-area').style.width = mode === 'side' ? liveBox.width + 'px' : '';
      $('panel').style.width = panelW + 'px';
    }
    var box = $('live-box');
    box.style.width = liveBox.width + 'px';
    box.style.height = liveBox.height + 'px';
    var sideways = deg === 90 || deg === 270;
    live.style.width = (sideways ? liveBox.height : liveBox.width) + 'px';
    live.style.height = (sideways ? liveBox.width : liveBox.height) + 'px';
    live.style.transform = 'translate(-50%, -50%) rotate(' + deg + 'deg)';
  }

  // Where the dial, the focus row and the zoom control go in each layout
  var captureLeft = el('div', 'capture-group left');
  var captureRight = el('div', 'capture-group right');
  function placeControls(mode) {
    var dial = $('dial'), mf = $('mf-row'), zoom = $('zoom');
    var capture = $('capture'), latestButton = $('latest'), afButtonEl = $('af');
    // The shutter row: latest and zoom left of the shutter, focus and AF right of it, under the view
    if (mode === 'stage') {
      captureLeft.appendChild(latestButton);
      captureLeft.appendChild(zoom);
      captureRight.appendChild(mf);
      captureRight.appendChild(afButtonEl);
      capture.insertBefore(captureLeft, capture.firstChild);
      capture.appendChild(captureRight);
      $('panel').appendChild(dial);
      $('shoot').appendChild($('key-hints'));
      dial.classList.remove('strip');
      mf.classList.remove('compact');
      return;
    }
    capture.insertBefore(latestButton, $('shutter'));
    capture.appendChild(afButtonEl);
    if (captureLeft.parentNode) capture.removeChild(captureLeft);
    if (captureRight.parentNode) capture.removeChild(captureRight);
    if (mode !== 'desk') $('shoot').appendChild($('key-hints'));
    dial.classList.toggle('strip', mode === 'overlay');
    mf.classList.toggle('compact', mode === 'overlay');
    if (mode === 'overlay') {
      $('bottom-overlay').appendChild(mf);
      $('bottom-overlay').appendChild(dial);
      $('live-box').appendChild(zoom);
    } else if (mode === 'side') {
      $('panel').appendChild(zoom);
      $('panel').appendChild(dial);
      $('panel').appendChild(mf);
    } else if (mode === 'desk') {
      $('panel').appendChild(dial);
      $('panel').appendChild(mf);
      $('panel').appendChild(zoom);
      $('panel').appendChild($('key-hints'));
    } else {
      $('controls').appendChild(dial);
      $('controls').appendChild(mf);
      $('live-box').appendChild(zoom);
    }
  }

  function rotateArea(a, deg) {
    if (deg === 90) return { x: 1 - (a.y + a.h), y: a.x, w: a.h, h: a.w };
    if (deg === 180) return { x: 1 - (a.x + a.w), y: 1 - (a.y + a.h), w: a.w, h: a.h };
    if (deg === 270) return { x: a.y, y: 1 - (a.x + a.w), w: a.h, h: a.w };
    return a;
  }
  function unrotatePoint(u, v, deg) {
    if (deg === 90) return { x: v, y: 1 - u };
    if (deg === 180) return { x: 1 - u, y: 1 - v };
    if (deg === 270) return { x: 1 - v, y: u };
    return { x: u, y: v };
  }

  // --- render the shooting screen ------------------------------------------------------------------

  function render() {
    layout();
    var s = state;
    $('offline').hidden = connected;
    $('dot').className = connected ? 'on' : '';
    $('model').textContent = connected ? (info ? info.model : '') : '연결 안 됨';
    var battery = $('battery');
    var showBattery = connected && s && s.battery >= 0;
    battery.hidden = !showBattery;
    if (showBattery) {
      battery.firstChild.textContent = s.battery > 60 ? '' : s.battery > 15 ? '' : '';
      battery.lastChild.textContent = s.battery + '%';
      battery.classList.toggle('low', s.battery <= 15);
    }
    var shots = $('shots');
    shots.hidden = !(connected && s && s.shotsLeft >= 0);
    if (!shots.hidden) shots.textContent = s.shotsLeft + '장';
    $('busy').hidden = !busy;
    var badge = $('focus-badge');
    badge.hidden = !s;
    if (s) {
      badge.textContent = focusName(s.focusMode, s.afMode);
      badge.className = af === 'focused' ? 'ok' : af === 'failed' ? 'fail' : '';
    }
    $('rotate').hidden = !(connected && !cameraKnowsOrientation());
    each([$('shutter'), $('af'), $('zoom')], function (b) { b.classList.toggle('disabled-control', !connected); });
    if (!s) return;
    renderAfFrames();
    renderDial();
    renderZoom();
    renderManualFocus();
  }

  // Green frames where the camera found focus (orange when it couldn't confirm it)
  function renderAfFrames() {
    var holder = $('af-frames');
    holder.innerHTML = '';
    var a = state.af;
    if (!a || (state.magnifier && state.magnifier.on) || (a.status !== 'lock' && a.status !== 'warn')) return;
    a.areas.forEach(function (area) {
      var r = rotateArea(area, rotation());
      var f = el('i', a.status === 'warn' ? 'warn' : '');
      f.style.left = r.x * liveBox.width + 'px';
      f.style.top = r.y * liveBox.height + 'px';
      f.style.width = r.w * liveBox.width + 'px';
      f.style.height = r.h * liveBox.height + 'px';
      holder.appendChild(f);
    });
  }

  // --- settings (settingsFor in index.tsx) --------------------------------------------------------

  function settings(s) {
    var drive = (s.driveModeValues || []).filter(function (d) { return d !== 'bracket'; })
      .map(function (d) { return { value: d + '/0', label: driveName(d, 0) }; });
    (s.selfTimerValues || []).forEach(function (t) { if (t > 0) drive.push({ value: 'single/' + t, label: driveName('single', t) }); });
    var timer = s.selfTimer || 0;
    var modes = Object.keys(SCENE_MODES).filter(function (m) { return s.sceneModeValues.indexOf(m) >= 0; })
      .concat(s.sceneModeValues.filter(function (m) { return !SCENE_MODES[m]; }));
    return [
      { key: 'shutter', label: '셔터', title: '셔터 속도', current: s.shutterText,
        options: withCurrent(SHUTTER_SPEEDS, s.shutterText).map(function (v) { return { value: v, label: v }; }),
        disabled: !(s.mode === 'manual' || s.mode === 'shutter'), changes: function (v) { return { shutter: v }; } },
      { key: 'aperture', label: '조리개', current: String(s.aperture), display: s.aperture > 0 ? 'F' + s.aperture : '--',
        options: withCurrent(APERTURES.map(String), String(s.aperture)).map(function (v) { return { value: v, label: 'F' + v }; }),
        disabled: !(s.mode === 'manual' || s.mode === 'aperture'), changes: function (v) { return { aperture: Number(v) }; } },
      { key: 'iso', label: 'ISO', current: String(s.iso),
        options: s.isoValues.map(function (v) { return { value: String(v), label: v === 0 ? 'AUTO' : String(v) }; }),
        changes: function (v) { return { iso: Number(v) }; } },
      { key: 'ev', label: '노출 보정', current: String(s.ev),
        options: range(s.evMin, s.evMax).map(function (i) { return { value: String(i), label: formatEv(i, s.evStep) }; }),
        changes: function (v) { return { ev: Number(v) }; } },
      { key: 'sceneMode', label: '모드', title: '촬영 모드', current: s.sceneMode, display: MODE_BADGES[s.sceneMode] || 'SCN',
        options: modes.map(function (m) { return { value: m, label: sceneName(m) }; }),
        changes: function (v) { return { sceneMode: v }; } },
      { key: 'whiteBalance', label: 'WB', current: s.whiteBalance,
        display: s.whiteBalance === 'color-temp' && s.colorTemperature ? s.colorTemperature + 'K' : undefined,
        options: s.whiteBalanceValues.map(function (v) { return { value: v, label: WHITE_BALANCE[v] || v }; }),
        changes: function (v) { return { whiteBalance: v }; }, sheet: whiteBalanceSheet },
      { key: 'drive', label: '드라이브', title: '드라이브 모드', current: timer > 0 ? 'single/' + timer : s.driveMode + '/0', options: drive,
        changes: function (v) { var p = v.split('/'); return { driveMode: p[0], selfTimer: Number(p[1]) }; } },
      { key: 'focusMode', label: '초점', title: '초점 모드', current: s.focusMode, display: focusName(s.focusMode, s.afMode),
        options: (s.focusModeValues || ['auto', 'manual']).map(function (m) { return { value: m, label: focusName(m) }; }),
        changes: function (v) { return { focusMode: v }; } },
    ];
  }

  // ScrubChip (components/Controls.tsx): swipe sideways to turn the value like a dial, with the
  // neighbouring values faint at the sides and ruler ticks sliding along; tap for the wheels
  var chips = {};
  var dragging = null;

  function renderDial() {
    var dial = $('dial');
    settings(state).forEach(function (setting) {
      var chip = chips[setting.key];
      if (!chip) {
        chip = buildChip(setting.label);
        dial.appendChild(chip);
        chips[setting.key] = chip;
        bindChip(chip);
      }
      chip.setting = setting;
      if (dragging && dragging.chip === chip) return; // shows the value being scrubbed to
      var current = setting.options.filter(function (o) { return o.value === setting.current; })[0];
      chip.valueEl.textContent = setting.display || (current ? current.label : '--');
      chip.classList.toggle('disabled', !!setting.disabled);
    });
  }

  function buildChip(label) {
    var chip = el('div', 'chip');
    chip.setAttribute('role', 'adjustable');
    chip.appendChild(el('small', '', label));
    chip.valueEl = chip.appendChild(el('b'));
    chip.prevEl = chip.appendChild(el('span', 'neighbour left'));
    chip.nextEl = chip.appendChild(el('span', 'neighbour right'));
    var ticks = el('div', 'ticks');
    chip.tickRow = ticks.appendChild(el('div', 'tick-row'));
    for (var i = 0; i < 9; i++) chip.tickRow.appendChild(el('i'));
    chip.appendChild(ticks);
    paintTicks(chip, false);
    return chip;
  }

  // DialTicks: opacity falls off from the centre; lit and sliding while dragging
  function paintTicks(chip, active) {
    each(chip.tickRow.children, function (t, i) {
      t.style.opacity = String(active ? 1 - Math.abs(i - 4) * 0.2 : 0.55 - Math.abs(i - 4) * 0.12);
    });
  }

  function bindChip(chip) {
    chip.addEventListener('pointerdown', function (e) {
      var setting = chip.setting;
      if (!setting || setting.disabled) return;
      var index = Math.max(0, setting.options.map(function (o) { return o.value; }).indexOf(setting.current));
      dragging = { chip: chip, x: e.clientX, y: e.clientY, start: index, index: index, moved: false };
      chip.classList.add('pressed');
    });
    chip.addEventListener('pointermove', function (e) {
      if (!dragging || dragging.chip !== chip) return;
      var dx = e.clientX - dragging.x;
      if (!dragging.moved) {
        if (Math.abs(dx) <= 8 || Math.abs(dx) <= Math.abs(e.clientY - dragging.y) * 1.5) return;
        dragging.moved = true;
        chip.classList.remove('pressed');
        chip.classList.add('dragging');
        paintTicks(chip, true);
        try { chip.setPointerCapture(e.pointerId); } catch (err) { /* already gone */ }
      }
      // Dragging left brings in the next value from the right
      var options = chip.setting.options;
      var index = Math.max(0, Math.min(options.length - 1, dragging.start - Math.round(dx / SCRUB_STEP_PX)));
      if (index !== dragging.index) haptic();
      dragging.index = index;
      chip.valueEl.textContent = options[index].label;
      chip.prevEl.textContent = index > 0 ? options[index - 1].label : '';
      chip.nextEl.textContent = index < options.length - 1 ? options[index + 1].label : '';
      // Slide within one tick spacing so the ruler seems to scroll past endlessly
      var spacing = 6;
      var offset = ((((dx / SCRUB_STEP_PX) * spacing) % spacing) + spacing) % spacing;
      chip.tickRow.style.transform = 'translateX(' + (offset - spacing / 2) + 'px)';
    });
    var finish = function (commit) {
      if (!dragging || dragging.chip !== chip) return;
      var d = dragging;
      dragging = null;
      chip.classList.remove('dragging', 'pressed');
      chip.prevEl.textContent = chip.nextEl.textContent = '';
      chip.tickRow.style.transform = '';
      paintTicks(chip, false);
      var setting = chip.setting;
      if (commit && d.moved && d.index !== d.start && setting.options[d.index]) apply(setting.changes(setting.options[d.index].value));
      else if (commit && !d.moved) openSetting(setting);
      renderDial();
    };
    chip.addEventListener('pointerup', function () { finish(true); });
    chip.addEventListener('pointercancel', function () { finish(false); });
    chip.addEventListener('pointerleave', function () { if (dragging && dragging.chip === chip && !dragging.moved) finish(false); });

    // With a mouse or trackpad, scrolling over a setting steps it; it's applied once scrolling stops
    var wheel = null;
    chip.addEventListener('wheel', function (e) {
      var setting = chip.setting;
      if (!setting || setting.disabled || dragging) return;
      e.preventDefault();
      if (!wheel) {
        var start = Math.max(0, setting.options.map(function (o) { return o.value; }).indexOf(setting.current));
        wheel = { start: start, index: start, delta: 0, timer: null };
      }
      wheel.delta += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      var steps = Math.trunc(wheel.delta / WHEEL_STEP_DELTA);
      if (steps) {
        wheel.delta -= steps * WHEEL_STEP_DELTA;
        wheel.index = Math.max(0, Math.min(setting.options.length - 1, wheel.index + steps));
        chip.valueEl.textContent = setting.options[wheel.index].label;
        chip.classList.add('dragging');
        paintTicks(chip, true);
      }
      clearTimeout(wheel.timer);
      wheel.timer = setTimeout(function () {
        var w = wheel;
        wheel = null;
        chip.classList.remove('dragging');
        paintTicks(chip, false);
        if (w.index !== w.start) apply(setting.changes(setting.options[w.index].value));
        renderDial();
      }, 500);
    }, { passive: false });
  }

  // --- WheelSheet (components/WheelSheet.tsx) ------------------------------------------------------
  // A sheet slides up with spinning wheels like the iOS Timer; nothing reaches the camera while
  // they turn, "완료" applies what changed, once

  var WHEEL_ITEM_H = 40;
  /** Scroll distance per setting step (a mouse wheel notch is about 100) */
  var WHEEL_STEP_DELTA = 60;
  var WHEEL_RADIUS = 72, WHEEL_ANGLE = 35;
  var sheetDone = null;

  function openSheet(title, wheels, onDone) {
    $('sheet-title').textContent = title;
    var body = $('sheet-body');
    body.innerHTML = '';
    var values = {};
    // iOS wheels need room: more than two go in rows of two (sideways, one row: no height to spare)
    var vp = viewport();
    var perRow = vp.width <= vp.height && wheels.length > 2 && !isWide() ? 2 : wheels.length;
    for (var r = 0; r < wheels.length; r += perRow) {
      var row = el('div', 'wheel-row');
      wheels.slice(r, r + perRow).forEach(function (w) {
        values[w.key] = w.value;
        row.appendChild(buildWheel(w, function (v) { values[w.key] = v; }, wheels.length > 2));
      });
      body.appendChild(row);
    }
    sheetDone = function () {
      var changed = {}, any = false;
      wheels.forEach(function (w) { if (values[w.key] !== w.value) { changed[w.key] = values[w.key]; any = true; } });
      if (any) onDone(changed);
    };
    $('sheet').hidden = false;
    $('sheet-backdrop').hidden = false;
    requestAnimationFrame(function () {
      each(body.querySelectorAll('.wheel-list'), function (list) { list.scrollToSelected(); });
      requestAnimationFrame(function () { document.body.classList.add('sheet-open'); });
    });
    setTimeout(function () { each(body.querySelectorAll('.wheel-list'), function (list) { list.restoreSelected(); }); }, 400);
  }

  function closeSheet() {
    document.body.classList.remove('sheet-open');
    sheetDone = null;
    setTimeout(function () {
      if (!document.body.classList.contains('sheet-open')) { $('sheet').hidden = true; $('sheet-backdrop').hidden = true; }
    }, 300);
  }
  $('sheet-backdrop').onclick = closeSheet;
  $('sheet-cancel').onclick = closeSheet;
  $('sheet-done').onclick = function () {
    var done = sheetDone;
    closeSheet();
    if (done) done();
  };

  function buildWheel(w, onChange, compact) {
    var column = el('div', 'wheel' + (compact ? ' compact' : ''));
    column.style.flex = String(w.flex || 1);
    if (w.title) column.appendChild(el('div', 'wheel-title', w.title));
    var frame = el('div', 'wheel-frame');
    frame.appendChild(el('div', 'wheel-band'));
    var list = el('div', 'wheel-list');
    // The rows snap; their faces (inside) are what turn, so the snap points stay put
    var items = w.options.map(function (o) {
      var item = list.appendChild(el('div', 'wheel-item'));
      item.face = item.appendChild(el('span', 'wheel-face', o.label));
      return item;
    });
    frame.appendChild(list);
    column.appendChild(frame);
    var selected = Math.max(0, w.options.map(function (o) { return o.value; }).indexOf(w.value));

    // Items turn away and fade with their distance from the middle, like a drum
    function paint() {
      var center = list.scrollTop / WHEEL_ITEM_H;
      var from = Math.max(0, Math.floor(center) - 5), to = Math.min(items.length - 1, Math.ceil(center) + 5);
      for (var i = from; i <= to; i++) {
        var d = i - center;
        // A drum, as UIPickerView draws it: rows sit on a cylinder (measured from the app: the next
        // rows 41.5 pt from the middle, the ones after 68 pt), so they bunch up and turn away
        var ad = Math.abs(d), angle = Math.max(-89, Math.min(89, d * WHEEL_ANGLE));
        var y = WHEEL_RADIUS * Math.sin(angle * Math.PI / 180) - d * WHEEL_ITEM_H;
        items[i].face.style.transform = 'translateY(' + y.toFixed(1) + 'px) rotateX(' + (-angle * 0.75).toFixed(1) + 'deg)';
        items[i].face.style.opacity = ad * WHEEL_ANGLE >= 89 ? '0' : String(Math.max(0, 1 - Math.max(0, ad - 1) * 0.55));
        items[i].classList.toggle('selected', Math.abs(d) < 0.5);
      }
    }
    var settle = null, last = selected;
    list.addEventListener('scroll', function () {
      requestAnimationFrame(paint);
      var i = Math.max(0, Math.min(items.length - 1, Math.round(list.scrollTop / WHEEL_ITEM_H)));
      if (i !== last) { last = i; haptic(4); }
      clearTimeout(settle);
      settle = setTimeout(function () {
        if (i !== selected) { selected = i; onChange(w.options[i].value); }
      }, 80);
    });
    var dragged = false;
    items.forEach(function (item, i) {
      item.onclick = function () { if (!dragged) list.scrollTo({ top: i * WHEEL_ITEM_H, behavior: 'smooth' }); };
    });

    // A mouse doesn't scroll by dragging: turn the wheel by hand, then let it snap to a row
    list.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      touched = true;
      dragged = false;
      var startY = e.clientY, startTop = list.scrollTop;
      list.style.scrollSnapType = 'none';
      var move = function (ev) {
        if (Math.abs(ev.clientY - startY) > 3) dragged = true;
        list.scrollTop = startTop - (ev.clientY - startY);
      };
      var up = function () {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        var i = Math.max(0, Math.min(items.length - 1, Math.round(list.scrollTop / WHEEL_ITEM_H)));
        list.scrollTo({ top: i * WHEEL_ITEM_H, behavior: 'smooth' });
        setTimeout(function () { list.style.scrollSnapType = ''; dragged = false; }, 300);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      e.preventDefault();
    });

    // Some browsers drop the scroll position while the sheet animates open (desktop Safari lands on
    // the first row): put the wheel back on the current value unless it has been turned since
    var initial = selected, touched = false;
    list.addEventListener('wheel', function () { touched = true; }, { passive: true });
    list.addEventListener('touchstart', function () { touched = true; }, { passive: true });
    list.scrollToSelected = function () { list.scrollTop = selected * WHEEL_ITEM_H; paint(); };
    list.restoreSelected = function () {
      if (touched || list.scrollTop === initial * WHEEL_ITEM_H) return;
      clearTimeout(settle);
      selected = last = initial;
      onChange(w.options[initial].value);
      list.scrollToSelected();
    };
    return column;
  }

  function openSetting(setting) {
    if (setting.sheet) return setting.sheet(setting);
    openSheet(setting.title || setting.label, [{ key: setting.key, options: setting.options, value: setting.current }], function (c) {
      apply(setting.changes(c[setting.key]));
    });
  }

  // White balance: mode, plus colour temperature (in colour-temperature mode) and A-B / G-M
  function whiteBalanceSheet(setting) {
    var s = state;
    var wheels = [{ key: 'whiteBalance', title: '모드', flex: 2.4, options: setting.options, value: s.whiteBalance }];
    if (s.whiteBalance === 'color-temp' && s.colorTemperature !== undefined) {
      var temps = [];
      for (var k = s.colorTemperatureMin || 2500; k <= (s.colorTemperatureMax || 9900); k += 100) temps.push({ value: String(k), label: k + 'K' });
      wheels.push({ key: 'colorTemperature', title: '색온도', flex: 1.5, options: temps, value: String(s.colorTemperature) });
    }
    if (s.wbAB !== undefined) {
      wheels.push({ key: 'wbAB', title: 'A-B', value: String(s.wbAB), options: range(s.wbABMin === undefined ? -7 : s.wbABMin, s.wbABMax === undefined ? 7 : s.wbABMax)
        .map(function (v) { return { value: String(v), label: v < 0 ? 'A' + -v : v > 0 ? 'B' + v : '0' }; }) });
    }
    if (s.wbGM !== undefined) {
      wheels.push({ key: 'wbGM', title: 'G-M', value: String(s.wbGM), options: range(s.wbGMMin === undefined ? -7 : s.wbGMMin, s.wbGMMax === undefined ? 7 : s.wbGMMax)
        .map(function (v) { return { value: String(v), label: v < 0 ? 'G' + -v : v > 0 ? 'M' + v : '0' }; }) });
    }
    openSheet('화이트 밸런스', wheels, function (c) {
      var changes = {};
      if (c.whiteBalance) changes.whiteBalance = c.whiteBalance;
      if (c.colorTemperature) changes.colorTemperature = Number(c.colorTemperature);
      if (c.wbAB) changes.wbAB = Number(c.wbAB);
      if (c.wbGM) changes.wbGM = Number(c.wbGM);
      apply(changes);
    });
  }

  // --- shutter, half-press, latest photo -----------------------------------------------------------

  var shutter = $('shutter');
  shutter.onclick = function () {
    if (shutter.classList.contains('busy') || !connected) return;
    shutter.classList.add('busy');
    shutter.querySelector('.spinner').hidden = false;
    haptic(15);
    api.shoot().then(function (r) {
      if (r.status === 'ok') { haptic(10); setTimeout(refreshLatest, 800); }
      else toast('촬영 실패 (' + r.status + ')');
    }, function (e) { toast('촬영 실패: ' + e.message); }).then(function () {
      shutter.classList.remove('busy');
      shutter.querySelector('.spinner').hidden = true;
    });
  };

  // HoldButton: half-press while held, like the camera's shutter button
  var afButton = $('af');
  function setAf(value) {
    af = value;
    afButton.classList.toggle('focused', af === 'focused');
    afButton.classList.toggle('failed', af === 'failed');
    afButton.querySelector('.af-label').hidden = af === 'focusing';
    afButton.querySelector('.spinner').hidden = af !== 'focusing';
    render();
  }
  afButton.addEventListener('pointerdown', function (e) {
    try { afButton.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    afPress();
  });
  function afPress() {
    if (!connected || afButton.held) return;
    afButton.held = true;
    setAf('focusing');
    haptic(4);
    api.focus('start').then(function (r) {
      if (afButton.held) { setAf(r.focused ? 'focused' : 'failed'); if (r.focused) haptic(8); }
    }, function () { if (afButton.held) setAf('failed'); });
  }
  var afRelease = function () {
    if (!afButton.held) return;
    afButton.held = false;
    setAf('idle');
    api.focus('stop').catch(function () {});
  };
  afButton.addEventListener('pointerup', afRelease);
  afButton.addEventListener('pointercancel', afRelease);

  function refreshLatest() {
    api.photos(0, 1).then(function (list) {
      var item = list.items[0] || null;
      latest = item;
      var thumb = $('latest');
      thumb.classList.toggle('has-photo', !!item);
      if (item) showThumb(thumb, item); else thumb.style.backgroundImage = '';
      if (item && item.id !== latestId) {
        latestId = item.id;
        // No tilt sensor on this camera: the live view follows how the latest shot was held
        api.photo(item.id).then(function (d) { manualRotation = exifRotation(d.orientation); render(); }, function () {});
      }
    }, function () {});
  }
  $('latest').onclick = function () { showTab('gallery'); };
  $('rotate').onclick = function () { manualRotation = (manualRotation + 90) % 360; render(); };
  $('offline').onclick = function () { showTab('connect'); };

  // --- ZoomRocker ------------------------------------------------------------------------------------

  function zoomButton(direction) { return document.querySelector('[data-zoom=' + direction + ']'); }
  function zoomStart(direction) {
    var b = zoomButton(direction);
    if (b.classList.contains('pressed')) return;
    b.classList.add('pressed');
    api.zoom(direction).catch(function () {});
  }
  function zoomStop(direction) {
    var b = zoomButton(direction);
    if (!b.classList.contains('pressed')) return;
    b.classList.remove('pressed');
    api.zoom('stop').catch(function () {});
  }
  each(document.querySelectorAll('[data-zoom]'), function (b) {
    var direction = b.getAttribute('data-zoom');
    b.addEventListener('pointerdown', function (e) {
      try { b.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      zoomStart(direction);
    });
    b.addEventListener('pointerup', function () { zoomStop(direction); });
    b.addEventListener('pointercancel', function () { zoomStop(direction); });
  });

  // ZoomSlider: the camera drives the lens to the position itself, so latency doesn't overshoot
  var ZOOM_TRACK = 110;
  var track = $('zoom-track');
  var zoomDrag = null;
  function trackFraction(e) {
    var r = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / ZOOM_TRACK));
  }
  function showZoomThumb(f) { $('zoom-thumb').style.left = Math.max(0, Math.min(1, f)) * (ZOOM_TRACK - 14) + 'px'; }
  track.addEventListener('pointerdown', function (e) {
    try { track.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    zoomDrag = { sent: Date.now() };
    $('zoom-thumb').classList.add('active');
    var f = trackFraction(e);
    showZoomThumb(f);
    api.zoomTo(f).catch(function () {});
  });
  track.addEventListener('pointermove', function (e) {
    if (!zoomDrag) return;
    var f = trackFraction(e);
    showZoomThumb(f);
    if (Date.now() - zoomDrag.sent > 250) {
      zoomDrag.sent = Date.now();
      api.zoomTo(f).catch(function () {});
    }
  });
  var zoomEnd = function (e) {
    if (!zoomDrag) return;
    zoomDrag = null;
    $('zoom-thumb').classList.remove('active');
    if (e.type === 'pointerup') api.zoomTo(trackFraction(e)).catch(function () {});
  };
  track.addEventListener('pointerup', zoomEnd);
  track.addEventListener('pointercancel', zoomEnd);

  function renderZoom() {
    var z = state.zoom;
    var hasZoom = !!(z && z.max > 100);
    track.hidden = !hasZoom;
    $('zoom-track-divider').hidden = !hasZoom;
    if (hasZoom && !zoomDrag) showZoomThumb((z.magnification - 100) / (z.max - 100));
  }

  // --- manual focus and focus magnifier -----------------------------------------------------------

  function renderManualFocus() {
    var s = state;
    var manual = s.focusMode === 'manual';
    $('mf-row').hidden = !manual;
    if (!manual) return;
    $('focus-near').hidden = $('focus-far').hidden = !s.focusDriveSupported;
    var hasPosition = s.focusMaxPosition > 0;
    $('focus-bar').firstElementChild.hidden = !hasPosition;
    $('focus-hint').hidden = hasPosition;
    if (hasPosition) $('knob').style.left = Math.max(0, Math.min(1, (s.focusPosition || 0) / s.focusMaxPosition)) * 100 + '%';
    var m = s.magnifier;
    var mag = $('magnify');
    mag.classList.toggle('on', !!(m && m.on));
    mag.lastChild.textContent = m && m.on ? '×' + m.factor.toFixed(1) : '';
    $('magnifier-tap').hidden = !(m && m.on && connected);
  }
  function repeatWhileHeld(button, action) {
    var timer = null;
    button.addEventListener('pointerdown', function (e) {
      try { button.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      action();
      timer = setInterval(action, 120);
    });
    var stop = function () { clearInterval(timer); timer = null; };
    button.addEventListener('pointerup', stop);
    button.addEventListener('pointercancel', stop);
  }
  repeatWhileHeld($('focus-near'), function () { api.focusDrive('near').catch(function () {}); });
  repeatWhileHeld($('focus-far'), function () { api.focusDrive('far').catch(function () {}); });
  function setMagnifier(m) { state.magnifier = m; render(); }
  $('magnify').onclick = function () { api.magnify('cycle').then(setMagnifier, function () {}); };
  // While magnified, a tap moves the window toward that point
  $('magnifier-tap').addEventListener('click', function (e) {
    var r = $('live-box').getBoundingClientRect();
    var p = unrotatePoint((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, rotation());
    api.magnify('pan', p.x - 0.5, p.y - 0.5).then(setMagnifier, function () {});
  });

  // --- tabs ----------------------------------------------------------------------------------------

  var galleryLoaded = false;
  function showTab(name) {
    tab = name;
    $('shoot').hidden = name !== 'shoot';
    $('gallery').hidden = name !== 'gallery';
    $('connect').hidden = name !== 'connect';
    document.body.classList.toggle('on-shoot', name === 'shoot');
    each(document.querySelectorAll('#tabs button'), function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === name); });
    // iOS blends the theme colour under the status bar: match what each screen shows there
    $('theme-color').setAttribute('content', name === 'shoot' ? '#000000' : '#0f0f10');
    if (name === 'gallery' && connected && !galleryLoaded) { galleryLoaded = true; loadPhotos(true); }
    if (name === 'gallery') layoutGrid();
    if (name === 'shoot') render();
  }
  each(document.querySelectorAll('#tabs button'), function (b) {
    b.onclick = function () { showTab(b.getAttribute('data-tab')); };
  });

  // --- 연결 (settings.tsx) ---------------------------------------------------------------------------
  // The page comes from the camera, so "the address" is the camera this page talks to: changing it
  // opens the web app of the camera at that address

  $('host').value = location.hostname;
  function openHost(host) {
    host = host.trim();
    if (host && host !== location.hostname) location.href = 'http://' + host + ':8080/';
  }
  $('host-apply').onclick = function () { openHost($('host').value); };
  $('host').onkeydown = function (e) { if (e.key === 'Enter') openHost($('host').value); };
  $('host-ap').onclick = function () { $('host').value = AP_HOST; openHost(AP_HOST); };
  // 썸네일 캐시: usage, limit choices and clearing, as in settings.tsx
  function sizeLabel(mb) { return mb >= 1000 ? mb / 1000 + 'GB' : mb + 'MB'; }
  function formatSize(bytes) { return bytes >= 1024 * MB ? (bytes / 1024 / MB).toFixed(1) + ' GB' : (bytes / MB).toFixed(1) + ' MB'; }
  CACHE_SIZES_MB.forEach(function (mb) {
    var b = $('cache-sizes').appendChild(el('button', '', sizeLabel(mb)));
    b.dataset.mb = mb;
    b.onclick = function () { thumbCache.setLimitMB(mb); };
  });
  $('cache-clear').onclick = function () { thumbCache.clear(); };
  function renderCache() {
    var used = thumbCache.usage(), limit = thumbCache.limitMB();
    $('cache-usage').textContent = formatSize(used) + ' / ' + sizeLabel(limit);
    $('cache-fill').style.width = Math.round(Math.min(1, used / (limit * MB)) * 100) + '%';
    each($('cache-sizes').children, function (b) { b.classList.toggle('selected', Number(b.dataset.mb) === limit); });
  }
  thumbCache.onChange(renderCache);
  renderCache();

  function renderConnect() {
    $('conn-state').textContent = connected ? '연결됨' : '연결 안 됨';
    $('conn-state').classList.toggle('on', connected);
    var detail = $('conn-detail');
    detail.hidden = !info;
    if (info) detail.textContent = info.model + ' · 펌웨어 ' + info.firmware + ' · 앱 ' + info.appVersion;
  }

  // --- 갤러리 (gallery.tsx) ---------------------------------------------------------------------------

  var GAP = 2;
  var THUMB_TARGET = 125;
  var THUMB_TARGET_WIDE = 170;
  var photos = [];
  var total = null;
  var loading = false;
  var columnStep = 0;
  var selecting = false;
  var selected = {};
  var saving = null;

  function baseColumns() {
    // The sidebar takes some of a wide screen; thumbnails there can be larger
    var width = isWide() ? $('grid-scroll').clientWidth || viewport().width : viewport().width;
    return Math.max(3, Math.round(width / (isWide() ? THUMB_TARGET_WIDE : THUMB_TARGET)));
  }
  function columns() { return Math.max(1, Math.min(12, baseColumns() + columnStep)); }
  function layoutGrid() {
    var g = $('grid');
    g.style.gridTemplateColumns = 'repeat(' + columns() + ', minmax(0, 1fr))';
    // WebKit keeps painting the old columns after a rotation unless the grid is laid out afresh
    g.style.display = 'none'; void g.offsetHeight; g.style.display = '';
  }

  function loadPhotos(reset) {
    if (loading) return;
    loading = true;
    renderFooter();
    api.photos(reset ? 0 : photos.length, PAGE).then(function (page) {
      if (reset) { photos = []; $('grid').innerHTML = ''; }
      total = page.total;
      page.items.forEach(function (item) { photos.push(item); addCell(item, photos.length - 1); });
      loading = false;
      $('grid-footer').classList.remove('error');
      renderFooter();
      updateSelectBar();
    }, function (e) {
      loading = false;
      $('grid-footer').classList.add('error');
      $('grid-footer').textContent = String(e.message);
    });
  }
  function renderFooter() {
    var footer = $('grid-footer');
    footer.innerHTML = '';
    if (loading && photos.length > 0) footer.appendChild(el('span', 'spinner'));
    else if (total !== null) footer.textContent = '사진 ' + total + '장';
    footer.style.display = loading && photos.length > 0 ? 'flex' : '';
    footer.style.justifyContent = 'center';
  }

  function addCell(item, index) {
    var cell = el('div', 'cell');
    showThumb(cell, item);
    cell.dataset.index = index;
    if (item.raw) cell.appendChild(el('span', 'raw', 'RAW'));
    $('grid').appendChild(cell);
  }

  var gridScroll = $('grid-scroll');
  gridScroll.addEventListener('scroll', function () {
    // onEndReachedThreshold 1.5: the next page when within one and a half screens of the end
    if (!loading && total !== null && photos.length < total &&
        gridScroll.scrollTop + gridScroll.clientHeight * 2.5 > gridScroll.scrollHeight) loadPhotos(false);
  });

  // "선택" / "취소" in the title bar; the selection toolbar takes the tab bar's place
  function setSelecting(on, firstIndex) {
    selecting = on;
    selected = {};
    each(document.querySelectorAll('.cell.selected'), function (c) { c.classList.remove('selected'); });
    if (on && firstIndex !== undefined) setSelected(firstIndex, true);
    $('select-toggle').textContent = on ? '취소' : '선택';
    $('select-bar').hidden = !on;
    document.body.classList.toggle('selecting', on);
    updateSelectBar();
  }
  $('select-toggle').onclick = function () { if (!saving && photos.length) setSelecting(!selecting); };

  function selectedIds() { return photos.filter(function (p) { return selected[p.id]; }).map(function (p) { return p.id; }); }
  function updateSelectBar() {
    if (saving) return;
    var n = selectedIds().length;
    $('select-count').textContent = n > 0 ? n + '장의 사진이 선택됨' : '항목 선택';
    $('select-save').disabled = n === 0;
    $('select-raw').disabled = !selectedIds().some(function (id) { return (photoById(id) || {}).raw; });
    $('select-all').textContent = n > 0 && n === photos.length ? '선택 해제' : '모두 선택';
  }
  function setSelected(index, on) {
    var p = photos[index];
    if (!p) return;
    if (on) selected[p.id] = true; else delete selected[p.id];
    var cell = $('grid').children[index];
    if (cell) cell.classList.toggle('selected', on);
  }
  $('select-all').onclick = function () {
    var all = selectedIds().length !== photos.length;
    photos.forEach(function (p, i) { setSelected(i, all); });
    updateSelectBar();
  };

  // Tap opens (selecting: toggles), long press starts selecting with that photo, and while
  // selecting a sideways slide from a photo selects (or deselects) everything up to the finger
  var grid = $('grid');
  var touch = null;
  function cellIndexAt(x, y) {
    var target = document.elementFromPoint(x, y);
    var cell = target && target.closest ? target.closest('.cell') : null;
    return cell ? Number(cell.dataset.index) : -1;
  }
  grid.addEventListener('pointerdown', function (e) {
    var index = cellIndexAt(e.clientX, e.clientY);
    if (index < 0) return;
    touch = { index: index, x: e.clientX, y: e.clientY, drag: false, base: null, add: true, long: false };
    touch.timer = setTimeout(function () {
      if (!touch || touch.drag || selecting) return;
      touch.long = true;
      haptic(10);
      setSelecting(true, touch.index);
    }, 500);
  });
  grid.addEventListener('pointermove', function (e) {
    if (!touch) return;
    var dx = e.clientX - touch.x, dy = e.clientY - touch.y;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) clearTimeout(touch.timer);
    if (!selecting) return;
    if (!touch.drag) {
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      touch.drag = true;
      touch.add = !selected[photos[touch.index].id];
      touch.base = Object.assign({}, selected);
      try { grid.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
    touch.lastX = e.clientX;
    touch.lastY = e.clientY;
    applyDrag();
    autoScroll();
  });
  function applyDrag() {
    var end = cellIndexAt(touch.lastX, touch.lastY);
    if (end < 0) return;
    var lo = Math.min(touch.index, end), hi = Math.max(touch.index, end);
    photos.forEach(function (p, i) { setSelected(i, i >= lo && i <= hi ? touch.add : !!touch.base[p.id]); });
    updateSelectBar();
  }
  // Dragging near the top or bottom scrolls the grid
  var scroller = null;
  function autoScroll() {
    var r = gridScroll.getBoundingClientRect();
    var dir = !touch || !touch.drag ? 0 : touch.lastY < r.top + 70 ? -1 : touch.lastY > r.bottom - 70 ? 1 : 0;
    if (!dir) { clearInterval(scroller); scroller = null; return; }
    if (scroller) return;
    scroller = setInterval(function () {
      var rr = gridScroll.getBoundingClientRect();
      var d = !touch || !touch.drag ? 0 : touch.lastY < rr.top + 70 ? -1 : touch.lastY > rr.bottom - 70 ? 1 : 0;
      if (!d) { clearInterval(scroller); scroller = null; return; }
      gridScroll.scrollTop += d * 14;
      applyDrag();
    }, 16);
  }
  grid.addEventListener('pointerup', function () {
    var t = touch;
    touch = null;
    clearInterval(scroller); scroller = null;
    if (!t) return;
    clearTimeout(t.timer);
    if (t.drag || t.long) return;
    if (selecting) { setSelected(t.index, !selected[photos[t.index].id]); updateSelectBar(); }
    else openViewer(t.index);
  });
  grid.addEventListener('pointercancel', function () { if (touch) clearTimeout(touch.timer); touch = null; });
  grid.addEventListener('touchmove', function (e) { if (touch && touch.drag) e.preventDefault(); }, { passive: false });

  // Pinch the grid like Photos: spread for bigger thumbnails, pinch for more at once
  var pinch = null;
  function distance(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
  gridScroll.addEventListener('touchstart', function (e) {
    if (e.touches.length === 2) { pinch = { d: distance(e.touches), ratio: 1 }; if (touch) clearTimeout(touch.timer); touch = null; }
  }, { passive: true });
  gridScroll.addEventListener('touchmove', function (e) { if (pinch && e.touches.length === 2) pinch.ratio = distance(e.touches) / pinch.d; }, { passive: true });
  gridScroll.addEventListener('touchend', function () {
    if (!pinch) return;
    var steps = Math.round(Math.log(pinch.ratio) / Math.log(1.3));
    pinch = null;
    if (steps) { columnStep = Math.max(1, Math.min(12, baseColumns() + columnStep - steps)) - baseColumns(); layoutGrid(); }
  });

  // Downloads: browsers can't put files into Photos over http, so each original downloads (and
  // a long press on a photo in the viewer offers "Save to Photos")
  // raw: the ARW instead of the JPEG
  function download(item, onProgress, raw) {
    return fetch('/api/photos/' + item.id + (raw ? '/raw' : '/full')).then(function (res) {
      if (!res.ok) throw new Error(res.status);
      var totalBytes = Number(res.headers.get('Content-Length')) || -1;
      var name = ((res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1] || 'photo-' + item.id + (raw ? '.ARW' : '.jpg');
      if (onProgress) onProgress(0, totalBytes);
      if (!res.body || !res.body.getReader) return res.blob().then(function (b) { return { blob: b, name: name }; });
      var reader = res.body.getReader(), chunks = [], got = 0;
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return { blob: new Blob(chunks, { type: raw ? 'image/x-sony-arw' : 'image/jpeg' }), name: name };
          chunks.push(r.value);
          got += r.value.length;
          if (onProgress) onProgress(got, totalBytes);
          return pump();
        });
      }
      return pump();
    }).then(function (file) {
      var a = el('a');
      a.href = URL.createObjectURL(file.blob);
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    });
  }

  var galleryToastTimer;
  function galleryToast(text) {
    var t = $('gallery-toast');
    t.textContent = text;
    t.hidden = false;
    t.onclick = function () { t.hidden = true; };
    clearTimeout(galleryToastTimer);
    galleryToastTimer = setTimeout(function () { t.hidden = true; }, 3000);
  }

  function photoById(id) { return photos.filter(function (p) { return p.id === id; })[0]; }
  $('select-save').onclick = function () { saveSelected(false); };
  $('select-raw').onclick = function () { saveSelected(true); };
  // The JPEGs, or the RAW files of those shot with one
  function saveSelected(raw) {
    var ids = selectedIds().filter(function (id) { return !raw || (photoById(id) || {}).raw; });
    if (!ids.length || saving) return;
    saving = { done: 0, count: ids.length, written: 0, total: -1 };
    var bar = $('select-bar');
    var originals = Array.prototype.slice.call(bar.children);
    originals.forEach(function (c) { c.hidden = true; });
    var progress = el('div', 'save-progress');
    var trackEl = progress.appendChild(el('div', 'progress-track'));
    var fill = trackEl.appendChild(el('div', 'progress-fill'));
    var text = progress.appendChild(el('span', 'toolbar-text'));
    bar.appendChild(progress);
    function paint() {
      var frac = (saving.done + (saving.total > 0 ? saving.written / saving.total : 0)) / saving.count;
      fill.style.width = Math.round(frac * 100) + '%';
      text.textContent = (saving.done + 1) + ' / ' + saving.count + '장 받는 중' +
        (saving.total > 0 ? ' · ' + mb(saving.written) + ' / ' + mb(saving.total) + ' MB' : '');
    }
    paint();
    var failed = 0;
    var chain = Promise.resolve();
    ids.forEach(function (id, i) {
      chain = chain.then(function () {
        saving.done = i; saving.written = 0; saving.total = -1; paint();
        return download(photoById(id), function (got, totalBytes) { saving.written = got; saving.total = totalBytes; paint(); }, raw)
          .catch(function () { failed++; });
      });
    });
    chain.then(function () {
      saving = null;
      progress.remove();
      originals.forEach(function (c) { c.hidden = false; });
      var what = raw ? 'RAW ' : '';
      galleryToast(failed === 0 ? what + ids.length + '장을 받았어요' : what + (ids.length - failed) + '장 저장, ' + failed + '장 실패');
      if (failed === 0) setSelecting(false); else updateSelectBar();
    });
  }

  // --- 사진 보기 (photo/[id].tsx) -------------------------------------------------------------------

  var viewerIndex = 0;
  var details = {};
  var pages = $('pages');
  var viewer = $('viewer');
  var showInfo = false;

  function openViewer(index) {
    viewer.hidden = false;
    viewer.classList.remove('bare');
    showInfo = false;
    $('viewer-info').hidden = true;
    viewer.classList.remove('info-open');
    pages.innerHTML = '';
    $('strip').innerHTML = '';
    $('strip').appendChild(el('span', 'lead'));
    photos.forEach(function (item, i) {
      var page = el('div', 'page');
      page.dataset.index = i;
      pages.appendChild(page);
      var thumb = el('img');
      showThumb(thumb, item);
      thumb.onclick = function () { pages.scrollLeft = i * pages.clientWidth; showPage(i); };
      $('strip').appendChild(thumb);
    });
    $('strip').appendChild(el('span', 'lead'));
    sizeStrip();
    requestAnimationFrame(function () {
      pages.scrollLeft = index * pages.clientWidth;
      showPage(index);
      viewer.classList.add('open');
    });
  }
  function closeViewer() {
    viewer.classList.remove('open');
    setTimeout(function () { viewer.hidden = true; pages.innerHTML = ''; }, 350);
  }
  $('viewer-back').onclick = closeViewer;
  $('viewer-back2').onclick = closeViewer;

  // The strip keeps the current photo in the middle
  function sizeStrip() {
    each($('strip').querySelectorAll('.lead'), function (l) { l.style.width = (viewport().width / 2 - 23) + 'px'; });
  }

  function fillPage(i) {
    var page = pages.children[i];
    var item = photos[i];
    if (!page || !item || page.filled) return;
    page.filled = true;
    var layer = page.appendChild(el('div', 'zoom-layer'));
    // The app centres the photo on the whole screen, status bar included; a home-screen web app with
    // an opaque status bar starts below it, so move the photo up by half the bar
    var shift = centreShift();
    layer.style.top = shift + 'px';
    layer.style.bottom = -shift + 'px';
    // Already upright and cached by the gallery: shows at once
    showThumb(layer.appendChild(el('img', 'thumb')), item);
    withDetails(item, function (d) {
      var deg = exifRotation(d.orientation);
      var sideways = deg === 90 || deg === 270;
      var aspect = sideways ? d.height / d.width : d.width / d.height;
      var b = fit(page.clientWidth, page.clientHeight, aspect);
      var box = el('div', 'box');
      box.style.width = b.width + 'px';
      box.style.height = b.height + 'px';
      box.style.transform = 'translate(-50%, -50%)';
      // The preview has no EXIF orientation: laid out unrotated, then turned
      var preview = el('img');
      preview.style.width = (sideways ? b.height : b.width) + 'px';
      preview.style.height = (sideways ? b.width : b.height) + 'px';
      preview.style.transform = 'translate(-50%, -50%) rotate(' + deg + 'deg)';
      preview.style.opacity = '0';
      preview.onload = function () { preview.style.transition = 'opacity .12s'; preview.style.opacity = '1'; };
      preview.src = photoUrl(item, 'preview');
      box.appendChild(preview);
      layer.appendChild(box);
      page.box = box;
    });
  }

  function centreShift() {
    if (!window.navigator.standalone) return 0;
    var vp = viewport();
    var landscape = vp.width > vp.height;
    var full = landscape ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
    return -Math.max(0, full - vp.height) / 2;
  }

  function withDetails(item, callback) {
    if (details[item.id]) return callback(details[item.id]);
    api.photo(item.id).then(function (d) { details[item.id] = d; callback(d); }, function () {});
  }

  function showPage(index) {
    if (viewerIndex !== index) resetZoom(pages.children[viewerIndex]);
    viewerIndex = index;
    [index, index + 1, index - 1].forEach(fillPage);
    var item = photos[index];
    if (!item) return;
    $('viewer-count').textContent = (index + 1) + ' / ' + photos.length;
    each($('strip').querySelectorAll('img'), function (t, i) { t.classList.toggle('current', i === index); });
    var current = $('strip').querySelectorAll('img')[index];
    if (current) $('strip').scrollLeft = current.offsetLeft - viewport().width / 2 + 23;
    renderSave(item);
    withDetails(item, function (d) {
      if (viewerIndex !== index) return;
      $('viewer-title').textContent = d.name;
      $('viewer-title2').textContent = d.name;
      var narrow = viewport().width > viewport().height;
      var panel = $('viewer-info');
      panel.innerHTML = '';
      var box = panel.appendChild(el('div', 'info'));
      box.appendChild(el('span', 'info-date', d.date));
      var values = box.appendChild(el('div', 'exposure'));
      [formatExposure(d.exposureTime), 'F' + d.aperture, 'ISO ' + d.iso, Math.round(d.focalLength) + 'mm'].forEach(function (v) {
        values.appendChild(el('span', '', v));
      });
      box.appendChild(el('span', 'meta', narrow ? d.folder + '/' + d.name + '\n' + d.width + ' × ' + d.height
        : d.folder + '/' + d.name + ' · ' + d.width + ' × ' + d.height));
      layoutViewerInfo();
    });
  }

  // Upright the info sits under the photo, clear of the bottom bar
  function layoutViewerInfo() {
    var panel = $('viewer-info');
    var landscape = viewport().width > viewport().height;
    var barH = viewer.classList.contains('bare') ? 0 : $('viewer-bottom').offsetHeight;
    panel.style.paddingBottom = landscape ? '' : (barH + 8) + 'px';
  }

  var scrollTimer;
  pages.addEventListener('scroll', function () {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function () {
      var i = Math.round(pages.scrollLeft / pages.clientWidth);
      if (i !== viewerIndex && photos[i]) showPage(i);
    }, 60);
  });

  // Tap: show or hide the bars
  pages.addEventListener('click', function () {
    if (zoom.moved) return;
    viewer.classList.toggle('bare');
    layoutViewerInfo();
  });
  $('viewer-info-toggle').onclick = function () {
    showInfo = !showInfo;
    $('viewer-info').hidden = !showInfo;
    viewer.classList.toggle('info-open', showInfo);
    $('viewer-info-toggle').firstChild.textContent = showInfo ? '' : '';
    layoutViewerInfo();
    setTimeout(function () { pages.scrollLeft = viewerIndex * pages.clientWidth; refitPages(); }, 0);
  };
  // The pages change size with the info panel or the orientation: lay the photos out again
  function refitPages() {
    each(pages.children, function (page) { if (page.filled) { page.innerHTML = ''; page.filled = false; } });
    [viewerIndex, viewerIndex + 1, viewerIndex - 1].forEach(fillPage);
  }

  // Pinch to zoom (ScrollView maximumZoomScale 5); past 1.5x the original loads; zoomed in, one
  // finger moves the photo and the pages stop paging
  var zoom = { scale: 1, x: 0, y: 0, moved: false };
  function applyZoom(page) {
    var layer = page && page.querySelector('.zoom-layer');
    if (layer) layer.style.transform = 'translate(' + zoom.x + 'px, ' + zoom.y + 'px) scale(' + zoom.scale + ')';
    pages.classList.toggle('zoomed', zoom.scale > 1.01);
    if (zoom.scale > 1.5 && page && page.box && !page.box.querySelector('.full')) {
      var full = el('img', 'full');
      full.src = '/api/photos/' + photos[viewerIndex].id + '/full';
      full.style.opacity = '0';
      full.onload = function () { full.style.transition = 'opacity .2s'; full.style.opacity = '1'; };
      page.box.appendChild(full);
    }
  }
  function resetZoom(page) {
    zoom = { scale: 1, x: 0, y: 0, moved: false };
    applyZoom(page);
  }
  var gesture = null;
  pages.addEventListener('touchstart', function (e) {
    var page = pages.children[viewerIndex];
    if (e.touches.length === 2) {
      var r = page.getBoundingClientRect();
      var cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
      var cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
      gesture = { type: 'pinch', d: distance(e.touches), scale: zoom.scale, x: zoom.x, y: zoom.y, cx: cx, cy: cy };
    } else if (e.touches.length === 1 && zoom.scale > 1.01) {
      gesture = { type: 'pan', sx: e.touches[0].clientX, sy: e.touches[0].clientY, x: zoom.x, y: zoom.y };
      zoom.moved = false;
    }
  }, { passive: true });
  pages.addEventListener('touchmove', function (e) {
    if (!gesture) return;
    var page = pages.children[viewerIndex];
    var w = page.clientWidth, h = page.clientHeight;
    if (gesture.type === 'pinch' && e.touches.length === 2) {
      e.preventDefault();
      var scale = Math.max(1, Math.min(5, gesture.scale * distance(e.touches) / gesture.d));
      // Keep the point under the fingers in place
      var px = (gesture.cx - gesture.x) / gesture.scale, py = (gesture.cy - gesture.y) / gesture.scale;
      zoom.scale = scale;
      zoom.x = gesture.cx - px * scale;
      zoom.y = gesture.cy - py * scale;
    } else if (gesture.type === 'pan' && e.touches.length === 1) {
      e.preventDefault();
      var dx = e.touches[0].clientX - gesture.sx, dy = e.touches[0].clientY - gesture.sy;
      if (Math.abs(dx) + Math.abs(dy) > 4) zoom.moved = true;
      zoom.x = gesture.x + dx;
      zoom.y = gesture.y + dy;
    } else {
      return;
    }
    zoom.x = Math.min(0, Math.max(w - w * zoom.scale, zoom.x));
    zoom.y = Math.min(0, Math.max(h - h * zoom.scale, zoom.y));
    applyZoom(page);
  }, { passive: false });
  pages.addEventListener('touchend', function (e) {
    if (e.touches.length === 0) {
      gesture = null;
      if (zoom.scale <= 1.01) resetZoom(pages.children[viewerIndex]);
      setTimeout(function () { zoom.moved = false; }, 0);
    }
  });

  // SaveButton: the original with its progress, then a message in its place
  function renderSave(item, progress, message) {
    var wrap = $('viewer-save');
    wrap.innerHTML = '';
    if (progress) {
      var p = wrap.appendChild(el('div', 'progress'));
      var t = p.appendChild(el('div', 'progress-track'));
      var f = t.appendChild(el('div', 'progress-fill'));
      f.style.width = (progress.total > 0 ? Math.round(progress.written / progress.total * 100) : 0) + '%';
      p.appendChild(el('span', 'progress-text', progress.total > 0 ? mb(progress.written) + ' / ' + mb(progress.total) + ' MB' : '연결 중...'));
    } else if (message) {
      var m = wrap.appendChild(el('button', 'save-message', message));
      m.onclick = function () { renderSave(item); };
    } else {
      // Shot as RAW + JPEG: the ARW has a button of its own
      if (item.raw) {
        var r = wrap.appendChild(el('button', 'raw-button'));
        r.setAttribute('aria-label', 'RAW(ARW) 파일 받기');
        r.title = 'RAW(ARW) 파일 받기';
        r.appendChild(el('i', 'ion', '\uf2ba'));
        r.appendChild(el('span', '', 'RAW'));
        r.onclick = function () { save(true); };
      }
      var b = wrap.appendChild(el('button', 'tool-button'));
      b.setAttribute('aria-label', '원본을 사진 앱에 저장');
      b.title = 'JPEG 원본 받기';
      var icon = b.appendChild(el('i', 'ion', '\uf2ba'));
      icon.style.fontSize = '25px';
      b.onclick = function () { save(false); };
    }
    function save(raw) {
      renderSave(item, { written: 0, total: -1 });
      download(item, function (got, totalBytes) {
        if (photos[viewerIndex] === item) renderSave(item, { written: got, total: totalBytes });
      }, raw).then(function () { if (photos[viewerIndex] === item) renderSave(item, null, raw ? 'RAW를 받았어요' : '원본을 받았어요'); },
        function (e) { if (photos[viewerIndex] === item) renderSave(item, null, '저장 실패: ' + e.message); });
    }
  }

  // --- page behaviour ------------------------------------------------------------------------------
  // iOS Safari ignores user-scalable=no: stop its pinch zoom (the grid and the viewer read raw
  // touches for their own) and the long-press menu, except on photos in the viewer

  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (type) {
    document.addEventListener(type, function (e) { e.preventDefault(); }, { passive: false });
  });
  document.addEventListener('touchmove', function (e) {
    if (e.touches.length > 1 && !e.target.closest('#grid-scroll, #pages')) e.preventDefault();
  }, { passive: false });
  document.addEventListener('contextmenu', function (e) { if (!e.target.closest('.page img')) e.preventDefault(); });
  document.addEventListener('dragstart', function (e) { e.preventDefault(); });
  document.addEventListener('selectstart', function (e) { if (!e.target.closest || !e.target.closest('input')) e.preventDefault(); });

  // --- keyboard (computers, tablets with one) --------------------------------------------------------
  // Space shoots, F held half-presses, W/T held zoom; in the photo viewer the arrows turn pages,
  // I shows the info and Esc closes; 1-3 switch tabs

  var KEY_TABS = { 1: 'shoot', 2: 'gallery', 3: 'connect' };
  var keyZoom = { w: 'wide', t: 'tele' };
  document.addEventListener('keydown', function (e) {
    if (e.target.closest && e.target.closest('input') || e.metaKey || e.ctrlKey || e.altKey) return;
    var key = e.key.toLowerCase();
    if (!$('sheet').hidden) {
      if (key === 'escape') closeSheet();
      else if (key === 'enter') $('sheet-done').onclick();
      else return;
    } else if (!viewer.hidden) {
      if (key === 'escape') closeViewer();
      else if (key === 'arrowleft' || key === 'arrowright') {
        var next = viewerIndex + (key === 'arrowleft' ? -1 : 1);
        if (photos[next]) { pages.scrollTo({ left: next * pages.clientWidth, behavior: 'smooth' }); showPage(next); }
      } else if (key === 'i') $('viewer-info-toggle').onclick();
      else return;
    } else if (KEY_TABS[key]) {
      showTab(KEY_TABS[key]);
    } else if (tab === 'gallery' && key === 'escape' && selecting) {
      setSelecting(false);
    } else if (tab === 'shoot' && (key === ' ' || key === 'enter')) {
      if (!e.repeat) shutter.onclick();
    } else if (tab === 'shoot' && key === 'f') {
      if (!e.repeat) afPress();
    } else if (tab === 'shoot' && keyZoom[key]) {
      zoomStart(keyZoom[key]);
    } else {
      return;
    }
    e.preventDefault();
  });
  document.addEventListener('keyup', function (e) {
    var key = e.key.toLowerCase();
    if (key === 'f') afRelease();
    if (keyZoom[key]) zoomStop(keyZoom[key]);
  });
  // A key held while the window loses focus never comes back up
  window.addEventListener('blur', function () { afRelease(); zoomStop('wide'); zoomStop('tele'); });

  // --- start ---------------------------------------------------------------------------------------

  function relayout() {
    applyWide();
    layoutGrid();
    try { render(); } catch (e) { /* the shooting screen re-lays itself out when shown */ }
    if (!viewer.hidden) { sizeStrip(); refitPages(); pages.scrollLeft = viewerIndex * pages.clientWidth; showPage(viewerIndex); }
  }
  // iOS reports the new size a moment after it rotates
  window.addEventListener('resize', relayout);
  window.addEventListener('orientationchange', function () { setTimeout(relayout, 300); });
  document.body.classList.add('on-shoot');
  render();
  renderConnect();
  pollState();
  setInterval(pollState, STATE_POLL_MS);
  setInterval(function () { if (connected) refreshLatest(); }, LATEST_POLL_MS);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) live.removeAttribute('src');
    else if (connected) startLive();
  });
})();
