/* Manual location navigator. No GPS, no approximate straight-line routing. */
(function () {
  'use strict';
  const state = {
    route: null, segment: null, map: null, routeLayer: null,
    index: 0, marker: null, turnMarkers: null
  };

  const byId = id => document.getElementById(id);
  const escape = text => String(text == null ? '' : text).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  function roadAction(point) {
    if (!point) return '道順を確認';
    if (point.type === 'arrive') return '目的地に到着';
    if (point.type === 'depart') return '出発';
    if (point.type === 'roundabout' || point.type === 'rotary') return '環状交差点';
    return ({
      left: '左折', right: '右折', straight: '直進',
      'slight left': 'やや左へ', 'slight right': 'やや右へ',
      'sharp left': '大きく左折', 'sharp right': '大きく右折',
      uturn: 'Uターン'
    }[point.modifier] || '地図で方向を確認');
  }

  function turnKind(point) {
    const mod = point?.modifier || '';
    if (mod.includes('left')) return 'left';
    if (mod.includes('right')) return 'right';
    if (mod === 'uturn') return 'uturn';
    if (point?.type === 'arrive') return 'arrive';
    if (mod === 'straight' || point?.type === 'depart') return 'straight';
    return 'unknown';
  }

  // Only illustrates a turn instruction. Actual route geometry remains on the map.
  function turnDiagram(point) {
    const kind = turnKind(point);
    if (kind === 'unknown') return '<p class="nav-diagram-caption">方向の模式図は表示できません。地図で確認してください。</p>';
    const routes = {
      left: 'M 90 160 L 90 72 Q 90 50 66 50 L 21 50',
      right: 'M 90 160 L 90 72 Q 90 50 114 50 L 159 50',
      straight: 'M 90 160 L 90 20',
      uturn: 'M 90 160 L 90 75 Q 90 45 63 45 Q 37 45 37 75 L 37 123',
      arrive: 'M 90 160 L 90 68'
    };
    const ends = {
      left: '<path d="M 34 38 L 20 50 L 34 62" />',
      right: '<path d="M 146 38 L 160 50 L 146 62" />',
      straight: '<path d="M 78 35 L 90 21 L 102 35" />',
      uturn: '<path d="M 25 111 L 37 126 L 49 111" />',
      arrive: '<circle cx="90" cy="57" r="13" fill="#e3a35a" stroke="white" stroke-width="4" />'
    };
    const d = routes[kind];
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" role="img" aria-label="${escape(roadAction(point))}の方向を示す模式図">
      <rect width="180" height="180" rx="19" fill="#eaf1ed" />
      <path d="M 90 175 L 90 14 M 8 50 L 172 50" stroke="#cddbd3" stroke-width="30" stroke-linecap="round" />
      <path d="${d}" fill="none" stroke="#1f5c4e" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" />
      <path d="${d}" fill="none" stroke="#a9dbc2" stroke-width="3" stroke-dasharray="1 13" stroke-linecap="round" />
      <g fill="none" stroke="white" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">${ends[kind]}</g>
      <circle cx="90" cy="150" r="9" fill="#fff" stroke="#176751" stroke-width="4" />
    </svg>`;
  }

  // Project a maneuver location onto the fetched network route (never connect unrelated points).
  function splitAt(path, coordinate) {
    if (!Array.isArray(path) || path.length < 2 || !Array.isArray(coordinate)) return null;
    let best = { score: Infinity, segment: -1, f: 0, projected: null };
    const scale = Math.cos((coordinate[0] || 34.39) * Math.PI / 180);
    for (let j = 0; j < path.length - 1; j++) {
      const a = path[j], b = path[j + 1];
      const x = (b[1] - a[1]) * scale, y = b[0] - a[0];
      const qx = (coordinate[1] - a[1]) * scale, qy = coordinate[0] - a[0];
      const denom = x * x + y * y;
      const f = denom > 0 ? Math.max(0, Math.min(1, (qx * x + qy * y) / denom)) : 0;
      const lat = a[0] + (b[0] - a[0]) * f;
      const lng = a[1] + (b[1] - a[1]) * f;
      const dx = (lng - coordinate[1]) * scale, dy = lat - coordinate[0];
      const score = dx * dx + dy * dy;
      if (score < best.score) best = { score, segment: j, f, projected: [lat, lng] };
    }
    if (best.segment < 0) return null;
    // Stay within 40 metres of the returned walking route.
    if (Math.sqrt(best.score) * 111195 > 40) return null;
    const past = path.slice(0, best.segment + 1).concat([best.projected]);
    const future = [best.projected].concat(path.slice(best.segment + 1));
    return { past, future, point: best.projected, segment: best.segment };
  }

  // Insert sparse straight candidates on the returned route, never off its geometry.
  function addStraightPoints(path, maneuvers) {
    const cumulative=[0];
    for(let i=1;i<path.length;i++) cumulative.push(cumulative[i-1]+FieldworkLocalMap.distance(path[i-1],path[i]));
    const known=maneuvers.map(m=>{
      const x=splitAt(path,m.location);
      const dist=cumulative[x.segment]+FieldworkLocalMap.distance(path[x.segment],x.point);
      return Object.assign({},m,{along:dist});
    });
    const generated=[];
    function pointAt(d) {
      let i=1; while(i<cumulative.length && cumulative[i]<d)i++;
      if(i>=path.length || cumulative[i]===cumulative[i-1])return null;
      const f=(d-cumulative[i-1])/(cumulative[i]-cumulative[i-1]);
      return [path[i-1][0]+(path[i][0]-path[i-1][0])*f,path[i-1][1]+(path[i][1]-path[i-1][1])*f];
    }
    for(let d=40;d<cumulative[cumulative.length-1]-35;d+=30) {
      if(known.some(x=>Math.abs(x.along-d)<30) || generated.some(x=>Math.abs(x.along-d)<100))continue;
      const before=pointAt(d-12), center=pointAt(d), after=pointAt(d+12);
      if(!before||!center||!after)continue;
      const b1=FieldworkLocalMap.bearing(before,center),b2=FieldworkLocalMap.bearing(center,after);
      if(Math.abs((b2-b1+540)%360-180)>20)continue;
      generated.push({type:'continue',modifier:'straight',name:'',location:center,along:d});
    }
    const all=known.concat(generated).sort((a,b)=>a.along-b.along);
    return all.map((x,i)=>Object.assign(x,{distance:i+1<all.length?Math.max(0,all[i+1].along-x.along):0}));
  }

  function removeMarker() {
    if (state.marker && state.map) state.map.removeLayer(state.marker);
    state.marker = null;
  }

  function removeTurnMarkers() {
    if (state.turnMarkers) state.turnMarkers.remove();
    state.turnMarkers = null;
  }

  function clear() {
    removeMarker();
    removeTurnMarkers();
    FieldworkLocalMap.reset();
    state.route = null;
    state.index = 0;
    state.segment = null;
    state.map = null;
    state.routeLayer = null;
  }

  function reset(segment, map, routeLayer) {
    clear();
    state.segment = segment;
    state.map = map;
    state.routeLayer = routeLayer;
    const host = byId('nav-panel');
    if (host) host.innerHTML = `<div class="nav-shell nav-loading"><p class="nav-overline">現在地からの道順</p><h3>経路を取得中</h3><p>取得できた曲がり角の中から、現在いる地点を選べます。</p></div>`;
  }

  function unavailable(message) {
    removeMarker();
    removeTurnMarkers();
    FieldworkLocalMap.reset();
    state.route = null;
    const host = byId('nav-panel');
    if (!host) return;
    host.innerHTML = `<div class="nav-shell nav-offline"><p class="nav-overline">この区間の案内</p><h3>地点選択は利用できません</h3><p>${escape(message || '曲がり角の位置を取得できませんでした。')}</p><p class="nav-disclaimer">道路の線を推測して描くことはしません。区間の「Googleマップで実際の経路を確認」をご利用ください。</p></div>`;
  }

  function setRoute(segment, route, map, routeLayer) {
    if (state.segment !== segment || state.map !== map || state.routeLayer !== routeLayer) reset(segment, map, routeLayer);
    if (route.type !== 'walking') return unavailable('駅構内・路面電車区間では、正確な通路・線路と交差点の位置を取得できていません。');
    if (!Array.isArray(route.paths?.[0]) || route.paths[0].length < 2 || !Array.isArray(route.maneuvers) || route.maneuvers.length < 2) {
      return unavailable('道路の形状または曲がり角の座標が不足しています。');
    }
    const good = route.maneuvers.filter(item => Array.isArray(item.location) && splitAt(route.paths[0], item.location));
    if (good.length < 2 || good.length !== route.maneuvers.length || !route.completeManeuvers) return unavailable('曲がり角の位置をすべて道路データに対応づけられませんでした。');
    const candidates = addStraightPoints(route.paths[0], good);
    state.route = Object.assign({}, route, { maneuvers: candidates, completeTurns: true });
    state.index = 0;
    const host = byId('nav-panel');
    if (!host) return;
    host.innerHTML = `<section class="nav-shell" aria-label="手動で現在地を選ぶ案内">
      <div class="nav-label-row"><span class="nav-overline">TURN-BY-TURN / 手動ナビ</span><span class="nav-manual-badge">GPSは使用しません</span></div>
      <label for="nav-position">今いる場所を選択</label>
      <select id="nav-position" aria-describedby="nav-explanation"></select>
      <p id="nav-explanation" class="nav-explanation">曲がり角や出発地点を選ぶと、地図がその場所に寄ります。実際の現在地を自動検知するものではありません。</p>
      <div class="nav-main">
        <div class="nav-picture" id="local-map" aria-label="進行方向を上にした周辺地図"></div>
        <div class="nav-instruction"><p class="nav-mini-title" id="nav-counter"></p><strong id="nav-action"></strong><span id="nav-distance"></span><span class="nav-current-point" id="nav-current-point"></span></div>
      </div>
      <p class="nav-diagram-caption">局所地図は進行方向が上です。地図の文字も回転します。経路や通行可否は現地で確認してください。</p>
      <div class="nav-buttons"><button type="button" id="nav-prev">← 前の地点</button><button type="button" class="nav-primary" id="nav-next">次の地点 →</button><button type="button" id="nav-all">全区間を見る</button></div>
      <div class="nav-step-scroll" id="nav-step-scroll" aria-label="曲がり角の位置を選択"></div>
      <div class="nav-route-legend"><span><i class="nav-legend-dot"></i>選択地点</span><span><i class="nav-legend-line green"></i>これから進む道</span><span><i class="nav-legend-line gray"></i>通過した道</span></div>
      <p class="nav-disclaimer">地図上の交差点の印も選択できます。位置は手動指定の目安です。現地の歩道・信号・通行規制を優先してください。</p>
    </section>`;
    const select = byId('nav-position');
    candidates.forEach((p, idx) => {
      const option = document.createElement('option'); option.value = String(idx);
      option.textContent = `${idx + 1}. ${roadAction(p)}${p.name ? ' — ' + p.name : ''}`;
      select.appendChild(option);
    });
    const choose = value => selectPoint(value);
    select.addEventListener('change', () => choose(Number(select.value)));
    byId('nav-prev').addEventListener('click', () => choose(state.index - 1));
    byId('nav-next').addEventListener('click', () => choose(state.index + 1));
    byId('nav-all').addEventListener('click', overview);
    byId('nav-step-scroll').addEventListener('click', e => {
      const target = e.target.closest('[data-nav-step]');
      if (target) choose(Number(target.dataset.navStep));
    });
    // Allow selecting a junction directly on the actual OSM map.
    if (map && typeof L !== 'undefined') {
      state.turnMarkers = L.layerGroup().addTo(map);
      candidates.forEach((point, i) => {
        L.circleMarker(point.location, { className: 'nav-turn-marker', radius: 7, color: '#ffffff', weight: 2,
          fillColor: '#36846f', fillOpacity: .88 })
          .addTo(state.turnMarkers)
          .bindTooltip(String(i + 1) + '. ' + roadAction(point), { direction: 'top' })
          .on('click', () => selectPoint(i));
      });
    }
    selectPoint(0);
  }

  function overview() {
    if (!state.route || !state.map) return;
    const line = state.route.paths[0];
    state.map.fitBounds(L.latLngBounds(line).pad(.2), { maxZoom: 17 });
  }

  function selectPoint(idx) {
    if (!state.route) return;
    const turns = state.route.maneuvers;
    const nextIndex = Math.min(turns.length - 1, Math.max(0, Math.round(Number(idx) || 0)));
    state.index = nextIndex;
    const current = turns[nextIndex];
    const next = turns[nextIndex + 1] || null;
    const currentAction = roadAction(current);
    const nextAction = next ? roadAction(next) : '目的地に到着';
    byId('nav-position').value = String(nextIndex);
    byId('nav-counter').textContent = `${nextIndex + 1} / ${turns.length} 地点`;
    byId('nav-action').textContent = next ? nextAction : '目的地に到着';
    const dist = Number(current.distance) || 0;
    byId('nav-distance').textContent = next ? (state.route.completeTurns && dist >= 1 ? `次の地点まで 約${Math.round(dist)}m` : '次の操作までの距離は未確認') : 'この区間の終点です';
    byId('nav-current-point').textContent = `選択地点：${current.name || currentAction}`;

    byId('nav-prev').disabled = nextIndex === 0;
    byId('nav-next').disabled = nextIndex === turns.length - 1;
    const list = byId('nav-step-scroll');
    list.innerHTML = turns.map((p, j) => `<button type="button" class="nav-step${j === nextIndex ? ' is-active' : ''}" data-nav-step="${j}" aria-pressed="${j === nextIndex}">${j + 1}<span>${escape(roadAction(p))}</span></button>`).join('');

    const line = state.route.paths[0];
    const slice = splitAt(line, current.location);
    if (!slice || !state.map || !state.routeLayer || typeof L === 'undefined') return;
    state.routeLayer.clearLayers();
    if (slice.past.length > 1) L.polyline(slice.past, { color: '#a9b6b0', weight: 5, opacity: .95 }).addTo(state.routeLayer);
    if (slice.future.length > 1) L.polyline(slice.future, { color: '#1d806a', weight: 7, opacity: 1 }).addTo(state.routeLayer);
    if (state.turnMarkers) state.turnMarkers.eachLayer(marker => marker.bringToFront());
    removeMarker();
    state.marker = L.circleMarker(slice.point, { radius: 13, color: '#ffffff', weight: 4, fillColor: '#0a8569', fillOpacity: 1, interactive: false });
    state.marker.addTo(state.map).bindTooltip('選択した現在地（手動）', { permanent: true, direction: 'top', offset: [0, -9] });
    // Map remains north-up: no false heading or GPS claim. Zoom around selected junction.
    state.map.setView(slice.point, 18, { animate: false });
    FieldworkLocalMap.update(slice,turns);
  }

  window.FieldworkNavigator = Object.freeze({ reset, setRoute, unavailable, splitAt, turnDiagram, roadAction, selectPoint, addStraightPoints });
})();
