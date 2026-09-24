import sys, json, os
from playwright.sync_api import sync_playwright
URL='http://localhost:8765/sections/guitar-goblin/claudies/?debug'
trials=int(sys.argv[1]) if len(sys.argv)>1 else 10
nights=[int(x) for x in sys.argv[2].split(',')] if len(sys.argv)>2 else [1,2,3,4,5,6]
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page()
    errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_timeout(500)
    pg.add_script_tag(path=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bot.js'))
    for n in nights:
        res=pg.evaluate("""([n,trials])=>{var A=__claudies; A.manual(true); var out={wins:0,deaths:{},power:[],stats:{}};
          for(var i=0;i<trials;i++){ A.start(n,null,{noCall:true}); var r=A.step(430, makeBot());
            if(r.won) {out.wins++; out.power.push(Math.round(r.power));} else { var k=r.scare||'?'; out.deaths[k]=(out.deaths[k]||0)+1; }
            var S=A.N.stats; for(var k2 in S) out.stats[k2]=(out.stats[k2]||0)+S[k2]; }
          A.manual(false); A.setScreen('title'); return out;}""",[n,trials])
        print('night',n,json.dumps(res))
    print(errs[:5]); b.close()
