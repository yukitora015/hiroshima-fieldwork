/* Local navigation schematic, not a slippy map. Uses only the fetched walking
   route and the verified OSM landmark coordinates; no invented side streets.
   Route geometry is rotated mathematically, labels are always upright. */
(function () {
  'use strict';
  const WIDTH = 360, HEIGHT = 300, ORIGIN_X = 180, ORIGIN_Y = 200;
  const DEFAULT_SCALE = 1.925;
  const DEG = Math.PI / 180;
  let landmarks = [], loaded = false, loadPromise = null, context = null;
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
  function chooseScale(nextDistance) {
    if (!Number.isFinite(nextDistance) || nextDistance <= 0) return DEFAULT_SCALE;
    // Keep the next point in the forward part of the panel when possible,
    // while limiting zoom so nearby streets remain legible.
    return Math.max(0.9, Math.min(2.4, 130 / Math.max(nextDistance, 1)));
  }

  function project(point, center, travelBearing, scale = DEFAULT_SCALE) {
    const north = (point[0] - center[0]) * 111195;
    const east = (point[1] - center[1]) * 111195 * Math.cos(center[0] * DEG);
    const rad = travelBearing * DEG;
    const right = east * Math.cos(rad) - north * Math.sin(rad);
    const forward = east * Math.sin(rad) + north * Math.cos(rad);
    return [ORIGIN_X + scale * right, ORIGIN_Y - scale * forward];
  }

  function escapeText(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }
  const fixed = n => Number(n).toFixed(1);
  function shape(points, center, travelBearing, scale) {
    // Use the exact ordered OSM routing geometry, not a synthetic shortcut.
    return points.map(point => {
      const xy = project(point, center, travelBearing, scale);
      return fixed(xy[0]) + ',' + fixed(xy[1]);
    }).join(' ');
  }

  function routeLayer(points, center, travelBearing, stroke, scale) {
    if (!Array.isArray(points) || points.length < 2) return '';
    const coords = shape(points, center, travelBearing, scale);
    return `<polyline points="${coords}" fill="none" stroke="#f8faf5" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<polyline points="${coords}" fill="none" stroke="#cad8ce" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<polyline points="${coords}" fill="none" stroke="${stroke}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  // Every background geometry comes from the bounded OSM extract. Ways and
  // closed areas are projected by the same transform as the walking route.
  function backgroundLayer(data, center, travelBearing, scale) {
    if (!inCoverage(data,center)) return '';
    const items = data.features.filter(f => f && Array.isArray(f.points) && f.points.length >= 2 &&
      Array.isArray(f.bounds) && f.bounds[0] <= center[0]+0.002 && f.bounds[2] >= center[0]-0.002 &&
      f.bounds[1] <= center[1]+0.0025 && f.bounds[3] >= center[1]-0.0025);
    const parts=[];
    for (const kind of ['water','green','building','road']) {
      for (const f of items) {
        if (f.kind !== kind) continue;
        const coords=shape(f.points,center,travelBearing,scale);
        if(kind==='road') {
          const minor=['footway','path','steps','pedestrian','cycleway'].includes(f.subtype);
          parts.push(`<polyline class="context-road" points="${coords}" fill="none" stroke="#d6a35e" stroke-width="${minor?4:9}" stroke-linecap="round" stroke-linejoin="round"/>`);
          parts.push(`<polyline points="${coords}" fill="none" stroke="${minor?'#f2e5c6':'#f8edcf'}" stroke-width="${minor?2:5}" stroke-linecap="round" stroke-linejoin="round"/>`);
        } else {
          const color={water:'#b8d5e8',green:'#d4e6bd',building:'#cdc8b5'}[kind];
          parts.push(`<polygon class="context-${kind}" points="${coords}" fill="${color}" stroke="${color}" stroke-width="1"/>`);
        }
      }
    }
    return parts.join('');
  }

  function inCoverage(data,point) {
    const b=data?.bounds;
    return Array.isArray(data?.features) && Array.isArray(b) && b.length===4 &&
      point[0]>=b[0] && point[0]<=b[2] && point[1]>=b[1] && point[1]<=b[3];
  }

  function destinationPin(slice, travelBearing, scale) {
    const destination = slice.future[slice.future.length-1];
    if (!destination || distance(slice.point,destination)>200) return '';
    const [x,y] = project(destination,slice.point,travelBearing,scale);
    if (x<15 || x>WIDTH-15 || y<40 || y>HEIGHT-15) return '';
    return `<g class="destination-pin"><circle cx="${fixed(x)}" cy="${fixed(y)}" r="8" fill="#cf4038" stroke="#fff" stroke-width="3"/><title>区間の目的地</title></g>`;
  }

  function turnDots(turns, slice, travelBearing, scale) {
    const parts = [];
    for (const turn of turns || []) {
      if (!Array.isArray(turn.location) || distance(slice.point, turn.location) < 6 || distance(slice.point, turn.location) > 200) continue;
      const [x, y] = project(turn.location, slice.point, travelBearing, scale);
      if (x < 12 || x > WIDTH - 12 || y < 25 || y > HEIGHT - 15) continue;
      parts.push(`<circle cx="${fixed(x)}" cy="${fixed(y)}" r="5" fill="#fff" stroke="#126951" stroke-width="2"/>`);
    }
    return parts.join('');
  }

  function verifiedLandmarks(data, slice, travelBearing, scale) {
    const seenNames = new Set();
    const occupied = [];
    const output = [];
    const nearby = (Array.isArray(data) ? data : [])
      .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon) && typeof p.name === 'string' && p.name.trim() && p.name.trim() !== '広島')
      .filter(p => distance(slice.point, [p.lat, p.lon]) < 200)
      .sort((a, b) => distance(slice.point, [a.lat, a.lon]) - distance(slice.point, [b.lat, b.lon]));
    for (const p of nearby) {
      if (output.length >= 4) break;
      const name = p.name.trim();
      if (seenNames.has(name)) continue;
      const [x, y] = project([p.lat, p.lon], slice.point, travelBearing, scale);
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
  function renderSvg(slice, turns = [], landmarksData = [], contextData = null, nextDistance = null) {
    if (!slice || !Array.isArray(slice.point) || !Array.isArray(slice.past) || !Array.isArray(slice.future)) return '';
    const travelBearing = heading(slice);
    if (travelBearing === null) return '<p class="schematic-unavailable">進行方向を確認できないため局所図を表示できません。</p>';
    const scale = chooseScale(nextDistance);
    const past = routeLayer(slice.past, slice.point, travelBearing, '#9caaa2', scale);
    const future = routeLayer(slice.future, slice.point, travelBearing, '#087e64', scale);
    const landmarksHtml = verifiedLandmarks(landmarksData, slice, travelBearing, scale);
    const background = backgroundLayer(contextData, slice.point, travelBearing, scale);
    const destination = destinationPin(slice, travelBearing, scale);
    const dots = turnDots(turns, slice, travelBearing, scale);
    const barMetres = [10,20,25,40,50,75,100].reduce((best,n)=>Math.abs(n*scale-70)<Math.abs(best*scale-70)?n:best,10);
    const barStart = 330-barMetres*scale;
    // All text lives in the unrotated SVG coordinate space.
    return `<svg class="nav-schematic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="選択地点周辺の実際の歩行ルートを簡略化した図。進行方向が上。現在地は手動選択。">
      <defs><clipPath id="nav-schematic-clip"><rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" rx="14"/></clipPath></defs>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="#f6f0d9" rx="14"/>
      <g clip-path="url(#nav-schematic-clip)">${background}${past}${future}${dots}${destination}${landmarksHtml}</g>
      <circle cx="${ORIGIN_X}" cy="${ORIGIN_Y}" r="13" fill="#ffffff" stroke="#bf4038" stroke-width="3"/>
      <path d="M ${ORIGIN_X} ${ORIGIN_Y-9} l -6 15 6 -3 6 3 Z" fill="#d6493e"/>
      <rect x="125" y="8" rx="14" width="110" height="27" fill="#ffffff" stroke="#c9dbcc"/>
      <text x="180" y="26" text-anchor="middle" font-size="12" font-weight="800" fill="#125943">進行方向 ↑</text>
      <rect x="9" y="266" rx="8" width="125" height="25" fill="#ffffff" opacity=".96"/>
      <text x="18" y="283" font-size="11" font-weight="700" fill="#245344">● 選択した現在地</text>
      <line x1="${fixed(barStart)}" y1="283" x2="330" y2="283" stroke="#436251" stroke-width="3"/>
      <line x1="${fixed(barStart)}" y1="278" x2="${fixed(barStart)}" y2="288" stroke="#436251" stroke-width="2"/>
      <line x1="330" y1="278" x2="330" y2="288" stroke="#436251" stroke-width="2"/>
      <text x="${fixed((barStart+330)/2)}" y="275" text-anchor="middle" font-size="10" fill="#345747">約${barMetres}m</text>
    </svg>`;
  }

  function loadLandmarks() {
    if (loaded) return Promise.resolve(landmarks);
    if (loadPromise) return loadPromise;
    loadPromise = Promise.all([fetch('data/landmarks.json'),fetch('data/context.json?v=1')])
      .then(async ([a,b]) => {if(!a.ok || !b.ok)throw new Error('map data unavailable'); return [await a.json(),await b.json()];})
      .then(([data,geo]) => { if(!geo || !Array.isArray(geo.features))throw new Error('invalid map data'); context=geo; landmarks = (Array.isArray(data) ? data : []).concat(Array.isArray(geo.landmarks)?geo.landmarks:[]); })
      .catch(() => { landmarks = []; context=null; })
      .then(() => { loaded = true; return landmarks; });
    return loadPromise;
  }

  function reset() {
    generation++;
    lastSlice = null;
    lastTurns = [];
  }

  async function update(slice, turns = [], nextDistance = null) {
    lastSlice = slice;
    lastTurns = turns;
    const outer = document.getElementById('local-map');
    const seq = ++generation;
    if (!outer) return;
    outer.innerHTML = renderSvg(slice, turns, landmarks, context, nextDistance);
    await loadLandmarks();
    if (seq !== generation || document.getElementById('local-map') !== outer) return;
    outer.innerHTML = renderSvg(slice, turns, landmarks, context, nextDistance);
    if (!inCoverage(context,slice.point)) outer.insertAdjacentHTML('beforeend','<p class="context-unavailable">周辺道路データを表示できません。下の通常地図で確認してください。</p>');
  }

  window.FieldworkLocalMap = Object.freeze({
    update, reset, bearing, heading, distance, project, renderSvg, chooseScale
  });
})();
