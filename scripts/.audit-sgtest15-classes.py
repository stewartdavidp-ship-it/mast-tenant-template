#!/usr/bin/env python3
"""One-off sgtest15 classes-domain audit (read-only). Not shipped."""
import json, subprocess, urllib.request, sys

TOKEN = subprocess.check_output(['gcloud', 'auth', 'print-access-token'], stderr=subprocess.DEVNULL).decode().strip()
BASE = "https://firestore.googleapis.com/v1/projects/mast-platform-prod/databases/(default)/documents/tenants/sgtest15"

def fetch(coll):
    docs, tok = [], None
    while True:
        url = f"{BASE}/{coll}?pageSize=300" + (f"&pageToken={tok}" if tok else "")
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}"})
        d = json.load(urllib.request.urlopen(req))
        docs += d.get('documents', [])
        tok = d.get('nextPageToken')
        if not tok: break
    return docs

def val(v):
    if v is None: return None
    for k in ('stringValue','integerValue','doubleValue','booleanValue','timestampValue','nullValue'):
        if k in v: return v[k]
    if 'mapValue' in v: return {kk: val(vv) for kk, vv in (v['mapValue'].get('fields') or {}).items()}
    if 'arrayValue' in v: return [val(x) for x in (v['arrayValue'].get('values') or [])]
    return v

out = {}
for coll in ['classes','class_sessions','enrollments','instructors','resources','admin_passDefinitions','students','admin_waiverSignatures']:
    rows = []
    for doc in fetch(coll):
        rid = doc['name'].split('/')[-1]
        f = {k: val(v) for k, v in (doc.get('fields') or {}).items()}
        rows.append({'_id': rid, **f})
    out[coll] = rows
    print(f"{coll}: {len(rows)}", file=sys.stderr)
json.dump(out, open('/tmp/sgtest15-classes-audit.json','w'), indent=1, default=str)
