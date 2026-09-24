from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1280,'height':720})
    pg.goto('http://localhost:8765/sections/guitar-goblin/claudies/?debug'); pg.wait_for_timeout(800)
    pg.evaluate("()=>{var A=__claudies; A.begin(5); }"); pg.wait_for_timeout(4500)
    js="""(ms)=>new Promise(r=>{var f=[],l=performance.now(),s=l;function k(n){f.push(n-l);l=n;if(n-s<ms)requestAnimationFrame(k);else{f.sort((a,b)=>a-b);r({n:f.length,med:f[f.length>>1].toFixed(1),p95:f[Math.floor(f.length*.95)].toFixed(1)})}}requestAnimationFrame(k)})"""
    print('office', pg.evaluate(js,3000))
    pg.evaluate("()=>{var A=__claudies;A.force.put('hallu','ldoor');A.light('L')}"); print('office+light', pg.evaluate(js,2000))
    pg.evaluate("()=>{var A=__claudies;A.light('L');A.cam(true);A.view('dining');A.force.put('clippy','dining');A.force.put('claudie','dining')}"); pg.wait_for_timeout(500); print('cam dining 2 chars', pg.evaluate(js,3000))
    pg.evaluate("()=>{__claudies.view('backstage')}"); pg.wait_for_timeout(300); print('cam backstage', pg.evaluate(js,2000))
    b.close()
