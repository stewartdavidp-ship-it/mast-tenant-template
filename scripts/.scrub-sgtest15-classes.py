#!/usr/bin/env python3
"""One-off sgtest15 classes-domain scrub + seed (Wave 0). Not shipped.
Deletes harness junk clusters, heals dangling FKs by re-creating referenced
docs at their original ids, renames placeholders in place, seeds future
sessions + enrollments + students + resources. Writes a full report to
/tmp/sgtest15-classes-scrub-report.json."""
import json, re, subprocess, urllib.request, itertools

TOKEN = subprocess.check_output(['gcloud','auth','print-access-token'], stderr=subprocess.DEVNULL).decode().strip()
ROOT = "projects/mast-platform-prod/databases/(default)"
DOCS = f"https://firestore.googleapis.com/v1/{ROOT}/documents"
TEN = f"{ROOT}/documents/tenants/sgtest15"

def fv(v):
    if isinstance(v, bool): return {'booleanValue': v}
    if isinstance(v, int): return {'integerValue': str(v)}
    if isinstance(v, float): return {'doubleValue': v}
    if isinstance(v, str): return {'stringValue': v}
    if v is None: return {'nullValue': None}
    if isinstance(v, list): return {'arrayValue': {'values': [fv(x) for x in v]}}
    if isinstance(v, dict): return {'mapValue': {'fields': {k: fv(x) for k, x in v.items()}}}
    raise TypeError(v)

def batch(writes):
    for i in range(0, len(writes), 400):
        chunk = writes[i:i+400]
        req = urllib.request.Request(f"{DOCS}:batchWrite", method='POST',
            data=json.dumps({'writes': chunk}).encode(),
            headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
        resp = json.load(urllib.request.urlopen(req))
        errs = [s for s in resp.get('status', []) if s.get('code')]
        if errs: raise RuntimeError(f"batchWrite errors: {errs[:3]}")
        print(f"  batch {i//400+1}: {len(chunk)} writes ok")

def delete(coll, _id): return {'delete': f"{TEN}/{coll}/{_id}"}
def upsert(coll, _id, fields, mask=None):
    w = {'update': {'name': f"{TEN}/{coll}/{_id}", 'fields': {k: fv(v) for k, v in fields.items()}}}
    if mask: w['updateMask'] = {'fieldPaths': mask}
    return w

d = json.load(open('/tmp/sgtest15-classes-audit.json'))
cl, cs, en, st = d['classes'], d['class_sessions'], d['enrollments'], d['students']
BAD = re.compile(r'test|demo|harness|smoke|retest|e2e|break|fixture|gap |transition|regression|invalid|negative|huge capacity|far future|far past|bad type|xss|script|^A{20,}', re.I)

junk_cls = sorted({c['_id'] for c in cl if BAD.search(str(c.get('name','')))} | {'-OpBA7SqlXRFc_1kuxw5', '-OpB41V74CRsXx4Zk3rF'})  # + 2 dups
junk_sess = sorted(s['_id'] for s in cs if s.get('classId') in set(junk_cls))
junk_en = sorted(e['_id'] for e in en if e.get('classId') in set(junk_cls))
junk_en += ['-Ooz_yyRfyRRDaKxo5ig', '-Oozb8xlTNvyM0i1MAap']  # junk-named in kept classes
junk_stu = sorted(s['_id'] for s in st if BAD.search(str(s.get('displayName',''))+str(s.get('email',''))))

report = {'deleted': {'classes': junk_cls, 'class_sessions': junk_sess, 'enrollments': junk_en, 'students': junk_stu},
          'renamed': [], 'healed': [], 'seeded': {}}

writes = [delete('classes', i) for i in junk_cls] + [delete('class_sessions', i) for i in junk_sess] + \
         [delete('enrollments', i) for i in junk_en] + [delete('students', i) for i in junk_stu]

# ── renames in place (FK-referenced placeholders) ──
writes.append(upsert('classes', '-OpB3O55CkgIsJA13Qs4', {'name': 'Advanced Wheel Throwing'}, ['name']))
report['renamed'].append("class -OpB3O55 'Dave's Wheel Throwing' → 'Advanced Wheel Throwing' (2 enrollments reference it)")
writes.append(upsert('instructors', 'Af6fCNEfMe5sxYZPvQj7', {'name': 'Maya Brennan', 'email': 'maya@shirglassworks.com', 'status': 'active', 'payRateCents': 4500, 'skills': ['glass-fusing', 'kiln-forming']}, ['name','email','status','payRateCents','skills']))
report['renamed'].append("instructor Af6fCNEf 'harness-test-… Real Instructor' → 'Maya Brennan'")
writes.append(upsert('admin_passDefinitions', 'ABKnjlKKs6xRmdY4BJME', {'name': '5-Class Glass Pass'}, ['name']))
writes.append(upsert('admin_passDefinitions', '__test_pass_b9', {'name': '10-Visit Studio Pass'}, ['name']))
report['renamed'] += ["passDef ABKnjlKK 'harness-l3-sp-… 5-Class Glass Pass' → '5-Class Glass Pass'",
                      "passDef __test_pass_b9 'B9 Verify Pass' → '10-Visit Studio Pass'"]
writes.append(upsert('students', 'stu_1775070461175', {'contactId': None}, ['contactId']))
report['renamed'].append("student Maria Rodriguez contactId 'test-contact-001' → null")

# ── FK heals: recreate docs at the ids live records reference ──
writes.append(upsert('instructors', '-OpB3FF5QD8Hu-sE_g52', {'name': 'David Stewart', 'email': 'stewartdavidp@gmail.com', 'status': 'active', 'payRateCents': 0, 'skills': ['wheel-throwing', 'glazing'], 'bio': 'Studio owner and lead instructor.', 'createdAt': '2026-04-02T10:00:00.000Z'}))
writes.append(upsert('instructors', '-Ooyt3sd2vEvnXJQzSqd', {'name': 'Sarah Chen', 'email': 'sarah.chen@shirglassworks.com', 'status': 'active', 'payRateCents': 5000, 'skills': ['wheel-throwing', 'hand-building'], 'bio': 'Ceramics instructor — wheel throwing and hand building.', 'createdAt': '2026-03-30T10:00:00.000Z'}))
writes.append(upsert('resources', '-Ooyt49kw3rSBgN6Y5CI', {'name': 'Main Studio', 'type': 'room', 'capacity': 8, 'createdAt': '2026-03-30T10:00:00.000Z'}))
report['healed'] = ["instructor -OpB3FF5 'David Stewart' recreated (21 classes reference it)",
                    "instructor -Ooyt3sd 'Sarah Chen' recreated (kept sessions reference it)",
                    "resource -Ooyt49k 'Main Studio' recreated (kept sessions reference it)"]

# ── seeds ──
writes.append(upsert('resources', 'res_kiln_room', {'name': 'Kiln Room', 'type': 'equipment', 'capacity': 4, 'createdAt': '2026-06-10T18:00:00.000Z'}))
writes.append(upsert('resources', 'res_fusing_lab', {'name': 'Fusing Lab', 'type': 'room', 'capacity': 6, 'createdAt': '2026-06-10T18:00:00.000Z'}))
writes.append(upsert('instructors', 'inst_jonah_reyes', {'name': 'Jonah Reyes', 'email': 'jonah@shirglassworks.com', 'status': 'active', 'payRateCents': 4000, 'skills': ['glass-fusing', 'torch-work'], 'bio': 'Glass artist — fusing and torch work.', 'createdAt': '2026-06-10T18:00:00.000Z'}))
report['seeded']['resources'] = ['res_kiln_room Kiln Room', 'res_fusing_lab Fusing Lab']
report['seeded']['instructors'] = ['inst_jonah_reyes Jonah Reyes']

STUDENTS = [
    ('stu_elena_vasquez', 'Elena Vasquez', 'elena.vasquez@gmail.com', 'signed', False, None, 'Allergic to latex — uses own gloves.'),
    ('stu_tom_okafor', 'Tom Okafor', 'tomokafor@yahoo.com', 'signed', False, None, None),
    ('stu_jenny_park', 'Jenny Park', 'jennypark.art@gmail.com', 'pending', False, None, None),
    ('stu_liam_doyle', 'Liam Doyle', 'liam.doyle14@gmail.com', 'signed', True, {'name': 'Siobhan Doyle', 'relationship': 'Mother', 'phone': '503-555-0182'}, None),
    ('stu_ruth_abrams', 'Ruth Abrams', 'ruth.abrams@comcast.net', 'signed', False, None, 'Prefers morning sessions.'),
    ('stu_carlos_mejia', 'Carlos Mejia', 'cmejia.pdx@gmail.com', 'pending', False, None, None),
]
for sid, name, email, waiver, minor, emc, notes in STUDENTS:
    f = {'displayName': name, 'email': email, 'status': 'active', 'waiverStatus': waiver, 'isMinor': minor, 'createdAt': '2026-06-10T18:00:00.000Z'}
    if emc: f['emergencyContact'] = emc
    if notes: f['notes'] = notes
    writes.append(upsert('students', sid, f))
report['seeded']['students'] = [s[1] for s in STUDENTS]

# extend kept recurring schedules so future sessions are coherent
for cid, end in [('-OoyfmGVRd4DMVZegvZK','2026-07-28'), ('-OoyfoS0xttSJXuSG_bb','2026-07-31'), ('-OpAY8Tob_l-gPPBNTGy','2026-07-29')]:
    writes.append(upsert('classes', cid, {'schedule': {'endDate': end}}, ['schedule.endDate']))
report['healed'].append('recurring schedules extended to late July (3 classes)')

SC = {'wtb': '-OoyfmGVRd4DMVZegvZK', 'ost': '-OoyfoS0xttSJXuSG_bb', 'itw': '-OpAY8Tob_l-gPPBNTGy', 'gfw': '-OoyfnvdTqMdFGJF-p2C', 'awt': '-OpB3O55CkgIsJA13Qs4'}
SAR = ('-Ooyt3sd2vEvnXJQzSqd', 'Sarah Chen'); DAV = ('-OpB3FF5QD8Hu-sE_g52', 'David Stewart'); JON = ('inst_jonah_reyes', 'Jonah Reyes')
MAIN = ('-Ooyt49kw3rSBgN6Y5CI', 'Main Studio'); FUS = ('res_fusing_lab', 'Fusing Lab')
SESSIONS = [  # id, class, date, start, end, cap, instructor, resource
    ('sess_wtb_0616', 'wtb', '2026-06-16', '18:00', '20:00', 8, SAR, MAIN),
    ('sess_wtb_0623', 'wtb', '2026-06-23', '18:00', '20:00', 8, SAR, MAIN),
    ('sess_wtb_0630', 'wtb', '2026-06-30', '18:00', '20:00', 8, SAR, MAIN),
    ('sess_itw_0617', 'itw', '2026-06-17', '14:00', '16:00', 6, DAV, MAIN),
    ('sess_itw_0624', 'itw', '2026-06-24', '14:00', '16:00', 6, DAV, MAIN),
    ('sess_ost_0611', 'ost', '2026-06-11', '10:00', '13:00', 10, DAV, MAIN),
    ('sess_ost_0613', 'ost', '2026-06-13', '10:00', '13:00', 10, DAV, MAIN),
    ('sess_ost_0618', 'ost', '2026-06-18', '10:00', '13:00', 10, DAV, MAIN),
    ('sess_gfw_0620', 'gfw', '2026-06-20', '10:00', '14:00', 6, JON, FUS),
    ('sess_awt_0625', 'awt', '2026-06-25', '18:00', '20:30', 6, SAR, MAIN),
]
ENROLLS = [  # id, session, class, student(name,email,stu_id), status, cents, extra
    ('enr_ev_wtb1', 'sess_wtb_0616', 'wtb', ('Elena Vasquez','elena.vasquez@gmail.com','stu_elena_vasquez'), 'confirmed', 4000, {}),
    ('enr_to_wtb1', 'sess_wtb_0616', 'wtb', ('Tom Okafor','tomokafor@yahoo.com','stu_tom_okafor'), 'confirmed', 4000, {}),
    ('enr_jp_wtb1', 'sess_wtb_0616', 'wtb', ('Jenny Park','jennypark.art@gmail.com','stu_jenny_park'), 'waitlisted', 0, {'waitlistPosition': 1}),
    ('enr_ra_wtb1', 'sess_wtb_0616', 'wtb', ('Ruth Abrams','ruth.abrams@comcast.net','stu_ruth_abrams'), 'waitlisted', 0, {'waitlistPosition': 2}),
    ('enr_ld_itw1', 'sess_itw_0617', 'itw', ('Liam Doyle','liam.doyle14@gmail.com','stu_liam_doyle'), 'confirmed', 3500, {}),
    ('enr_cm_itw1', 'sess_itw_0617', 'itw', ('Carlos Mejia','cmejia.pdx@gmail.com','stu_carlos_mejia'), 'confirmed', 3500, {}),
    ('enr_mr_gfw1', 'sess_gfw_0620', 'gfw', ('Maria Rodriguez','maria.rodriguez.pdx@gmail.com','stu_1775070461175'), 'confirmed', 6500, {}),
    ('enr_ev_ost1', 'sess_ost_0611', 'ost', ('Elena Vasquez','elena.vasquez@gmail.com','stu_elena_vasquez'), 'confirmed', 2500, {}),
    ('enr_to_awt1', 'sess_awt_0625', 'awt', ('Tom Okafor','tomokafor@yahoo.com','stu_tom_okafor'), 'confirmed', 5500, {}),
    ('enr_ra_ost2', 'sess_ost_0613', 'ost', ('Ruth Abrams','ruth.abrams@comcast.net','stu_ruth_abrams'), 'cancelled', 2500, {'cancelledAt': '2026-06-08T16:12:00.000Z', 'cancelReason': 'Out of town', 'cancelledBy': 'customer'}),
]
enrolled_per = {}
for _id, ck, st_, status, *_ in [(e[0], e[1], e[3], e[4]) for e in ENROLLS]:
    if status == 'confirmed': enrolled_per[ck] = enrolled_per.get(ck, 0) + 1
wl_per = {}
for e in ENROLLS:
    if e[4] == 'waitlisted': wl_per[e[1]] = wl_per.get(e[1], 0) + 1
for sid, ck, date, t1, t2, cap, (iid, iname), (rid, rname) in SESSIONS:
    writes.append(upsert('class_sessions', sid, {'classId': SC[ck], 'date': date, 'startTime': t1, 'endTime': t2, 'capacity': cap, 'enrolled': enrolled_per.get(sid, 0), 'waitlisted': wl_per.get(sid, 0), 'status': 'scheduled', 'instructorId': iid, 'instructorName': iname, 'resourceId': rid, 'resourceName': rname, 'createdAt': '2026-06-10T18:00:00.000Z'}))
for eid, sid, ck, (nm, em, stid), status, cents, extra in ENROLLS:
    f = {'classId': SC[ck], 'sessionId': sid, 'customerName': nm, 'customerEmail': em, 'studentName': nm, 'studentEmail': em, 'studentId': stid, 'status': status, 'pricePaidCents': cents, 'enrollmentType': 'drop-in', 'enrolledAt': '2026-06-09T15:30:00.000Z', 'createdAt': '2026-06-09T15:30:00.000Z'}
    f.update(extra)
    writes.append(upsert('enrollments', eid, f))
report['seeded']['class_sessions'] = [s[0] for s in SESSIONS]
report['seeded']['enrollments'] = [e[0] for e in ENROLLS]

print(f"total writes: {len(writes)} (deletes: {len(junk_cls)+len(junk_sess)+len(junk_en)+len(junk_stu)})")
batch(writes)
json.dump(report, open('/tmp/sgtest15-classes-scrub-report.json','w'), indent=1)
print("done; report at /tmp/sgtest15-classes-scrub-report.json")
