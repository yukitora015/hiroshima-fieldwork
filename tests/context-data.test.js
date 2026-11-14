const fs=require('node:fs'),assert=require('node:assert/strict');
const data=JSON.parse(fs.readFileSync('site/data/context.json','utf8'));
assert.equal(data.bounds.length,4);
const counts={};
for (const f of data.features) {
  assert.ok(['road','building','water','green'].includes(f.kind));
  assert.ok(Array.isArray(f.points)&&f.points.length>=2&&f.bounds.length===4);
  for(const p of f.points) assert.ok(p.length===2&&p.every(Number.isFinite));
  if(f.kind!=='road') assert.deepEqual(f.points[0],f.points.at(-1));
  counts[f.kind]=(counts[f.kind]||0)+1;
}
for(const kind of ['road','building','water','green']) assert.ok(counts[kind]>0,kind);
assert.ok(data.landmarks.length>0);
const html=fs.readFileSync('site/index.html','utf8');
const match=html.match(/const PLACES = (\{[^\n]+\});/);
assert.ok(match,'place data missing');
for(const [name,p] of Object.entries(JSON.parse(match[1]))) {
  assert.ok(p.lat>=data.bounds[0]&&p.lat<=data.bounds[2]&&p.lng>=data.bounds[1]&&p.lng<=data.bounds[3],name);
}
console.log('PASS: bounded OSM feature geometry, closed areas and landmark data',counts);
