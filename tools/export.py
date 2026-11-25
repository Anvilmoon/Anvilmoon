#!/usr/bin/env python3
"""Split the PC server's data for the move: state.sql (accounts, mail, auctions; run directly on the database)
   and one JSON file per account with its save and recent history (fetched by the database from a private address).
   usage: export.py <db.json> <history dir> <out dir> [history copies to keep]"""
import json,os,sys
dbf,hist,out=sys.argv[1],sys.argv[2],sys.argv[3];keep=int(sys.argv[4]) if len(sys.argv)>4 else 4;os.makedirs(out,exist_ok=True)
d=json.load(open(dbf));users={};n=0
for uid,u in d['users'].items():
    u=dict(u);save=u.pop('save',None);at=u.pop('saveAt',0);rev=u.pop('saveRev',0);users[uid]=u
    h=[]
    try:h=json.load(open(os.path.join(hist,uid+'.json')))[-keep:]
    except Exception:pass
    json.dump({'uid':uid,'save':save,'at':at or 0,'rev':rev or 0,'history':[{'at':x['at'],'rev':x.get('rev',0),'save':x['save']} for x in h]},open(f'{out}/u_{uid}.json','w'),separators=(',',':'));n+=1
state={'users':users,'names':d.get('names',{}),'sessions':d.get('sessions',{}),'ah':d.get('ah',{}),'mail':d.get('mail',{}),'seq':d.get('seq',0),'campaigns':d.get('campaigns',{}),'limits':{},'queue':{'ranked':[],'wager':[]},'matches':{},'playerMatch':{},'ahRev':0}
s=json.dumps(state,separators=(',',':'),ensure_ascii=False);assert '$am$' not in s
open(f'{out}/state.sql','w').write(f"update public.am_state set blob=$am${s}$am$::jsonb, ver=ver+1, next_due=0 where id=1;\n")
print(json.dumps({'accounts':n,'mail':len(state['mail']),'auctions':len(state['ah']),'sessions':len(state['sessions']),'state_bytes':len(s),'files':{f:os.path.getsize(f'{out}/{f}') for f in sorted(os.listdir(out))}}))
