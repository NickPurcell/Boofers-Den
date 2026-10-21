import csv, re, sys, json
from collections import defaultdict, Counter
GAMES=['me1','dao','me2','me3','dai','mea','dav']
NAMES={'me1':'Mass Effect (2007)','dao':'Dragon Age: Origins (2009)','me2':'Mass Effect 2 (2010)','me3':'Mass Effect 3 (2012)','dai':'Dragon Age: Inquisition (2014)','mea':'Mass Effect: Andromeda (2017)','dav':'Dragon Age: The Veilguard (2024)'}
I=re.I
def m(p,s): return re.search(p,s,I) is not None

# ---- team (who employs the credited person), by section ----
CORE_SECTIONS={
 'me1':['(top)','Mass Effect Cast','Marketing','Operations and Administration'],
 'dao':['BioWare','English Cast'],
 'me2':['BioWare','English Voice Cast'],
 'me3':['General Credits','Art and Animation','Audio, Localization and External Resources','Design','Production','Programming','Quality Assurance','Cast (English)','Marketing','Studio Leadershio, BioWare Edmonton','Information Systems and Facilities','Online Development','Studio Leadershio, BioWare Montreal'],
 'dai':['Dragon Age: Inquisition','Art and Animation','Audio, Localization, and External Resources','Design','Production','Programming','Quality Assurance','Online Development','Cast','Studio Leadership','Studio Leadership, BioWare Montreal','Marketing','Information Systems and Facilities'],
 'mea':['General Credits','Art and Animation','Audio','Design','Production','Programming','Quality Assurance','BioWare Operations','BioWare Online Services','BioWare Development Services','Dragon Age Finaling Team','Cast','BioWare Senior Studio Leadership','BioWare Studio Leadership','BioWare Studio Administration','BioWare Studio Community Team','BioWare Studio Business Development Team','Information Systems and Facilities'],
}
def team(g,sec,role):
    if m(r'licens|open source|^pcre$|middleware|^development tools$',sec): return 'n/a'
    if m(r'cast',sec): return 'cast'
    if m(r'music|original score|wall of sound',sec) or m(r'composer|original score|add.l music',role): return 'external'
    if m(r'external partners|keyword international|exequo|adecco|keywords$|manpower|smartemp|test tropic|recording studio|transperfect|ec innovations|ptw japan|keywords studios',sec): return 'external'
    if g=='dav':
        if m(r'^(senior )?franchise leadership|^animation and art|^audio:|^design:|^production:|^programming:|^quality verification: bioware|^bioware operations|mass effect leadership',sec): return 'core'
        return 'publisher'
    return 'core' if sec in CORE_SECTIONS[g] else 'publisher'

# ---- discipline bucket ----
def bucket(g,sec,role):
    s,r=sec,role
    if m(r'licens|open source|^pcre$|middleware|^development tools$',s): return 'licenses'
    if m(r'special thanks|^thanks$|^thank you$|gamechangers|honorary|production babies|extra special',s) or m(r'special thanks|^thanks$|gamechangers|honorary|production babies|^for |^to |^and to ',r): return 'thanks'
    if s=='Mass Effect Leadership Team': return 'thanks'   # sister-franchise leads, courtesy credit
    if m(r'cast',s):
        if m(r'german|french|polish|russian|italian|spanish',s+' '+r): return 'localization'
        if m(r'motion capture|3d scan|casting',r): return 'anim_mocap'
        return 'voice_cast'
    if m(r'locali|translat|linguist|transperfect|ec innovations|ptw japan|recording studio - ',s) and not m(r'audio,',s) and not m(r'program',r): return 'localization'
    if s=='Dragon Age Finaling Team': return 'other'
    if m(r'music|original score|wall of sound',s) or m(r'composer|original score|add.l music|credit music',r): return 'audio'
    # vendor rows on Veilguard: role is the studio name
    if s=='External Partners' and g=='dav': return VENDOR_BUCKET.get(r,'other')
    if m(r'frostbite',s):
        if m(r'quality|\bqa\b|\bqe\b|tester',r): return 'qa'
        if m(r'\bhr\b|finance|people|executive assistant|special thanks',r): return 'ops_exec'
        return 'eng_engine_tools'
    if s=='Seed': return 'eng_engine_tools'
    if m(r'data and analytics|data and insights|player and quality insights$|^pqi: additional|business analytics|ux research|user research',s) or m(r'business analytics|ux research',r): return 'research_analytics'
    if m(r'capture|motion capture|catlab',s) and not m(r'catlab',s): return 'anim_mocap'
    if m(r'^ea central teams?$',s):
        tbl={'the capture lab':'anim_mocap','catlab':'qa','ea certification':'qa','systems test':'qa','live qa galaxy':'qa','ea romania':'qa','additional quality assurance':'qa','eadp':'eng_online','gos':'eng_online','lift online services':'eng_online','origin':'eng_online','pulse':'eng_online','techops':'eng_online','east websdk':'eng_online','dpio':'eng_online','artworks vancouver':'art_other','music':'audio','worldwide music licensing':'audio','integrated communications':'marketing','integrated communications, international':'marketing','international marketing':'marketing','sales':'marketing','legal':'ops_exec','ea legal':'ops_exec','worldwide customer experience':'ops_exec','ea help':'ops_exec','global product lifecycle management':'production','srm':'production','ea studios content frameworks':'eng_engine_tools','ea shanghai':'other','business analytics':'research_analytics','ux research':'research_analytics'}
        return tbl.get(r.lower(),'other')
    if m(r'product lifecycle',s): return 'production'
    if m(r'creative technologies|creative and development technology|customer and platform enablement',s):
        if m(r'creative technologies',s): return 'eng_engine_tools'
        if m(r'platform enablement',s): return 'eng_online'
        return 'ops_exec'
    if m(r'eax support, quality|sonar live qv|compliance and certification|^quality verification|quality assurance|^test$|^ea quality',s): return 'qa'
    if m(r'^ea experiences|fan growth|marketing|public relations|eax support$',s):
        if m(r'legal',s+r): return 'ops_exec'
        if m(r'locali|adaptation',s): return 'localization'
        return 'marketing'
    if m(r'corporate leadership|all labels leadership|label leadership|ea games label|rpg/mmo group|studios group|legal / business|pandemic administration|^ea create - (leadership|operations|partners)$|operations and administration|information systems|studio leadership|studio administration|business development team|^bioware operations: (studio leadership|finance|information services|people experience|talent acquisition|workplace experience|additional leadership|studio operations)',s):
        if m(r'director of (art|animation)',r): return 'art_other'
        if m(r'director of programming|chief technical|technology|head of technology',r): return 'eng_general'
        if m(r'director of design|creative development|creative director|game director',r): return 'design_other'
        if m(r'director of production|co-director of production|product development',r): return 'production'
        if m(r'quality assurance',r): return 'qa'
        if m(r'online development',r): return 'eng_online'
        if m(r'audio',r): return 'audio'
        if m(r'application development|developer publishing',r): return 'eng_engine_tools'
        return 'ops_exec'
    if m(r'player inclusion|^ea create - xdi',s): return 'other' if not m(r'^head of',r) else 'ops_exec'
    if g=='dao' and s=='EA' and m(r'global publishing|ad manager|edp group|buyer',r): return 'marketing'
    if m(r'online leadership',r): return 'eng_online'
    if m(r'keywords .* team|^team lead$',r) and m(r'keyword',s): return 'localization'
    if m(r'developer publishing support|application development',r): return 'eng_engine_tools'
    if m(r'content trainers|^head of create',r): return 'ops_exec'
    return by_role(g,s,r)

VENDOR_BUCKET={}
def by_role(g,s,r):
    # engineering first for anyone credited as a programmer/engineer
    if m(r'qa programm|quality assurance programm|qa analysts?, tech',r): return 'qa'
    if m(r'program|engineer(?!ing manager)|\bsde\b|developers?$|xna gpx|architect|initial technology|technical director|technical lead for|chief technical|dev ops|devops|platform sdet|build sdet|web development|live service|\bai\b|research engineer|scientist|data warehouse|^security$|tech(nical)? direction|performance administrator|telemetry',r) and not m(r'quality|\bqa\b|\bqv\b|test',s+' '+r):
        if m(r'gameplay|combat|rpg|game systems|ux prog|user interface prog|narrative|world building|open world|systems & world|digital acting|cinematic|^programmers?$|^lead programmers?$|assistant lead programmer',r) and not m(r'^programmers?$|^lead programmers?$|assistant lead',r): return 'eng_gameplay'
        if m(r'online|multiplayer|web|live service|server|dev ops|devops|platform engineering|platform sdet|data warehouse|^security$|telemetry',r+' '+s): return 'eng_online'
        if m(r'graphic|render|tool|engine|architect|foundation|performance|platform|infrastructure|build|physics|initial technology|technical director|audio prog|localization prog|xna|technical lead|tech(nical)? direction|bioware operations|development services|ai |scientist',r+' '+s): return 'eng_engine_tools'
        return 'eng_general'
    if m(r'locali|translat|linguist',r): return 'localization'
    if m(r'\bqa\b|quality|tester|testing|\btest\b|test lead|\bqv\b|certification|compliance|catlab|sdet|analysts?$|analayst|focus test|mastering lab|tech ops',r) and not m(r'data analyst|business analyst|telemetry',r): 
        if m(r'playtest',r): return 'research_analytics'
        return 'qa'
    if m(r'playtest|user research|uxr|ux research|analytic|data analyst|data scien|insight|^date warehouse|^user experience$',r): return 'research_analytics'
    if m(r'video|market|\bpr\b|public relations|communit|brand|^web$|advertis|new media|fan experience|social|^rp$|^art$|online marketing|product manager|global product|sales|consumer products',r) and not m(r'^production',s): return 'marketing'
    if m(r'motion capture|mocap|performance capture|capture|3d scan|retarget|data wrangler|acquisition',r): return 'anim_mocap'
    if m(r'cinemat',r): return 'anim_cine'
    if m(r'technical anim|anim',r): return 'anim_animation'
    if m(r'concept',r): return 'art_concept'
    if m(r'character art',r): return 'art_character'
    if m(r'visual effect|visuel effect|\bvfx|effects artist|compositing',r): return 'art_vfx'
    if m(r'technical art',r): return 'art_tech'
    if m(r'\bgui\b|\bui art|ux art|interface art',r): return 'art_ui'
    if m(r'level art|environment|lighting|world art',r): return 'art_environment'
    if m(r'\bart\b|artist|matte',r) and not m(r'art producer',r): return 'art_other'
    if m(r'dialog(ue)? edit',r): return 'audio'
    if m(r'writer|writing|editor|editing|^editor',r) and not m(r'video',r): return 'writing'
    if m(r'audio|sound|voice|\bvo\b|dialog|music|score|performance and voice|performance capture manager',r): return 'audio'
    if m(r'level design|encounter|mission|narrative lead level|world lead level',r): return 'design_level'
    if m(r'system|gameplay|combat|multiplayer design|creature|player lead|gameplay player|^multiplayer & online$',r): return 'design_systems'
    if m(r'technical design',r): return 'design_technical'
    if m(r'ux design|experience design|ux technical|ux designer|user experience|ux lead|^ux manager|doc design|documentation',r): return 'design_ux'
    if m(r'design|creative director|game director|realization director',r): return 'design_other'
    if m(r'produc|project manag|project director|program manag|development director|development manag|dev.t|project lead|external resources|external producer|studio operations|production coordinator|exlipse engine|project leadership|^leads$|account manager|^management$',r): return 'production'
    if m(r'ceo|cfo|coo|cto|president|\bvp\b|\bsvp\b|\bevp\b|vice|chief|counsel|secretary|legal|attorney|finance|payroll|\bhr\b|human resources|people|talent|recruit|admin|assistant|reception|facilit|application support|desktop|infrastructure|business|general manager|office|co-founder|operations|director of it|it manager|support specialist|workplace|austin it|grp|sr director|global events|^infrastructure$|launch readiness',r): return 'ops_exec'
    # section fallbacks
    if m(r'program|online dev|development$',s): return 'eng_general'
    if m(r'art',s): return 'art_other'
    if m(r'design',s): return 'design_other'
    if m(r'production|general credits|franchise leadership|extended team|core team',s): return 'production'
    if m(r'quality|test',s): return 'qa'
    if m(r'audio',s): return 'audio'
    if s=='Dragon Age Finaling Team': return 'production'
    return 'UNCLASSIFIED'

GROUP={'eng_gameplay':'Engineering','eng_engine_tools':'Engineering','eng_online':'Engineering','eng_general':'Engineering',
 'art_environment':'Art','art_character':'Art','art_vfx':'Art','art_tech':'Art','art_ui':'Art','art_concept':'Art','art_other':'Art',
 'anim_animation':'Animation & cinematics','anim_cine':'Animation & cinematics','anim_mocap':'Animation & cinematics',
 'design_systems':'Design','design_level':'Design','design_technical':'Design','design_ux':'Design','design_other':'Design',
 'writing':'Writing & editing','audio':'Audio & music','voice_cast':'Voice cast (English)','production':'Production & management',
 'qa':'QA','localization':'Localization','research_analytics':'User research & analytics','marketing':'Marketing & community',
 'ops_exec':'Studio/corporate ops & exec','other':'Other','thanks':'Thanks','licenses':'Licenses (excluded)','UNCLASSIFIED':'UNCLASSIFIED'}
VENDOR_BUCKET.update({'Airship Interactive Ltd':'art_other','Balisti Studios':'art_other','Beholder':'art_other','Big Planet':'art_other','Brazen Animation':'anim_animation','Codefly Software Inc':'eng_general','Counterpunch Studios':'art_character','House of Cool':'art_other','KWM, A Keywords Studio':'art_other','Lakshya Digital':'art_other','Meridian Studios by Apex':'art_other','Mindwalk, a Keywords Studio':'art_other','Niche VFX':'art_vfx','Paladin Security':'ops_exec','Securitas':'ops_exec','Ricoh Canada':'ops_exec','Phoenix Mastering':'audio','Pixel Audio':'audio','Platygobian, S.L. T/A Elite3D':'art_other','Roarty Digital':'art_other','Rouge Mocap':'anim_mocap','Shanghai Arts United Software Co., Ltd':'art_other','Side LA':'audio','Side London':'audio','Sweet Justice Sound Group':'audio','Team Audio':'audio','Technicolor Games':'art_other','Volta':'art_concept','Cultural Consultants':'writing'})

def run():
    rows=list(csv.DictReader(open('credits_rows.csv')))
    per=defaultdict(list)   # (game,pid) -> [(team,bucket,sec,role)]
    for x in rows:
        g,s,r=x['game'],x['section'],x['role']
        per[(g,x['person_id'])].append((team(g,s,r),bucket(g,s,r),s,r))
    prim={}
    rank={'core':0,'publisher':1,'external':2,'cast':3,'n/a':4}
    for k,creds in per.items():
        real=[c for c in creds if c[1] not in ('thanks','licenses')]
        if not real: prim[k]=creds[0]; continue
        t=min((c[0] for c in real),key=lambda z:rank[z])        # any core credit makes a person core
        noncast=[c for c in real if c[1]!='voice_cast' and c[0]==t] or [c for c in real if c[0]==t]
        prim[k]=(t,noncast[0][1],noncast[0][2],noncast[0][3])  # first credit in credit order
    return rows,per,prim
if __name__=='__main__':
    rows,per,prim=run()
    unc=Counter(); oth=Counter()
    for (g,pid),(t,b,s,r) in prim.items():
        if b=='UNCLASSIFIED': unc[(g,s,r)]+=1
        if b=='other': oth[(g,s,r)]+=1
    print('UNCLASSIFIED',sum(unc.values())); [print(' ',k,v) for k,v in unc.most_common(80)]
    print('OTHER',sum(oth.values())); [print(' ',k,v) for k,v in oth.most_common(40)]
