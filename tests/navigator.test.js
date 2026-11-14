const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const dir = path.resolve(process.env.FIELDWORK_REPO || path.join(__dirname, '..'), 'site/js');
let requests = 0;
const origin = [34.3965192,132.459676];
const bend = [34.3957,132.4589];
const destination = [34.3935628,132.4571519];
const ctx={window:{}, AbortController,Date,Map,Promise,Math,Number,JSON,setTimeout,clearTimeout,fetch:async url=>{
  requests++;
  assert.match(url,/routed-foot\/route\/v1\/driving/);
  return {ok:true,json:async()=>({code:'Ok',routes:[{
    distance:550,duration:420,geometry:{coordinates:[
      [origin[1],origin[0]], [bend[1],bend[0]], [destination[1],destination[0]]]},
    legs:[{steps:[
      {maneuver:{type:'depart',location:[origin[1],origin[0]]},name:'紙屋町',distance:128},
      {maneuver:{type:'turn',modifier:'left',location:[bend[1],bend[0]]},name:'交差点',distance:422},
      {maneuver:{type:'arrive',location:[destination[1],destination[0]]},name:'',distance:0}
    ]}]
  }]})};
}};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(dir,'route-engine.js'),'utf8'),ctx);
vm.runInContext(fs.readFileSync(path.join(dir,'nav-guide.js'),'utf8'),ctx);
(async()=>{
 const places={a:{lat:origin[0],lng:origin[1]},b:{lat:destination[0],lng:destination[1]},c:{lat:origin[0],lng:origin[1]}};
 const segment={from:'a',to:'b',mode:'walking'};
 const r=await ctx.window.FieldworkRouting.route(segment,places);
 assert.equal(r.maneuvers.length,3);
 assert.equal(r.maneuvers[1].modifier,'left');
 assert.equal(r.maneuvers[0].location[0],origin[0]);
 assert.equal(r.maneuvers[1].distance,422);
 assert.equal(r.paths[0].length,3);
 assert.equal(ctx.window.FieldworkNavigator.roadAction(r.maneuvers[1]),'左折');
 const s=ctx.window.FieldworkNavigator.splitAt(r.paths[0],bend);
 assert.ok(s&&s.past.length>=2&&s.future.length>=2);
 assert.equal(ctx.window.FieldworkNavigator.splitAt(r.paths[0],[34.45,132.55]),null);
 assert.match(ctx.window.FieldworkNavigator.turnDiagram(r.maneuvers[1]),/左折/);
 assert.equal((await ctx.window.FieldworkRouting.route(segment,places)).maneuvers.length,3);
 assert.equal(requests,1);
 const indoor=await ctx.window.FieldworkRouting.route({from:'a',to:'c',mode:'walking'},places);
 assert.equal(indoor.paths.length,0);
 await assert.rejects(ctx.window.FieldworkRouting.route({from:'a',to:'b',mode:'transit'},places));
 console.log('PASS: OSRM maneuver positions, action, route clipping, unavailable routes, cache');
})().catch(e=>{console.error(e);process.exitCode=1});
