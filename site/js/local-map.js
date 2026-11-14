/* A north-up Leaflet map is rotated as one unit: tiles and all geographic layers
   share exactly the same transform. The larger square covers the clipped view. */
(function () {
  'use strict';
  // OSM API node snapshot, 2026-11-14: Hiroshima station area only; coordinates are not inferred.
  let map, layer, landmarks = [], loaded = false, generation = 0, lastSlice=null, lastTurns=[];
  const radians = n => n * Math.PI / 180;
  function bearing(a,b) {
    const p1=radians(a[0]), p2=radians(b[0]), dl=radians(b[1]-a[1]);
    return (Math.atan2(Math.sin(dl)*Math.cos(p2), Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl))*180/Math.PI+360)%360;
  }
  function distance(a,b) {
    const dy=radians(b[0]-a[0]), dx=radians(b[1]-a[1])*Math.cos(radians((a[0]+b[0])/2));
    return Math.hypot(dx,dy)*6371000;
  }
  function heading(slice) {
    for (const p of slice.future) if (distance(slice.point,p)>2) return bearing(slice.point,p);
    for (let i=slice.past.length-1;i>=0;i--) if(distance(slice.past[i],slice.point)>2) return bearing(slice.past[i],slice.point);
    return null;
  }
  function reset() { generation++; if(map) map.remove(); map=null; layer=null; lastSlice=null; lastTurns=[]; }
  async function update(slice, turns=[]) {
    lastSlice=slice; lastTurns=turns;
    const turn=heading(slice), outer=document.getElementById('local-map');
    if(!outer || typeof L==='undefined') return;
    if(turn===null) { outer.textContent='進行方向を確認できないため局所地図を表示できません。'; return; }
    if(!map) {
      outer.innerHTML='<div class="local-rotator"><div class="local-leaflet"></div></div><div class="local-top">進行方向 ↑</div><div class="local-credit">© OpenStreetMap contributors</div>';
      map=L.map(outer.querySelector('.local-leaflet'),{zoomControl:false,attributionControl:false,dragging:false,scrollWheelZoom:false,doubleClickZoom:false,boxZoom:false,keyboard:false,touchZoom:false});
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
      layer=L.layerGroup().addTo(map);
    }
    const currentMap=map, seq=++generation;
    const rotator=outer.querySelector('.local-rotator');
    const size=Math.ceil(Math.hypot(outer.clientWidth,outer.clientHeight)+100);
    rotator.style.width=size+'px'; rotator.style.height=size+'px';
    rotator.style.transform=`translate(-50%,-50%) rotate(${-turn}deg)`;
    currentMap.invalidateSize(); currentMap.setView(slice.point,18,{animate:false});
    layer.clearLayers();
    if(slice.past.length>1)L.polyline(slice.past,{color:'#64746b',weight:5,opacity:.9}).addTo(layer);
    if(slice.future.length>1)L.polyline(slice.future,{color:'#00866c',weight:6,opacity:1}).addTo(layer);
    for(const p of turns) if(distance(slice.point,p.location)<110) L.circleMarker(p.location,{radius:4,color:'#fff',weight:2,fillColor:'#287b68',fillOpacity:1,interactive:false}).addTo(layer);
    L.circleMarker(slice.point,{radius:8,color:'#fff',weight:3,fillColor:'#006c56',fillOpacity:1,interactive:false}).addTo(layer);
    if(!loaded) {
      try { const response=await fetch('data/landmarks.json'); if(response.ok) landmarks=await response.json(); }
      catch (_) { /* Real map and route remain usable without landmarks. */ }
      loaded=true;
    }
    if(seq!==generation || map!==currentMap) return;
    const nearby=landmarks.filter(p=>distance(slice.point,[p.lat,p.lon])<100).sort((a,b)=>distance(slice.point,[a.lat,a.lon])-distance(slice.point,[b.lat,b.lon])).filter((p,i,all)=>all.findIndex(q=>q.name===p.name)===i).slice(0,5);
    for(const p of nearby) {
      const label=document.createElement('span'); label.className='local-landmark'; label.style.transform=`rotate(${turn}deg)`; label.textContent='◆ '+p.name;
      const icon=L.divIcon({className:'local-landmark-wrapper',html:label.outerHTML,iconSize:[0,0],iconAnchor:[0,0]});
      L.marker([p.lat,p.lon],{icon,interactive:false}).addTo(layer);
    }
  }
  window.addEventListener('resize',()=>{if(lastSlice)update(lastSlice,lastTurns);});
  window.FieldworkLocalMap=Object.freeze({update,reset,bearing,heading,distance});
})();
