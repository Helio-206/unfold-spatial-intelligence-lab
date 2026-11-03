"""Fixture preview: the boom cylinder extending from its reference stroke, as unfold.motion-frame.v1 frames.

NOT ENGINE OUTPUT. Independent forward kinematics (direct triangle, law of cosines) over the synthetic excavator fixture,
written so the workspace can show a clearly labelled preview while the engineering engine is not connected.
Every frame carries solver.id = "visual-foundry-fixture-fk", a FIXTURE_NOT_ENGINE warning and fixture evidence.
Only the boom chain moves; stick and bucket joints keep their reference values (their cylinders keep their strokes).

Usage: python3 generate_boom_extension_preview.py <assembly.json> <reference-pose.json> <out.json>
"""
import hashlib, json, math, sys

assembly = json.load(open(sys.argv[1], encoding='utf8'))
reference = json.load(open(sys.argv[2], encoding='utf8'))
out = sys.argv[3]

joints = {j['id']: j for j in assembly['joints']}
actuators = {a['id']: a for a in assembly['actuators']}
parts = {p['id']: p for p in assembly['parts']}
boom_cyl = actuators['boom_cylinder']

def vec(j): return j['origin']['translationM']
FOOT = vec(joints['boom_joint'])[:2]            # boom pivot in upper_body
BASE = vec(joints['boom_cyl_base'])[:2]         # boom cylinder base pin in upper_body
ROD = next(p['positionM'] for p in parts['boom']['points'] if p['id'] == 'cyl_rod_pin')[:2]  # rod pin in boom
LC = vec(joints['boom_cyl_slide'])[0]           # closed length
S_REF = boom_cyl['referenceStroke']['value']
S_MAX = boom_cyl['stroke']['max']['value']
Q_LIM = (joints['boom_joint']['limits']['min']['value'], joints['boom_joint']['limits']['max']['value'])
UB_Y = vec(joints['swing'])[1]                  # upper body origin height (swing = 0)

def rot(a, v): c, s = math.cos(a), math.sin(a); return (c * v[0] - s * v[1], s * v[0] + c * v[1])
def length_at(q):
    p = rot(q, ROD); return math.hypot(FOOT[0] + p[0] - BASE[0], FOOT[1] + p[1] - BASE[1])
def solve_q(L):
    # bisection over the joint range: length is monotonic in q for this fixture (asserted by the fixture generator)
    lo, hi = Q_LIM
    f = lambda q: length_at(q) - L
    if f(lo) * f(hi) > 0: return None
    for _ in range(200):
        mid = (lo + hi) / 2
        if f(lo) * f(mid) <= 0: hi = mid
        else: lo = mid
    return (lo + hi) / 2

def qz(a): return [0.0, 0.0, math.sin(a / 2), math.cos(a / 2)]
def qmul(a, b):
    ax, ay, az, aw = a; bx, by, bz, bw = b
    return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz]
def angle_z(q): return 2 * math.atan2(q[2], q[3])

ref = {p['partId']: p for p in reference['parts']}
q_ref = joints['boom_joint']['referenceValue']['value']
boom_chain = ['boom', 'stick', 'bucket', 'stick_cyl_barrel', 'stick_cyl_rod', 'bucket_cyl_barrel', 'bucket_cyl_rod', 'idler_link', 'bucket_link']
foot_w = (FOOT[0], UB_Y + FOOT[1])
tip_local = next(p['positionM'] for p in parts['bucket']['points'] if p['id'] == 'tip')

def norm(q):
    n = math.sqrt(sum(v * v for v in q)); q = [v / n for v in q]
    if q[3] < 0 or (q[3] == 0 and q[2] < 0): q = [-v for v in q]
    return q

STEPS, DURATION = 24, 2.0
S_REACH = length_at(Q_LIM[1]) - LC              # stroke at the boom joint limit
TARGET = min(S_REF + 0.30, S_MAX, S_REACH) - 0.02
canon = lambda obj: json.dumps(obj, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
assembly_digest = hashlib.sha256(canon(assembly).encode()).hexdigest()
frames = []
for i in range(STEPS + 1):
    t = DURATION * i / STEPS
    k = i / STEPS
    s = S_REF + (TARGET - S_REF) * (0.5 - 0.5 * math.cos(math.pi * k))   # smooth ramp of the commanded stroke
    q = solve_q(LC + s)
    dq = q - q_ref
    poses = []
    for pid, p in ref.items():
        T, R = list(p['translationM']), list(p['rotation'])
        if pid in boom_chain:
            rel = (T[0] - foot_w[0], T[1] - foot_w[1]); r = rot(dq, rel)
            T = [foot_w[0] + r[0], foot_w[1] + r[1], T[2]]; R = norm(qmul(qz(dq), R))
        poses.append({'partId': pid, 'translationM': T, 'rotation': R})
    # boom cylinder: barrel points from its base pin to the rod pin; rod slides along it
    rod_w = rot(q, ROD); rod_w = (FOOT[0] + rod_w[0], UB_Y + FOOT[1] + rod_w[1])
    base_w = (BASE[0], UB_Y + BASE[1])
    psi = math.atan2(rod_w[1] - base_w[1], rod_w[0] - base_w[0])
    for pose in poses:
        if pose['partId'] == 'boom_cyl_barrel': pose['translationM'] = [base_w[0], base_w[1], 0.0]; pose['rotation'] = norm(qz(psi))
        if pose['partId'] == 'boom_cyl_rod': pose['translationM'] = [rod_w[0], rod_w[1], 0.0]; pose['rotation'] = norm(qz(psi))
    bucket = next(p for p in poses if p['partId'] == 'bucket')
    ba = angle_z(bucket['rotation']); tl = rot(ba, tip_local[:2]); tip = [bucket['translationM'][0] + tl[0], bucket['translationM'][1] + tl[1], 0.0]
    closure = abs(math.hypot(rod_w[0] - base_w[0], rod_w[1] - base_w[1]) - (LC + s))
    commands = {'actuatorId': 'boom_cylinder', 'stroke': s, 't': t}
    frames.append({
        'schema': 'unfold.motion-frame.v1', 'assemblyId': assembly['id'], 'assemblyDigest': assembly_digest,
        'inputDigest': hashlib.sha256(canon({'assembly': assembly_digest, 'commands': commands}).encode()).hexdigest(),
        'index': i, 'timestampS': t, 'worldFrameId': 'world', 'status': 'ok', 'poseBasis': 'solved', 'parts': poses,
        'joints': [
            {'jointId': 'boom_joint', 'value': q, 'unit': 'rad', 'kind': 'dependent'},
            {'jointId': 'boom_cyl_slide', 'value': s, 'unit': 'm', 'kind': 'commanded'},
            {'jointId': 'boom_cyl_base', 'value': psi, 'unit': 'rad', 'kind': 'dependent'},
        ],
        'actuators': [{'actuatorId': 'boom_cylinder', 'kind': 'hydraulic_cylinder', 'value': s, 'unit': 'm', 'lengthM': LC + s, 'withinLimits': 0 <= s <= S_MAX,
                       'forceN': None, 'forceStatus': 'unknown', 'forceReason': 'Bore, rod and supply pressure are unknown (null) in the fixture.'}],
        'measurements': [
            {'id': 'boom_angle', 'label': 'Ângulo da lança', 'status': 'computed', 'value': q, 'unit': 'rad', 'method': 'Fixture FK (direct triangle), not the engine.', 'subjectIds': ['boom_joint']},
            {'id': 'tip_height', 'label': 'Altura da ponta da caçamba', 'status': 'computed', 'value': tip[1], 'unit': 'm', 'method': 'Fixture FK (direct triangle), not the engine.', 'subjectIds': ['bucket']},
            {'id': 'boom_cylinder_force', 'label': 'Força no cilindro da lança', 'status': 'unknown', 'value': None, 'unit': 'N', 'method': 'Unknown: no hydraulic data in the fixture.', 'subjectIds': ['boom_cylinder']},
        ],
        'solver': {'id': 'visual-foundry-fixture-fk', 'version': '1', 'method': 'Independent Python FK for a labelled preview. Not the engineering engine.', 'status': 'solved',
                   'closureResidualM': closure, 'toleranceM': 1e-9,
                   'assumptions': ['Fixture geometry (synthetic, unreviewed).', 'Only the boom cylinder moves; other strokes held at reference.', 'No collision, load or hydraulic checks.']},
        'collisions': {'checked': False, 'shapesChecked': [], 'shapesSkipped': [{'shapeId': '*', 'reason': 'Fixture preview: collisions are not checked.'}], 'groundPlaneChecked': False, 'contacts': []},
        'warnings': [{'code': 'FIXTURE_NOT_ENGINE', 'severity': 'warning', 'message': 'Pré-visualização de fixture: não é resultado do motor de engenharia.', 'subjectIds': ['boom_cylinder']}],
        'blocked': None,
        'evidence': [{'sourceId': 'src-excavator-fixture', 'locator': 'excavator.assembly.v1', 'excerpt': 'Dimensões sintéticas; não são de nenhum fabricante.'}],
    })
assert all(f['solver']['closureResidualM'] < 1e-9 for f in frames)
doc = {'kind': 'unfold.visual-foundry.fixture-preview', 'id': 'boom-extension-preview', 'label': 'Extensão do cilindro da lança (fixture)',
       'origin': 'fixture', 'validation': 'unreviewed', 'producedBy': 'src/living/visual-foundry/fixtures/generate_boom_extension_preview.py',
       'notEngineOutput': True, 'actuatorId': 'boom_cylinder', 'strokeFromM': S_REF, 'strokeToM': TARGET, 'frames': frames}
json.dump(doc, open(out, 'w', encoding='utf8'), ensure_ascii=False, indent=1); open(out, 'a').write('\n')
print('frames', len(frames), 'stroke', round(S_REF, 4), '->', round(TARGET, 4), 'q', round(q_ref, 4), '->', round(solve_q(LC + TARGET), 4), file=sys.stderr)
