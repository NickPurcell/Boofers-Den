from playwright.sync_api import sync_playwright
URL='http://localhost:8765/sections/guitar-goblin/claudies/?debug'
O='/tmp/claudies_'
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1280,'height':720})
    errs=[]; pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: errs.append(m.text) if m.type=='error' else None)
    pg.goto(URL); pg.wait_for_timeout(1500); pg.screenshot(path=O+'title.png')
    def setup(js, name, wait=400):
        pg.evaluate("()=>{var A=__claudies; A.manual(true); A.start(1,[0,0,0,0],{noCall:true}); var N=A.N;"+js+"}")
        pg.wait_for_timeout(wait); pg.screenshot(path=O+name+'.png')
    setup("A.force.put('hallu','ldoor'); A.light('L');", 'office_hallu')
    setup("A.force.put('clippy','rdoor'); A.light('R'); N.pan=120; N.panTarget=120;", 'office_clippy')
    setup("A.door('L'); A.door('R');", 'office_doors')
    for cam,js in [('stage',''),('dining',"A.force.put('claudie','dining');A.force.put('hallu','dining');A.force.put('clippy','dining');"),('cove','A.force.captcha(1);'),('cove2','A.force.captcha(2);'),('whall',"A.force.captcha(3); N.ch.captcha.dash=1.1;"),('wcorner',"A.force.put('hallu','wcorner');"),('ecorner',"A.force.put('claudie','ecorner');"),('ehall',"A.force.put('clippy','ehall');"),('closet',"A.force.put('hallu','closet');"),('backstage',"A.force.put('hallu','backstage');"),('restroom',"A.force.put('clippy','restroom');A.force.put('claudie','restroom');"),('kitchen',''),('cam11','N.cam11Until=999;')]:
        key=cam.rstrip('2')
        setup(js+"A.cam(true); N.camAnim=1; A.view('%s'); N.switchStatic=0; N.disrupt=0;"%key, 'cam_'+cam, 700)
    setup("A.force.golden(); A.cam(true);N.camAnim=1; A.view('wcorner'); N.switchStatic=0;", 'cam_golden',700)
    setup("N.golden.office=true;", 'office_golden')
    setup("A.force.power(0.01); A.manual(false); ", 'power_out', 600)
    pg.evaluate("()=>{var N=__claudies.N; N.po.phase=2; N.po.face=1; N.po.faceT=5; __claudies.manual(true);}"); pg.wait_for_timeout(300); pg.screenshot(path=O+'power_face.png')
    for pp in [0.1,0.3]:
        pg.evaluate("()=>{var A=__claudies; A.manual(true); A.start(1,[0,0,0,0],{noCall:true}); A.jumpscare('clippy'); }")
        pg.wait_for_timeout(int(pp*1300)); pg.screenshot(path=O+'scare_%s.png'%pp)
    pg.wait_for_timeout(2500); pg.screenshot(path=O+'gameover.png')
    pg.evaluate("()=>{var A=__claudies; A.manual(false); A.start(1,[0,0,0,0],{noCall:true}); A.force.time(6*A.HOUR-0.5);}")
    pg.wait_for_timeout(3500); pg.screenshot(path=O+'sixam.png')
    pg.evaluate("()=>{__claudies.force.save({night:5,beat5:true,beat6:true,beat20:false}); __claudies.setScreen('title');}")
    pg.wait_for_timeout(400); pg.screenshot(path=O+'title_unlocked.png')
    pg.click('#btn-custom'); pg.wait_for_timeout(500); pg.screenshot(path=O+'custom.png')
    print(errs[:10]); b.close()
