/* Road-network routes only. There is intentionally NO synthetic straight-line fallback. */
(function () {
  'use strict';
  const cache = new Map();
  const inFlight = new Map();
  let requestChain = Promise.resolve();
  let lastRequest = 0;

  function metres(a, b) {
    const r = Math.PI / 180;
    const dLat = (a[0] - b[0]) * r;
    const dLon = (a[1] - b[1]) * r;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  function checkFootPath(raw, start, end) {
    if (!Array.isArray(raw) || raw.length < 2 || raw.length > 40000) throw new Error('道路の形状が取得できません');
    const points = raw.map(([lon, lat]) => [lat, lon]);
    if (points.some(([lat, lon]) => !Number.isFinite(lat) || !Number.isFinite(lon) || lat < 34.2 || lat > 34.6 || lon < 132.2 || lon > 132.7)) throw new Error('道路形状の位置が不正です');
    if (metres(start, points[0]) > 80 || metres(end, points[points.length - 1]) > 80) throw new Error('施設から道路まで距離があります');
    return points;
  }
  function instruction(step) {
    const m = step.maneuver || {};
    const name = step.name ? `（${step.name}）` : '';
    const distance = step.distance > 0 ? `（約${Math.round(step.distance)}m）` : '';
    if (m.type === 'arrive') return '目的地に到着';
    if (m.type === 'depart') return `出発${name}${distance}`;
    const modifiers = {
      left: '左折', right: '右折', straight: '直進',
      'slight left': 'やや左へ', 'slight right': 'やや右へ',
      'sharp left': '大きく左折', 'sharp right': '大きく右折', uturn: 'Uターン'
    };
    const special = {roundabout:'環状交差点に進入', rotary:'環状交差点に進入', 'exit roundabout':'環状交差点から出る', 'exit rotary':'環状交差点から出る', ferry:'フェリーに乗る'};
    const action = special[m.type] || modifiers[m.modifier];
    return action ? `${action}${name}${distance}` : `経路上の次の地点${name}${distance}（詳細は地図で確認）`;
  }
  async function requestJson(url) {
    const job = requestChain.then(async () => {
      const delay = Math.max(0, 1200 - (Date.now() - lastRequest));
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      lastRequest = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 14000);
      try {
        const response = await fetch(url, { signal: controller.signal, mode: 'cors' });
        if (!response.ok) throw new Error('経路サービスの応答: ' + response.status);
        return await response.json();
      } finally {
        clearTimeout(timer);
      }
    });
    requestChain = job.then(() => {}, () => {});
    return job;
  }
  async function calculate(segment, places) {
    const start = places[segment.from], end = places[segment.to];
    if (!start || !end) throw new Error('地点情報がありません');
    if (segment.mode === 'transit') {
      throw new Error('路面電車の線路形状は未取得です。電車を含む正しい道順は交通案内で確認してください。');
    }
    if (metres([start.lat, start.lng], [end.lat, end.lng]) < 90) {
      return { type: 'indoor', paths: [], directions: ['近接地点または建物内の移動です。詳細な通路は未確認のため線を描きません。'], metres: 0 };
    }
    // FOSSGIS foot-profile OSRM server. 'driving' is the OSRM API profile URL syntax;
    // the /routed-foot/ backend itself is configured with pedestrian edges.
    const points = `${start.lng},${start.lat};${end.lng},${end.lat}`;
    const url = `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${points}?overview=full&geometries=geojson&steps=true`;
    const result = await requestJson(url);
    if (result.code !== 'Ok' || !result.routes?.[0]) throw new Error('歩行者ルートが見つかりません');
    const route = result.routes[0];
    const coords = checkFootPath(route.geometry?.coordinates, [start.lat, start.lng], [end.lat, end.lng]);
    const directions = (route.legs || []).flatMap(leg => leg.steps || []).filter(s => !!s.maneuver).map(instruction);
    return { type: 'walking', paths: [coords], directions, metres: route.distance, seconds: route.duration };
  }
  async function route(segment, places) {
    const key = [segment.from, segment.to, segment.mode].join('|');
    if (cache.has(key)) return cache.get(key);
    if (inFlight.has(key)) return inFlight.get(key);
    const promise = calculate(segment, places);
    inFlight.set(key, promise);
    try {
      const result = await promise;
      cache.set(key, result);
      return result;
    } finally {
      inFlight.delete(key);
    }
  }
  function cached(segment) { return cache.get([segment.from, segment.to, segment.mode].join('|')); }
  window.FieldworkRouting = Object.freeze({ route, cached });
})();
