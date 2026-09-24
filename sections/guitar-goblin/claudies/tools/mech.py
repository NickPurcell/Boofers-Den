import json, os
from playwright.sync_api import sync_playwright
URL='http://localhost:8765/sections/guitar-goblin/claudies/?debug'
TESTS = r"""
(function(){
 var A=__claudies, R={};
 function run(name, night, lv, setup, policy, secs){ A.manual(true); A.start(night, lv, {noCall:true}); if(setup) setup(A); var r=A.step(secs||430, policy); r.stats=JSON.parse(JSON.stringify(A.N.stats)); R[name]=r; return r; }
 run('hallu_enters', 7, [0,20,0,0], null, null, 200);
 run('clippy_enters', 7, [0,0,20,0], null, null, 200);
 run('claudie_enters', 7, [20,0,0,0], null, function(a){ if(!a.N.camUp) a.cam(true); if(a.N.cam!=='cove') a.view('cove'); }, 200);
 run('claudie_blocked_by_watch', 7, [20,0,0,0], null, function(a){ if(!a.N.camUp) a.cam(true); if(a.N.cam!=='stage') a.view('stage'); }, 120);
 run('captcha_runs', 7, [0,0,0,20], null, null, 200);
 run('captcha_bangs', 7, [0,0,0,20], null, function(a){ if(!a.N.doorL) a.door('L'); }, 200);
 run('power_out_death', 1, null, function(a){ a.force.power(0.5); }, null, 200);
 run('power_out_saved_by_6am', 1, null, function(a){ a.force.time(6*a.HOUR-6); a.force.power(0.2); }, null, 20);
 run('golden_kills', 1, null, function(a){ a.force.golden(); }, function(a){ var N=a.N; if(N.t<1){ if(!N.camUp) a.cam(true); a.view('wcorner'); } else if(N.t<2){ if(N.camUp) a.cam(false);} }, 30);
 run('golden_avoided', 1, null, function(a){ a.force.golden(); }, function(a){ var N=a.N; if(N.t<1){ if(!N.camUp) a.cam(true); a.view('wcorner'); } else if(N.t<2){ if(N.camUp) a.cam(false);} else if(N.t<3.5){ if(!N.camUp) a.cam(true);} else if(N.camUp) a.cam(false); }, 30);
 // clippy drain: power after 30s with clippy at the right door, door closed, vs empty
 run('drain_base', 7, [0,0,0,0], function(a){ a.door('R'); }, null, 30);
 run('drain_clippy', 7, [0,0,0,0], function(a){ a.force.put('clippy','rdoor'); a.door('R'); }, null, 30);
 run('light_reveals', 7, [0,0,0,0], function(a){ a.force.put('hallu','ldoor'); a.light('L'); }, null, 1);
 R.light_reveals.seen = A.perceive().atL;
 run('door_repels_hallu', 7, [0,20,0,0], function(a){ a.force.put('hallu','ldoor'); a.door('L'); }, null, 10);
 R.door_repels_hallu.loc = A.N.ch.hallu.loc;
 run('dead_buttons', 7, [0,20,0,0], function(a){ a.force.put('hallu','ldoor'); }, null, 6);
 R.dead_buttons.dead = A.N.buttonsDead; R.dead_buttons.inside = A.N.inside;
 A.manual(false);
 return R;
})()
"""
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page()
    errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_timeout(400)
    R=pg.evaluate(TESTS)
    for k,v in R.items(): print(k, json.dumps(v))
    print(errs[:5]); b.close()
