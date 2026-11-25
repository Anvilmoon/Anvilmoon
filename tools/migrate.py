#!/usr/bin/env python3
"""Turn the PC server's data (db.json + history/*.json) into SQL for the cloud database.
   usage: migrate.py <db.json> <history dir or ''> <out dir>   -> writes 00-state.sql, 01-saves-*.sql, 02-history-*.sql"""
import json,os,sys,glob
dbf,hist,out=sys.argv[1],sys.argv[2],sys.argv[3];os.makedirs(out,exist_ok=True)
d=json.load(open(dbf));Q=lambda o:"$am$"+json.dumps(o,separators=(',',':'),ensure_ascii=False)+"$am$::jsonb"
assert all('$am$' not in json.dumps(v,ensure_ascii=False) for v in [d])
saves=[];users={}
for uid,u in d['users'].items():
    u=dict(u);save=u.pop('save',None);at=u.pop('saveAt',0);rev=u.pop('saveRev',0);users[uid]=u
    if save is not None:saves.append((uid,save,at or 0,rev or 0))
state={'users':users,'names':d.get('names',{}),'sessions':d.get('sessions',{}),'ah':d.get('ah',{}),'mail':d.get('mail',{}),'seq':d.get('seq',0),'campaigns':d.get('campaigns',{}),
       'limits':{},'queue':{'ranked':[],'wager':[]},'matches':{},'playerMatch':{},'ahRev':0}
open(f'{out}/00-state.sql','w').write(f"update public.am_state set blob={Q(state)}, ver=ver+1, next_due=0 where id=1;\n")
def chunks(prefix,stmts,lim=700_000):
    n=0;cur=[];size=0;files=[]
    def flush():
        nonlocal n,cur,size
        if cur:
            f=f'{out}/{prefix}-{n:02d}.sql';open(f,'w').write('\n'.join(cur)+'\n');files.append(f);n+=1;cur=[];size=0
    for s in stmts:
        if size+len(s)>lim:flush()
        cur.append(s);size+=len(s)
    flush();return files
sf=chunks('01-saves',[f"insert into public.am_saves (uid,save,save_at,rev) values ('{uid}',{Q(s)},{int(at)},{int(rev)}) on conflict (uid) do update set save=excluded.save, save_at=excluded.save_at, rev=excluded.rev;" for uid,s,at,rev in saves])
hs=[]
if hist:
    for f in sorted(glob.glob(os.path.join(hist,'*.json'))):
        uid=os.path.basename(f)[:-5]
        if uid not in users:continue
        for h in json.load(open(f))[-12:]:
            hs.append(f"insert into public.am_history (uid,at,rev,save) values ('{uid}',{int(h['at'])},{int(h.get('rev',0))},{Q(h['save'])}) on conflict do nothing;")
hf=chunks('02-history',hs)
print(json.dumps({'users':len(users),'saves':len(saves),'mail':len(state['mail']),'ah':len(state['ah']),'sessions':len(state['sessions']),'history':len(hs),'files':[os.path.basename(x) for x in [f'{out}/00-state.sql']+sf+hf],'state_kb':round(len(json.dumps(state))/1024,1)}))
