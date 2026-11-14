/* Local navigation schematic, not a slippy map. Uses only the fetched walking
   route and the verified OSM landmark coordinates; no invented side streets.
   Route geometry is rotated mathematically, labels are always upright. */
(function () {
  'use strict';
  const WIDTH = 360, HEIGHT = 300, ORIGIN_X = 180, ORIGIN_Y = 200;
  const PX_PER_METRE = 1.4;
  const DEG = Math.PI / 180;
  let landmarks = [], loaded = false, loadPromise = null;
  let generation = 0, lastSlice = null, lastTurns = [];

  function bearing(a, b) {
    const lat1 = a[0] * DEG, lat2 = b[0] * DEG;
    const dLon = (b[1] - a[1]) * DEG;
    return (Math.atan2(Math.sin(dLon) * Math.cos(lat2),
      Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)) / DEG + 360) % 360;
  }

  function distance(a, b) {
    const dy = (b[0] - a[0]) * DEG;
    const dx = (b[1] - a[1]) * DEG * Math.cos((a[0] + b[0]) / 2 * DEG);
    return Math.hypot(dx, dy) * 6371000;
  }

  function heading(slice) {
    for (const p of slice.future) if (distance(slice.point, p) > 2) return bearing(slice.point, p);
    for (let i = slice.past.length - 1; i >= 0; i--) {
      if (distance(slice.past[i], slice.point) > 2) return bearing(slice.past[i], slice.point);
    }
    return null;
  }

  // Geographic points are mapped into a local metre grid and rotated so the
  // selected travel direction is visually up. This does NOT rotate SVG text.
  function project(point, center, travelBearing) {
    const north = (point[0] - center[0]) * 111195;
    const east = (point[1] - center[1]) * 111195 * Math.cos(center[0] * DEG);
    const rad = travelBearing * DEG;
    const right = east * Math.cos(rad) - north * Math.sin(rad);
    const forward = east * Math.sin(rad) + north * Math.cos(rad);
    return [ORIGIN_X + PX_PER_METRE * right, ORIGIN_Y - PX_PER_METRE * forward];
  }

  function escapeText(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }
  const fixed = n => Number(n).toFixed(1);
  function shape(points, center, travelBearing) {
    // Use the exact ordered OSM routing geometry, not a synthetic shortcut.
    return points.map(point => {
      const xy = project(point, center, travelBearing);
      return fixed(xy[0]) + ',' + fixed(xy[1]);
    }).join(' ');
  }

  function routeLayer(points, center, travelBearing, stroke) {
    if (!Array.isArray(points) || points.length < 2) return '';
    const coords = shape(points, center, travelBearing);
    return `<polyline points="${coords}" fill="none" stroke="#f8faf5" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<polyline points="${coords}" fill="none" stroke="#cad8ce" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<polyline points="${coords}" fill="none" stroke="${stroke}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  function turnDots(turns, slice, travelBearing) {
    const parts = [];
    for (const turn of turns || []) {
      if (!Array.isArray(turn.location) || distance(slice.point, turn.location) < 6 || distance(slice.point, turn.location) > 130) continue;
      const [x, y] = project(turn.location, slice.point, travelBearing);
      if (x < 12 || x > WIDTH - 12 || y < 25 || y > HEIGHT - 15) continue;
      parts.push(`<circle cx="${fixed(x)}" cy="${fixed(y)}" r="5" fill="#fff" stroke="#126951" stroke-width="2"/>`);
    }
    return parts.join('');
  }

  function verifiedLandmarks(data, slice, travelBearing) {
    const seenNames = new Set();
    const occupied = [];
    const output = [];
    const nearby = (Array.isArray(data) ? data : [])
      .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon) && typeof p.name === 'string' && p.name.trim() && p.name.trim() !== '広島')
      .filter(p => distance(slice.point, [p.lat, p.lon]) < 115)
      .sort((a, b) => distance(slice.point, [a.lat, a.lon]) - distance(slice.point, [b.lat, b.lon]));
    for (const p of nearby) {
      if (output.length >= 4) break;
      const name = p.name.trim();
      if (seenNames.has(name)) continue;
      const [x, y] = project([p.lat, p.lon], slice.point, travelBearing);
      // Pins are at the actual OSM coordinates; labels may be offset but are
      // always upright and kept inside the visible schematic.
      if (x < 18 || x > 342 || y < 40 || y > 270) continue;
      if (Math.hypot(x - ORIGIN_X, y - ORIGIN_Y) < 26) continue;
      const caption = name.length > 12 ? name.slice(0, 11) + '…' : name;
      const width = Math.min(146, Math.max(48, Array.from(caption).length * 11 + 12));
      const labelX = Math.min(WIDTH - width - 8, Math.max(8, x > 224 ? x - width - 9 : x + 9));
      const labelY = Math.min(HEIGHT - 25, Math.max(31, y - 14));
      const rect = [labelX, labelY, width, 25];
      if (occupied.some(r => rect[0] < r[0] + r[2] + 5 && r[0] < rect[0] + rect[2] + 5 && rect[1] < r[1] + r[3] + 5 && r[1] < rect[1] + rect[3] + 5)) continue;
      occupied.push(rect);
      seenNames.add(name);
      output.push(`<g class="schematic-landmark"><circle cx="${fixed(x)}" cy="${fixed(y)}" r="5.5" fill="#d78a3f" stroke="#fff" stroke-width="2"/>` +
        `<rect x="${fixed(labelX)}" y="${fixed(labelY)}" width="${width}" height="25" rx="7" fill="#fffefa" stroke="#d3c2ab"/>` +
        `<text x="${fixed(labelX + 7)}" y="${fixed(labelY + 17)}" font-size="11" font-weight="700" fill="#57412c">${escapeText(caption)}</text></g>`);
    }
    return output.join('');
  }

  // Pure function for reproducible unit tests and server-side previews.
  function renderSvg(slice, turns = [], landmarksData = []) {
    if (!slice || !Array.isArray(slice.point) || !Array.isArray(slice.past) || !Array.isArray(slice.future)) return '';
    const travelBearing = heading(slice);
    if (travelBearing === null) return '<p class="schematic-unavailable">進行方向を確認できないため局所図を表示できません。</p>';
    const past = routeLayer(slice.past, slice.point, travelBearing, '#9caaa2');
    const future = routeLayer(slice.future, slice.point, travelBearing, '#087e64');
    const landmarksHtml = verifiedLandmarks(landmarksData, slice, travelBearing);
    const dots = turnDots(turns, slice, travelBearing);
    // All text lives in the unrotated SVG coordinate space.
    return `<svg class="nav-schematic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="選択地点周辺の実際の歩行ルートを簡略化した図。進行方向が上。現在地は手動選択。">
      <defs><clipPath id="nav-schematic-clip"><rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" rx="14"/></clipPath></defs>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="#edf4ed" rx="14"/>
      <g clip-path="url(#nav-schematic-clip)">${past}${future}${dots}${landmarksHtml}</g>
      <circle cx="${ORIGIN_X}" cy="${ORIGIN_Y}" r="13" fill="#ffffff" stroke="#0d6f59" stroke-width="3"/>
      <circle cx="${ORIGIN_X}" cy="${ORIGIN_Y}" r="6.5" fill="#0d6f59"/>
      <rect x="125" y="8" rx="14" width="110" height="27" fill="#ffffff" stroke="#c9dbcc"/>
      <text x="180" y="26" text-anchor="middle" font-size="12" font-weight="800" fill="#125943">進行方向 ↑</text>
      <rect x="9" y="266" rx="8" width="125" height="25" fill="#ffffff" opacity=".96"/>
      <text x="18" y="283" font-size="11" font-weight="700" fill="#245344">● 選択した現在地</text>
      <line x1="260" y1="283" x2="330" y2="283" stroke="#436251" stroke-width="3"/>
      <line x1="260" y1="278" x2="260" y2="288" stroke="#436251" stroke-width="2"/>
      <line x1="330" y1="278" x2="330" y2="288" stroke="#436251" stroke-width="2"/>
      <text x="295" y="275" text-anchor="middle" font-size="10" fill="#345747">約50m</text>
    </svg>`;
  }

  function loadLandmarks() {
    if (loaded) return Promise.resolve(landmarks);
    if (loadPromise) return loadPromise;
    loadPromise = fetch('data/landmarks.json')
      .then(r => { if (!r.ok) throw new Error('landmarks unavailable'); return r.json(); })
      .then(data => { landmarks = Array.isArray(data) ? data : []; })
      .catch(() => { landmarks = []; })
      .then(() => { loaded = true; return landmarks; });
    return loadPromise;
  }

  function reset() {
    generation++;
    lastSlice = null;
    lastTurns = [];
  }

  async function update(slice, turns = []) {
    lastSlice = slice;
    lastTurns = turns;
    const outer = document.getElementById('local-map');
    const seq = ++generation;
    if (!outer) return;
    outer.innerHTML = renderSvg(slice, turns, landmarks);
    await loadLandmarks();
    if (seq !== generation || document.getElementById('local-map') !== outer) return;
    outer.innerHTML = renderSvg(slice, turns, landmarks);
  }

  window.FieldworkLocalMap = Object.freeze({
    update, reset, bearing, heading, distance, project, renderSvg
  });
})();
