const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const ctx={window:{}, Math, Number, Array, Promise, document:{getElementById(){return null}}, fetch:async()=>({ok:true,json:async()=>[]})};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('site/js/local-map.js','utf8'),ctx);
const m=ctx.window.FieldworkLocalMap;
const center=[34.393,132.46];
const e=[center[0],center[1]+0.00045];
const n=[center[0]+0.0004,center[1]];
const east=m.project(e,center,90);
const north=m.project(n,center,0);
assert.ok(Math.abs(east[0]-180)<0.5 && east[1]<200,'eastbound route must point up');
assert.ok(Math.abs(north[0]-180)<0.5 && north[1]<200,'northbound route must point up');
const right=m.project(n,center,90);
assert.ok(right[0]<180,'when heading east, north is to the left');
const slice={point:center,past:[[center[0],center[1]-0.0002],center],future:[center,e]};
const landmark={lat:center[0]+0.00015,lon:center[1]+0.0002,name:'テスト駅交番'};
let svg=m.renderSvg(slice,[],[landmark]);
assert.ok(svg.includes('nav-schematic') && svg.includes('テスト駅交番'));
assert.ok(svg.includes('進行方向 ↑') && svg.includes('選択した現在地'));
assert.ok(!/rotate\s*\(/.test(svg),'text and icons must be upright');
assert.ok(svg.includes('#9caaa2') && svg.includes('#087e64'));
const nearSvg=m.renderSvg(slice,[],[],null,20);
const farSvg=m.renderSvg(slice,[],[],null,200);
assert.notEqual(nearSvg,farSvg,'distance changes the display scale');
for(const rendered of [nearSvg,farSvg]) {
  const bar=rendered.match(/<line x1="([\d.]+)" y1="283" x2="330"/);
  const label=rendered.match(/>約(\d+)m<\/text>/);
  assert.ok(bar&&label);
  const scale=rendered===nearSvg?m.chooseScale(20):m.chooseScale(200);
  assert.ok(Math.abs((330-Number(bar[1]))-Number(label[1])*scale)<0.11,'scale bar matches its label');
}
svg=m.renderSvg(slice,[],[{...landmark,name:'<script>alert(1)</script>'}]);
assert.ok(!svg.includes('<script>') && svg.includes('&lt;script&gt;'),'OSM text must be escaped');
assert.ok(!m.renderSvg(null), 'invalid route is never replaced with a fake line');
const background={bounds:[34.38,132.44,34.41,132.48],features:[
  {kind:'road',subtype:'residential',bounds:[center[0],center[1],center[0]+.0004,center[1]+.00045],points:[n,center,e]},
  {kind:'building',bounds:[center[0],center[1],center[0]+.0004,center[1]+.00045],points:[center,n,e,center]},
  {kind:'water',bounds:[center[0],center[1],center[0]+.0004,center[1]+.00045],points:[center,n,e,center]},
  {kind:'green',bounds:[center[0],center[1],center[0]+.0004,center[1]+.00045],points:[center,n,e,center]}
]};
svg=m.renderSvg(slice,[],[landmark],background);
for(const kind of ['road','building','water','green']) assert.ok(svg.includes('context-'+kind),kind);
assert.ok(svg.includes('destination-pin'));
console.log('PASS: directions up, projected landmark locations, upright text, safe HTML, no fake fallback');
