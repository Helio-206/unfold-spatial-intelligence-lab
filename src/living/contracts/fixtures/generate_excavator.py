"""Independent generator of the excavator fixture (unfold.assembly.v1) and its reference-pose motion frame.
Written separately from the TypeScript engine on purpose: it is the second implementation the engine tests compare against."""
import json, math, hashlib, sys
import numpy as np

AT = '2026-11-02T00:00:00.000Z'
SRC = 'src-excavator-fixture'
def prov(note='Dimensão escolhida para o fixture; não vem de nenhum fabricante.'):
    return {'origin': 'fixture', 'validation': 'unreviewed', 'recordedAt': AT, 'evidence': [{'sourceId': SRC, 'locator': 'excavator.assembly.v1', 'excerpt': note}]}
def pose(t=(0, 0, 0), rz=0.0, ry=0.0):
    # rotação em Y e depois Z não é necessária em simultâneo; usa-se uma só.
    if abs(ry) > 0:
        q = [0.0, math.sin(ry / 2), 0.0, math.cos(ry / 2)]
    else:
        q = [0.0, 0.0, math.sin(rz / 2), math.cos(rz / 2)]
    return {'translationM': list(map(float, t)), 'rotation': q, 'provenance': {'translationM': prov(), 'rotation': prov()}}
def qty(v, unit): return {'value': float(v), 'unit': unit, 'provenance': prov()}
def R(a): c, s = math.cos(a), math.sin(a); return np.array([[c, -s], [s, c]])
def circ(c1, r1, c2, r2, sign):
    c1, c2 = np.array(c1, float), np.array(c2, float)
    d = np.linalg.norm(c2 - c1); a = (r1 * r1 - r2 * r2 + d * d) / (2 * d); h2 = r1 * r1 - a * a
    h = math.sqrt(h2); u = (c2 - c1) / d; p = c1 + a * u; n = np.array([-u[1], u[0]]); return p + sign * h * n
ang = lambda v: math.atan2(v[1], v[0])

# ------------------------------------------------------------------ geometria de projecto (m, rad)
FOOT = np.array([0.95, 0.55]); BOOM_BASE = np.array([0.60, 0.05]); BOOM_ROD = np.array([2.20, -0.60]); STICK_PIN = np.array([5.40, 0.0])
STICK_BASE = np.array([2.75, 0.62]); STICK_ROD = np.array([-0.40, 0.10]); BUCKET_PIN = np.array([2.85, 0.0])
BKT_BASE = np.array([0.45, -0.63]); IDLER = np.array([2.60, -0.19]); BKT_LINK_PIN = np.array([-0.39, -0.36]); LI = 0.54; LH = 0.70; BRANCH = 1
TIP = np.array([1.30, -0.65])
Q_BOOM, Q_STICK, Q_BUCKET = 0.45, -1.20, -0.90
LIM = {'boom_joint': (-0.55, 1.05), 'stick_joint': (-2.35, -0.30), 'bucket_joint': (-2.10, 0.0)}

def boom_len(q): return float(np.linalg.norm(FOOT + R(q) @ BOOM_ROD - BOOM_BASE))
def stick_len(q): return float(np.linalg.norm(STICK_PIN + R(q) @ STICK_ROD - STICK_BASE))
def bucket_len(q):
    E = BUCKET_PIN + R(q) @ BKT_LINK_PIN; J = circ(E, LH, IDLER, LI, BRANCH); return float(np.linalg.norm(J - BKT_BASE))
def stroke_design(fn, lim):
    qs = np.linspace(lim[0], lim[1], 400); L = np.array([fn(q) for q in qs])
    assert np.all(np.diff(L) > 0) or np.all(np.diff(L) < 0)
    return L.min(), L.max()
cyl = {}
for name, fn, key in [('boom', boom_len, 'boom_joint'), ('stick', stick_len, 'stick_joint'), ('bucket', bucket_len, 'bucket_joint')]:
    lo, hi = stroke_design(fn, LIM[key])
    Lc = math.floor((lo - 0.05) * 100) / 100       # comprimento fechado: 5 cm abaixo do mínimo usado
    S = math.ceil((hi - Lc + 0.05) * 100) / 100    # curso: 5 cm acima do máximo usado
    cyl[name] = {'Lc': Lc, 'S': S, 'Lmin': lo, 'Lmax': hi}
qref = {'boom': Q_BOOM, 'stick': Q_STICK, 'bucket': Q_BUCKET}
cyl['boom']['sref'] = boom_len(Q_BOOM) - cyl['boom']['Lc']
cyl['stick']['sref'] = stick_len(Q_STICK) - cyl['stick']['Lc']
cyl['bucket']['sref'] = bucket_len(Q_BUCKET) - cyl['bucket']['Lc']
for k, v in cyl.items(): print(k, {a: round(b, 4) for a, b in v.items()}, 'ratio %.3f' % ((v['Lc'] + v['S']) / v['Lc']), file=sys.stderr)

# reference values of dependent joints
psi_boom = ang(FOOT + R(Q_BOOM) @ BOOM_ROD - BOOM_BASE)
psi_stick = ang(STICK_PIN + R(Q_STICK) @ STICK_ROD - STICK_BASE)
E_ref = BUCKET_PIN + R(Q_BUCKET) @ BKT_LINK_PIN; J_ref = circ(E_ref, LH, IDLER, LI, BRANCH)
psi_bkt_cyl = ang(J_ref - BKT_BASE); psi_idler = ang(J_ref - IDLER); psi_link = math.atan2(math.sin(ang(E_ref - J_ref) - psi_idler), math.cos(ang(E_ref - J_ref) - psi_idler))

def barrel_len(Lc): return round(Lc * 0.6, 3)
def rod_len(c): return round(c['Lc'] * 0.55 + c['S'] * 0.4, 3)
def cyl_shapes(c, name):
    Lb = barrel_len(c['Lc']); Lr = rod_len(c)
    return (
        [{'id': f'{name}-barrel', 'kind': 'cylinder', 'radiusM': 0.09, 'halfLengthM': Lb / 2, 'pose': pose((Lb / 2, 0, 0)), 'purpose': 'both', 'provenance': prov()}],
        [{'id': f'{name}-rod', 'kind': 'cylinder', 'radiusM': 0.05, 'halfLengthM': Lr / 2, 'pose': pose((-Lr / 2, 0, 0)), 'purpose': 'both', 'provenance': prov()}],
    )
def part(pid, label, role, points=(), shapes=()):
    return {'id': pid, 'label': label, 'role': role, 'points': list(points), 'shapes': list(shapes), 'massKg': None, 'provenance': prov()}
def pt(pid, role, xyz): return {'id': pid, 'role': role, 'positionM': list(map(float, xyz)), 'provenance': prov()}
def box(sid, center, half, purpose='both'): return {'id': sid, 'kind': 'box', 'halfExtentsM': list(map(float, half)), 'pose': pose(center), 'purpose': purpose, 'provenance': prov()}

bb, bs = cyl_shapes(cyl['boom'], 'boom-cyl'); sb, ss = cyl_shapes(cyl['stick'], 'stick-cyl'); kb, ks = cyl_shapes(cyl['bucket'], 'bucket-cyl')
parts = [
    part('chassis', 'Chassis (material circulante)', 'chassis', [pt('swing_axis', 'anchor', (0, 0.95, 0))], [box('chassis-body', (0, 0.45, 0), (1.75, 0.45, 1.40))]),
    part('upper_body', 'Corpo superior rotativo', 'upper_body', [], [box('upper-body-box', (-0.30, 0.75, 0), (1.70, 0.75, 1.25))]),
    part('boom', 'Lança', 'boom', [pt('cyl_rod_pin', 'pin', (*BOOM_ROD, 0))], [box('boom-box', (2.70, 0.0, 0), (2.80, 0.38, 0.22))]),
    part('stick', 'Braço', 'stick', [pt('cyl_rod_pin', 'pin', (*STICK_ROD, 0))], [box('stick-box', (1.35, -0.05, 0), (1.50, 0.25, 0.15))]),
    part('bucket', 'Caçamba', 'bucket', [pt('link_pin', 'pin', (*BKT_LINK_PIN, 0)), pt('tip', 'tool_tip', (*TIP, 0))], [box('bucket-box', (0.55, -0.30, 0), (0.75, 0.35, 0.55))]),
    part('boom_cyl_barrel', 'Cilindro da lança · barril', 'cylinder_barrel', [], bb),
    part('boom_cyl_rod', 'Cilindro da lança · haste', 'cylinder_rod', [pt('end_pin', 'pin', (0, 0, 0))], [x for x in cyl_shapes(cyl['boom'], 'boom-cyl')[1]]),
    part('stick_cyl_barrel', 'Cilindro do braço · barril', 'cylinder_barrel', [], sb),
    part('stick_cyl_rod', 'Cilindro do braço · haste', 'cylinder_rod', [pt('end_pin', 'pin', (0, 0, 0))], ss),
    part('bucket_cyl_barrel', 'Cilindro da caçamba · barril', 'cylinder_barrel', [], kb),
    part('bucket_cyl_rod', 'Cilindro da caçamba · haste', 'cylinder_rod', [pt('end_pin', 'pin', (0, 0, 0))], ks),
    part('idler_link', 'Balancé (idler)', 'link', [pt('end', 'pin', (LI, 0, 0))], [box('idler-link-box', (LI / 2, 0, 0), (LI / 2, 0.04, 0.10), 'visual')]),
    part('bucket_link', 'Barra de ligação da caçamba', 'link', [pt('end', 'pin', (LH, 0, 0))], [box('bucket-link-box', (LH / 2, 0, 0), (LH / 2, 0.04, 0.10), 'visual')]),
]
def joint(jid, typ, parent, child, origin, axis, lim, ref, motion):
    unit = 'm' if typ == 'prismatic' else 'rad'
    return {'id': jid, 'type': typ, 'parentPartId': parent, 'childPartId': child, 'origin': origin, 'axis': list(map(float, axis)),
            'limits': None if lim is None else {'min': qty(lim[0], unit), 'max': qty(lim[1], unit)},
            'referenceValue': None if ref is None else qty(ref, unit), 'motion': motion, 'provenance': prov()}
PI = math.pi; Z = (0, 0, 1); X = (1, 0, 0)
joints = [
    joint('swing', 'revolute', 'chassis', 'upper_body', pose((0, 0.95, 0)), (0, 1, 0), (-PI, PI), 0.0, {'positive': 'swing_left', 'negative': 'swing_right'}),
    joint('boom_joint', 'revolute', 'upper_body', 'boom', pose((*FOOT, 0)), Z, LIM['boom_joint'], Q_BOOM, {'positive': 'raise', 'negative': 'lower'}),
    joint('stick_joint', 'revolute', 'boom', 'stick', pose((*STICK_PIN, 0)), Z, LIM['stick_joint'], Q_STICK, {'positive': 'extend', 'negative': 'retract'}),
    joint('bucket_joint', 'revolute', 'stick', 'bucket', pose((*BUCKET_PIN, 0)), Z, LIM['bucket_joint'], Q_BUCKET, {'positive': 'dump', 'negative': 'curl'}),
    joint('boom_cyl_base', 'revolute', 'upper_body', 'boom_cyl_barrel', pose((*BOOM_BASE, 0)), Z, (-PI, PI), psi_boom, None),
    joint('boom_cyl_slide', 'prismatic', 'boom_cyl_barrel', 'boom_cyl_rod', pose((cyl['boom']['Lc'], 0, 0)), X, (0.0, cyl['boom']['S']), cyl['boom']['sref'], None),
    joint('stick_cyl_base', 'revolute', 'boom', 'stick_cyl_barrel', pose((*STICK_BASE, 0)), Z, (-PI, PI), psi_stick, None),
    joint('stick_cyl_slide', 'prismatic', 'stick_cyl_barrel', 'stick_cyl_rod', pose((cyl['stick']['Lc'], 0, 0)), X, (0.0, cyl['stick']['S']), cyl['stick']['sref'], None),
    joint('bucket_cyl_base', 'revolute', 'stick', 'bucket_cyl_barrel', pose((*BKT_BASE, 0)), Z, (-PI, PI), psi_bkt_cyl, None),
    joint('bucket_cyl_slide', 'prismatic', 'bucket_cyl_barrel', 'bucket_cyl_rod', pose((cyl['bucket']['Lc'], 0, 0)), X, (0.0, cyl['bucket']['S']), cyl['bucket']['sref'], None),
    joint('idler_pivot', 'revolute', 'stick', 'idler_link', pose((*IDLER, 0)), Z, (-PI, PI), psi_idler, None),
    joint('link_pin', 'revolute', 'idler_link', 'bucket_link', pose((LI, 0, 0)), Z, (-PI, PI), psi_link, None),
]
def cons(cid, pa, a, pb, b): return {'id': cid, 'kind': 'coincident_points', 'a': {'partId': pa, 'pointId': a}, 'b': {'partId': pb, 'pointId': b}, 'provenance': prov()}
constraints = [
    cons('boom_cyl_closure', 'boom_cyl_rod', 'end_pin', 'boom', 'cyl_rod_pin'),
    cons('stick_cyl_closure', 'stick_cyl_rod', 'end_pin', 'stick', 'cyl_rod_pin'),
    cons('bucket_cyl_closure', 'bucket_cyl_rod', 'end_pin', 'idler_link', 'end'),
    cons('bucket_link_closure', 'bucket_link', 'end', 'bucket', 'link_pin'),
]
HYD = lambda: {'boreDiameter': None, 'rodDiameter': None, 'supplyPressure': None}
def cylinder(aid, label, name, drives, maxrate=0.15):
    c = cyl[name]
    return {'id': aid, 'label': label, 'kind': 'hydraulic_cylinder', 'barrelPartId': f'{name}_cyl_barrel', 'rodPartId': f'{name}_cyl_rod', 'slideJointId': f'{name}_cyl_slide',
            'stroke': {'min': qty(0.0, 'm'), 'max': qty(c['S'], 'm')}, 'referenceStroke': qty(c['sref'], 'm'), 'maxRate': qty(maxrate, 'm/s'), 'hydraulics': HYD(), 'drives': drives, 'provenance': prov()}
actuators = [
    {'id': 'swing_drive', 'label': 'Motor de rotação', 'kind': 'rotary_drive', 'jointId': 'swing', 'maxRate': qty(0.35, 'rad/s'), 'provenance': prov()},
    cylinder('boom_cylinder', 'Cilindro da lança', 'boom', {'jointId': 'boom_joint', 'transmission': 'direct_triangle', 'constraintIds': ['boom_cyl_closure'], 'linkPartIds': []}),
    cylinder('stick_cylinder', 'Cilindro do braço', 'stick', {'jointId': 'stick_joint', 'transmission': 'direct_triangle', 'constraintIds': ['stick_cyl_closure'], 'linkPartIds': []}),
    cylinder('bucket_cylinder', 'Cilindro da caçamba', 'bucket', {'jointId': 'bucket_joint', 'transmission': 'two_link_chain', 'constraintIds': ['bucket_cyl_closure', 'bucket_link_closure'], 'linkPartIds': ['idler_link', 'bucket_link']}),
]
assembly = {
    'schema': 'unfold.assembly.v1', 'id': 'excavator-fixture-1', 'title': 'Escavadora de rastos (fixture sintético)',
    'units': {'length': 'm', 'angle': 'rad', 'time': 's'},
    'sources': [{'id': SRC, 'kind': 'fixture', 'title': 'Escavadora sintética para testes do motor. Dimensões escolhidas por plausibilidade; não são de nenhum fabricante nem têm valor de projecto.'}],
    'frames': [{'id': 'world', 'parentFrameId': None, 'kind': 'world', 'pose': pose(), 'description': 'Mundo: direito, +X frente da máquina, +Y cima, +Z lado direito do operador; metros. O chão é y = 0.'}],
    'root': {'partId': 'chassis', 'frameId': 'world', 'pose': pose()},
    'parts': parts, 'joints': joints, 'constraints': constraints, 'actuators': actuators,
    'collision': {'groundPlane': {'yM': 0.0, 'ignorePartIds': ['chassis', 'bucket']}, 'ignorePairs': [], 'onContact': 'block'},
    'provenance': prov('Montagem sintética gerada por um script independente do motor; serve de dado de teste e de contrato.'),
}
out = sys.argv[1]
json.dump(assembly, open(out, 'w', encoding='utf8'), ensure_ascii=False, indent=2); open(out, 'a').write('\n')

# ------------------------------------------------------------------ pose de referência (FK independente, 4x4)
def T(t=(0, 0, 0)): m = np.eye(4); m[:3, 3] = t; return m
def Rz(a): m = np.eye(4); m[:2, :2] = R(a); return m
def Ry(a): c, s = math.cos(a), math.sin(a); m = np.eye(4); m[0, 0] = c; m[0, 2] = s; m[2, 0] = -s; m[2, 2] = c; return m
def quat(m):
    r = m[:3, :3]; t = r[0, 0] + r[1, 1] + r[2, 2]
    if t > 0: s = math.sqrt(t + 1) * 2; w = s / 4; x = (r[2, 1] - r[1, 2]) / s; y = (r[0, 2] - r[2, 0]) / s; z = (r[1, 0] - r[0, 1]) / s
    elif r[0, 0] > r[1, 1] and r[0, 0] > r[2, 2]: s = math.sqrt(1 + r[0, 0] - r[1, 1] - r[2, 2]) * 2; w = (r[2, 1] - r[1, 2]) / s; x = s / 4; y = (r[0, 1] + r[1, 0]) / s; z = (r[0, 2] + r[2, 0]) / s
    elif r[1, 1] > r[2, 2]: s = math.sqrt(1 + r[1, 1] - r[0, 0] - r[2, 2]) * 2; w = (r[0, 2] - r[2, 0]) / s; x = (r[0, 1] + r[1, 0]) / s; y = s / 4; z = (r[1, 2] + r[2, 1]) / s
    else: s = math.sqrt(1 + r[2, 2] - r[0, 0] - r[1, 1]) * 2; w = (r[1, 0] - r[0, 1]) / s; x = (r[0, 2] + r[2, 0]) / s; y = (r[1, 2] + r[2, 1]) / s; z = s / 4
    q = np.array([x, y, z, w]); q /= np.linalg.norm(q)
    if q[3] < 0 or (q[3] == 0 and q[2] < 0): q = -q
    return [float(v) for v in q]
refq = {j['id']: j['referenceValue']['value'] for j in joints if j['referenceValue']}
W = {'chassis': np.eye(4)}
def child(parent, jid, kind, origin_t, axis_val):
    base = W[parent] @ T(origin_t)
    if kind == 'rot_y': return base @ Ry(axis_val)
    if kind == 'rot_z': return base @ Rz(axis_val)
    return base @ T((axis_val, 0, 0))
W['upper_body'] = child('chassis', 'swing', 'rot_y', (0, 0.95, 0), refq['swing'])
W['boom'] = child('upper_body', 'boom_joint', 'rot_z', (*FOOT, 0), refq['boom_joint'])
W['stick'] = child('boom', 'stick_joint', 'rot_z', (*STICK_PIN, 0), refq['stick_joint'])
W['bucket'] = child('stick', 'bucket_joint', 'rot_z', (*BUCKET_PIN, 0), refq['bucket_joint'])
W['boom_cyl_barrel'] = child('upper_body', 'boom_cyl_base', 'rot_z', (*BOOM_BASE, 0), refq['boom_cyl_base'])
W['boom_cyl_rod'] = child('boom_cyl_barrel', 'boom_cyl_slide', 'slide', (cyl['boom']['Lc'], 0, 0), refq['boom_cyl_slide'])
W['stick_cyl_barrel'] = child('boom', 'stick_cyl_base', 'rot_z', (*STICK_BASE, 0), refq['stick_cyl_base'])
W['stick_cyl_rod'] = child('stick_cyl_barrel', 'stick_cyl_slide', 'slide', (cyl['stick']['Lc'], 0, 0), refq['stick_cyl_slide'])
W['bucket_cyl_barrel'] = child('stick', 'bucket_cyl_base', 'rot_z', (*BKT_BASE, 0), refq['bucket_cyl_base'])
W['bucket_cyl_rod'] = child('bucket_cyl_barrel', 'bucket_cyl_slide', 'slide', (cyl['bucket']['Lc'], 0, 0), refq['bucket_cyl_slide'])
W['idler_link'] = child('stick', 'idler_pivot', 'rot_z', (*IDLER, 0), refq['idler_pivot'])
W['bucket_link'] = child('idler_link', 'link_pin', 'rot_z', (LI, 0, 0), refq['link_pin'])
# fecho dos laços (verificação independente)
def at(p, pt_): v = W[p] @ np.array([*pt_, 1.0]); return v[:3]
res = {
    'boom': np.linalg.norm(at('boom_cyl_rod', (0, 0, 0)) - at('boom', (*BOOM_ROD, 0))),
    'stick': np.linalg.norm(at('stick_cyl_rod', (0, 0, 0)) - at('stick', (*STICK_ROD, 0))),
    'bucket_cyl': np.linalg.norm(at('bucket_cyl_rod', (0, 0, 0)) - at('idler_link', (LI, 0, 0))),
    'bucket_link': np.linalg.norm(at('bucket_link', (LH, 0, 0)) - at('bucket', (*BKT_LINK_PIN, 0))),
}
print('closure residuals (m):', {k: float('%.3e' % v) for k, v in res.items()}, file=sys.stderr)
assert max(res.values()) < 1e-12
order = [p['id'] for p in parts]
frame = {'tip': [float(v) for v in at('bucket', (*TIP, 0))], 'parts': [{'partId': pid, 'translationM': [float(v) for v in W[pid][:3, 3]], 'rotation': quat(W[pid])} for pid in order]}
json.dump(frame, open(out.replace('.assembly.v1.json', '.reference-pose.json'), 'w'), indent=2); open(out.replace('.assembly.v1.json', '.reference-pose.json'), 'a').write('\n')
print('tip ref', frame['tip'], file=sys.stderr)

ts = out.replace('.json', '.ts')
header = ("// Gerado a partir de excavator.assembly.v1.json (o JSON é a fonte; este módulo existe para o browser e para tipos).\n"
          "// Fixture SINTÉTICO: dimensões escolhidas por plausibilidade, sem origem num fabricante. Todas as proveniências são origin \"fixture\", validation \"unreviewed\".\n"
          "import type { Assembly } from '../assembly.v1';\n\n"
          "export const EXCAVATOR_ASSEMBLY_V1: Assembly = ")
open(ts, 'w', encoding='utf8').write(header + json.dumps(assembly, ensure_ascii=False, indent=2) + ';\n')
