const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let calls=0;
const ctx={window:{},AbortController,Date,Map,Promise,Math,Number,JSON,setTimeout,clearTimeout,fetch:async(url)=>{
  calls++;
  assert.ok(url.startsWith('https://routing.openstreetmap.de/routed-foot/route/v1/driving/'));
  return {ok:true,json:async()=>({code:'Ok',routes:[{distance:260,duration:200,geometry:{coordinates:[[132.459676,34.3965192],[132.4591,34.3959],[132.4571519,34.3935628]]},legs:[{steps:[{maneuver:{type:'depart'},name:'歩道',distance:70},{maneuver:{type:'turn',modifier:'left'},name:'交差点',distance:90},{maneuver:{type:'arrive'}}]}]}]})};
}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(__dirname+'/../site/js/route-engine.js','utf8'),ctx);
const places={prefecture:{lat:34.3965192,lng:132.459676},hondori:{lat:34.3935628,lng:132.4571519},cake:{lat:34.397879,lng:132.4757374},omiyage:{lat:34.397879,lng:132.4757374}};
(async()=>{
 const foot={from:'prefecture',to:'hondori',mode:'walking'};
 const a=await ctx.window.FieldworkRouting.route(foot,places);
 assert.equal(a.paths[0].length,3);assert.equal(a.type,'walking');assert.ok(a.directions.some(x=>x.includes('左折')));
 await ctx.window.FieldworkRouting.route(foot,places);assert.equal(calls,1);
 const indoor=await ctx.window.FieldworkRouting.route({from:'cake',to:'omiyage',mode:'walking'},places);assert.equal(indoor.paths.length,0);
 await assert.rejects(()=>ctx.window.FieldworkRouting.route({from:'prefecture',to:'hondori',mode:'transit'},places));
 console.log('OK: curved network route, turn instructions, caching, indoor no line, transit no fake path');
})().catch(e=>{console.error(e);process.exitCode=1});
