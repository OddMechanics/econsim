"""Build public/models/people/{people.glb, people-anim.bin}: one faceless,
gender-neutral mannequin for everyone, from Quaternius' CC0 packs (Universal
Animation Library for the mannequin and most clips, Ultimate Modular Men for
three clips).

- Skeleton: our 60 joints (the modular rig's names, which the runtime uses) at
  the mannequin's bind positions, with identity rest rotations: the UAL and the
  modular rig are both bound in the same T-pose, so world-rotation deltas from
  either transfer as is. Joints are flat in the GLB (named after the joint);
  the runtime builds its own hierarchy.
- Parts: the mannequin split by dominant bone into head / body / legs / feet,
  each in a few clothing variants painted per triangle (TEXCOORD_0.u = palette
  slot). The knuckle spheres are swapped for low-poly ones (they were half the
  triangles). Welded, no normals: the runtime flat-shades.
- Animations: retargeted to the mannequin (world-rotation deltas), sampled at
  30 fps, int16 quaternions, written to a small custom binary.

usage: python3 -I build_people.py <modular_dir> <ual_gltf> <out_dir>
  modular_dir holds M_Casual_2.glb (Ultimate Modular Men, Casual_2 character)
"""
import json, struct, sys, os
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from gl import Gltf, qmul, qinv, qnorm, qrot, m2q, sample_channel

SRC, UAL, OUT = sys.argv[1], sys.argv[2], sys.argv[3]

# palette slots; keep in sync with ROLE in src/render/characters.ts
ROLES = ['skin', 'top', 'top2', 'topDark', 'accent', 'pants', 'shoe', 'shoe2', 'vest', 'stripe']
R = {r: i for i, r in enumerate(ROLES)}

# ------------------------------------------------------------------ skeleton
ref = Gltf(os.path.join(SRC, 'M_Casual_2.glb'))
SRCJ = [ref.nodes[k]['name'] for k in ref.j['skins'][0]['joints']]
JOINTS = [n for n in SRCJ if not n.startswith('PT.')]
JI = {n: i for i, n in enumerate(JOINTS)}
FINGERS = ['Index', 'Middle', 'Ring', 'Pinky']

def parent_of(n):
    if n == 'Root': return None
    side = n[-2:] if n.endswith(('.L', '.R')) else ''
    base = n[:-2] if side else n
    P = {'Body': 'Root', 'Hips': 'Body', 'Abdomen': 'Hips', 'Torso': 'Abdomen', 'Chest': 'Torso',
         'Neck': 'Chest', 'Head': 'Neck', 'Shoulder': 'Chest', 'UpperArm': 'Shoulder', 'LowerArm': 'UpperArm',
         'Wrist': 'LowerArm', 'UpperLeg': 'Body', 'LowerLeg': 'UpperLeg', 'Foot': 'LowerLeg'}
    if base in P:
        p = P[base]
        return p + side if p in ('Shoulder', 'UpperArm', 'LowerArm', 'Wrist', 'UpperLeg', 'LowerLeg') else p
    for f in FINGERS + ['Thumb']:
        if base.startswith(f):
            k = int(base[len(f):])
            return ('Wrist' + side) if k == 1 else (f + str(k - 1) + side)
    raise KeyError(n)

PARENT = [JI[parent_of(n)] if parent_of(n) else -1 for n in JOINTS]
for i, p in enumerate(PARENT):
    assert p < i, (JOINTS[i], p)  # topological order

def bind_world(g):
    """name -> 4x4 bind world matrix (inverse IBM) for a file's skin."""
    sk = g.j['skins'][0]
    ibm = g.acc(sk['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
    return {g.nodes[k]['name']: np.linalg.inv(ibm[i]) for i, k in enumerate(sk['joints'])}

gu = Gltf(UAL)
UN = [gu.nodes[k]['name'] for k in gu.j['skins'][0]['joints']]
UP = {k: v[:3, 3] for k, v in bind_world(gu).items()}

# UAL deform bone -> our joint (the UAL hand has no metacarpals: its finger
# bones are our segments 2..4; our segment 1 sits between wrist and knuckle)
UAL_MAP = {'DEF-hips': 'Body', 'DEF-spine.001': 'Abdomen', 'DEF-spine.002': 'Torso', 'DEF-spine.003': 'Chest',
           'DEF-neck': 'Neck', 'DEF-head': 'Head'}
for s in ('.L', '.R'):
    UAL_MAP.update({'DEF-shoulder' + s: 'Shoulder' + s, 'DEF-upper_arm' + s: 'UpperArm' + s, 'DEF-forearm' + s: 'LowerArm' + s,
                    'DEF-hand' + s: 'Wrist' + s, 'DEF-thigh' + s: 'UpperLeg' + s, 'DEF-shin' + s: 'LowerLeg' + s,
                    'DEF-foot' + s: 'Foot' + s})
    for f, F in (('index', 'Index'), ('middle', 'Middle'), ('ring', 'Ring'), ('pinky', 'Pinky')):
        for k in range(3):
            UAL_MAP['DEF-f_%s.0%d%s' % (f, k + 1, s)] = '%s%d%s' % (F, k + 2, s)
    for k in range(3):
        UAL_MAP['DEF-thumb.0%d%s' % (k + 1, s)] = 'Thumb%d%s' % (k + 1, s)
SKIN_MAP = dict(UAL_MAP, **{'DEF-toe.L': 'Foot.L', 'DEF-toe.R': 'Foot.R', 'root': 'Root'})  # vertex weights only (root: unused slots)

TP = np.zeros((len(JOINTS), 3))  # target (mannequin) joint positions
for u, n in UAL_MAP.items():
    TP[JI[n]] = UP[u]
TP[JI['Hips']] = TP[JI['Body']]
for s in ('.L', '.R'):
    for F in FINGERS:
        w, k1 = TP[JI['Wrist' + s]], TP[JI[F + '2' + s]]
        TP[JI[F + '1' + s]] = w + 0.4 * (k1 - w)
print('rig: hips %.3f head %.3f' % (TP[JI['UpperLeg.L']][1], TP[JI['Head']][1]))

# ------------------------------------------------------------------ mannequin mesh
node = [n for n in gu.nodes if 'mesh' in n][0]
mesh = gu.j['meshes'][node['mesh']]
Ps, Js, Ws, Is = [], [], [], []
base = 0
knuckles = []  # (vertex ids) of the hand joint spheres
for p in mesh['primitives']:
    P = gu.acc(p['attributes']['POSITION'])
    J = gu.acc(p['attributes']['JOINTS_0']).astype(np.int64)
    W = gu.acc(p['attributes']['WEIGHTS_0'])
    I = gu.acc(p['indices'])[:, 0].astype(np.int64)
    Ps.append(P); Js.append(J); Ws.append(W); Is.append(I + base)
    if 'Joint' in gu.j['materials'][p['material']]['name']:
        knuckles.append((base, len(P), I + base))
    base += len(P)
P = np.vstack(Ps); J = np.vstack(Js); W = np.vstack(Ws); I = np.concatenate(Is)
W = np.where(W < 0.004, 0, W)
W = W / W.sum(1, keepdims=True)
OJ = np.array([[JI[SKIN_MAP[UN[j]]] for j in row] for row in J])
DOM = np.array([UN[J[v, np.argmax(W[v])]] for v in range(len(P))])  # dominant UAL bone per vertex
TRI = I.reshape(-1, 3)

def is_hand(b):
    return 'DEF-hand' in b or 'DEF-f_' in b or 'DEF-thumb' in b

# neutral build: the mannequin is sculpted with a bodybuilder's shoulders, chest
# and arms; pull those surfaces toward the bones (weight-blended, so no seams)
SLIM = {'DEF-shoulder': 0.72, 'DEF-upper_arm': 0.78, 'DEF-forearm': 0.86, 'DEF-spine.003': 0.84, 'DEF-spine.002': 0.92}
CHILD = {'DEF-hips': 'DEF-spine.001', 'DEF-spine.001': 'DEF-spine.002', 'DEF-spine.002': 'DEF-spine.003', 'DEF-spine.003': 'DEF-neck',
         'DEF-shoulder': 'DEF-upper_arm', 'DEF-upper_arm': 'DEF-forearm', 'DEF-forearm': 'DEF-hand'}
def slim(P, J, W):
    out = np.zeros_like(P)
    for j in range(len(UN)):
        b = UN[j]
        side = b[-2:] if b.endswith(('.L', '.R')) else ''
        base = b[:-2] if side else b
        w = (W * (J == j)).sum(1)
        if not w.any(): continue
        k = SLIM.get(base, 1.0)
        if k == 1.0:
            out += w[:, None] * P; continue
        a, c = UP[b], UP[CHILD[base] + side]
        d = c - a
        t = np.clip(((P - a) @ d) / (d @ d), 0, 1)
        axis = a + t[:, None] * d
        out += w[:, None] * (axis + (P - axis) * k)
    return out
P = slim(P, J, W)

# knuckles: connected pieces of the joint material on the fingers -> icosahedra
ICO_V = np.array([[-1, 1.618, 0], [1, 1.618, 0], [-1, -1.618, 0], [1, -1.618, 0], [0, -1, 1.618], [0, 1, 1.618],
                  [0, -1, -1.618], [0, 1, -1.618], [1.618, 0, -1], [1.618, 0, 1], [-1.618, 0, -1], [-1.618, 0, 1]])
ICO_V = ICO_V / np.linalg.norm(ICO_V, axis=1, keepdims=True)
ICO_F = np.array([[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6],
                  [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10],
                  [8, 6, 7], [9, 8, 1]])
drop = np.zeros(len(TRI), bool)
newP, newJ, newW, newT = [], [], [], []
par = np.arange(len(P))
def root(a):
    while par[a] != a:
        par[a] = par[par[a]]; a = par[a]
    return a
for b0, n, Ik in knuckles:
    for t in Ik.reshape(-1, 3):
        for a, b in ((t[0], t[1]), (t[1], t[2])):
            ra, rb = root(a), root(b)
            if ra != rb: par[ra] = rb
    seen = {}
    for v in range(b0, b0 + n):  # same position = same piece (split seams)
        k = tuple(np.round(P[v], 5))
        if k in seen:
            ra, rb = root(v), root(seen[k])
            if ra != rb: par[ra] = rb
        else:
            seen[k] = v
tri_root = np.array([root(t[0]) for t in TRI])
kn_mask = np.zeros(len(P), bool)
for b0, n, _ in knuckles: kn_mask[b0:b0 + n] = True
pieces = {}
for t in np.where(kn_mask[TRI[:, 0]])[0]:
    pieces.setdefault(tri_root[t], []).append(t)
for ts in pieces.values():
    vs = np.unique(TRI[ts].ravel())
    if not all(is_hand(DOM[v]) for v in vs):
        continue
    lo, hi = P[vs].min(0), P[vs].max(0)
    c, half = (lo + hi) / 2, (hi - lo) / 2
    near = vs[np.argmin(np.linalg.norm(P[vs] - c, axis=1))]  # skin like the nearest original vertex
    drop[ts] = True
    newT.append(ICO_F + len(P) + 12 * len(newP))
    newP.append(c + ICO_V * half)
    newJ.append(np.repeat(OJ[near][None], 12, 0)); newW.append(np.repeat(W[near][None], 12, 0))
    DOM = np.concatenate([DOM, np.repeat(DOM[near], 12)])
P = np.vstack([P] + newP); OJ = np.vstack([OJ] + newJ); W = np.vstack([W] + newW)
TRI = np.vstack([TRI[~drop]] + newT)
nk = len(newP)
print('mannequin: %d knuckles simplified, %d tris, height %.3f' % (nk, len(TRI), P[:, 1].max()))
# measurements for the worn props in src/render/characters.ts (forward = +z)
def front(y, half_x=0.12):
    band = P[(np.abs(P[:, 1] - y) < 0.02) & (np.abs(P[:, 0]) < half_x)]
    return band[:, 2].max()
wy = UP['DEF-hips'][1] + 0.1
wb = P[(np.abs(P[:, 1] - wy) < 0.02) & (np.abs(P[:, 0]) < 0.3)]
print('  front of chest %.3f, torso %.3f; waist (hips+0.1) half-width %.3f, z %.3f..%.3f' % (
    front(UP['DEF-spine.003'][1]), front(UP['DEF-spine.002'][1]), np.abs(wb[:, 0]).max(), wb[:, 2].min(), wb[:, 2].max()))

def region(b):
    b = b.replace('.L', '').replace('.R', '')
    if b in ('DEF-head', 'DEF-neck'): return 'head'
    if b in ('DEF-foot', 'DEF-toe'): return 'foot'
    if b in ('DEF-thigh', 'DEF-shin', 'DEF-hips'): return 'legs'
    if b in ('DEF-upper_arm', 'DEF-forearm'): return 'arm'
    if is_hand(b): return 'hand'
    return 'torso'

tri_reg = []
for t in TRI:
    rs = [region(DOM[v]) for v in t]
    tri_reg.append(max(set(rs), key=rs.count))
tri_reg = np.array(tri_reg)
CEN = P[TRI].mean(1)
PART = {'head': 'head', 'torso': 'body', 'arm': 'body', 'hand': 'body', 'legs': 'legs', 'foot': 'feet'}
tri_part = np.array([PART[r] for r in tri_reg])

# ------------------------------------------------------------------ clothes (palette zones per triangle)
# glTF space: +x = the character's left, +z = forward; arms along x (T-pose)
WRIST = abs(UP['DEF-hand.L'][0])
SLEEVE = 0.34  # short sleeve end (|x|)

def body_role(v, reg, c):
    x, y, z = c
    ax = abs(x)
    if reg == 'hand' or ax >= WRIST - 0.01: return 'skin'
    if v == 'tee':
        return 'top' if reg == 'torso' or ax < SLEEVE else 'skin'
    if v == 'long':
        return 'top'
    if v == 'hoodie':  # darker cuffs and waistband
        return 'topDark' if ax > WRIST - 0.06 or (reg == 'torso' and y < 1.02) else 'top'
    if v == 'suit':  # jacket, shirt cuffs, shirt and tie in the V
        if ax > WRIST - 0.03: return 'top2'
        if reg == 'torso' and z > 0.02 and y > 1.22 and ax < (y - 1.22) * 0.5 + 0.012:
            return 'accent' if ax < 0.016 and y < 1.44 else 'top2'
        return 'top'
    if v == 'hivis':  # vest with a reflective band over a tee
        if reg == 'torso':
            return 'stripe' if 1.16 < y < 1.22 else 'vest'
        return 'top' if ax < SLEEVE else 'skin'
    if v == 'overall':  # bib and straps over a tee
        if reg == 'torso':
            return 'pants' if y < 1.27 or abs(ax - 0.085) < 0.022 else 'top'
        return 'top' if ax < SLEEVE else 'skin'
    raise KeyError(v)

VARIANTS = {
    'head': {'bare': lambda v, reg, c: 'skin'},
    'body': {v: body_role for v in ('tee', 'long', 'hoodie', 'suit', 'hivis', 'overall')},
    'legs': {'pants': lambda v, reg, c: 'pants', 'shorts': lambda v, reg, c: 'pants' if c[1] > 0.6 else 'skin'},
    'feet': {'shoe': lambda v, reg, c: 'shoe', 'sneaker': lambda v, reg, c: 'shoe2' if c[1] < 0.03 else 'shoe'},
}

def build_part(sel, roles):
    """Triangles `sel` with per-triangle roles -> welded part arrays."""
    tris = TRI[sel]
    vP = P[tris].reshape(-1, 3); vJ = OJ[tris].reshape(-1, 4); vW = W[tris].reshape(-1, 4)
    vS = np.repeat(roles, 3)
    Wq = np.floor(vW * 255 + 0.5).astype(np.int64)  # 8-bit weights summing to 255
    Wq[np.arange(len(Wq)), Wq.argmax(1)] += 255 - Wq.sum(1)
    vJ = np.where(Wq > 0, vJ, 0)
    key = np.hstack([np.round(vP, 5), vJ, Wq, vS[:, None]])
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    return dict(P=vP[first], J=vJ[first], W=Wq[first], S=vS[first], I=inv.reshape(-1))

parts_out = []
for part, vs in VARIANTS.items():
    sel = np.where(tri_part == part)[0]
    for v, fn in vs.items():
        pt = build_part(sel, np.array([R[fn(v, tri_reg[t], CEN[t])] for t in sel]))
        pt['id'] = '%s_%s' % (part, v)
        parts_out.append(pt)
        print('%-14s verts %5d tris %5d' % (pt['id'], len(pt['P']), len(sel)))

# ------------------------------------------------------------------ write GLB
class Bin:
    def __init__(self):
        self.data = bytearray(); self.views = []; self.accs = []
    def add(self, arr, ctype, typ, normalized=False, target=None, minmax=False):
        while len(self.data) % 4: self.data.append(0)
        off = len(self.data)
        b = arr.tobytes()
        self.data += b
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(b)}
        if target: v['target'] = target
        self.views.append(v)
        a = {'bufferView': len(self.views) - 1, 'componentType': ctype, 'count': int(arr.shape[0]), 'type': typ}
        if normalized: a['normalized'] = True
        if minmax:
            a['min'] = [float(x) for x in arr.min(0)]; a['max'] = [float(x) for x in arr.max(0)]
        self.accs.append(a)
        return len(self.accs) - 1

B = Bin()
nodes = [{'name': 'people', 'children': [1]}, {'name': 'Armature', 'children': []}]
jn = []
for i, n in enumerate(JOINTS):
    nodes.append({'name': n, 'translation': [float(x) for x in TP[i]]})
    nodes[1]['children'].append(len(nodes) - 1)
    jn.append(len(nodes) - 1)
ibm = np.zeros((len(JOINTS), 4, 4), dtype=np.float32)
for i in range(len(JOINTS)):
    ibm[i] = np.eye(4); ibm[i][:3, 3] = -TP[i]
acc = B.add(np.ascontiguousarray(ibm.transpose(0, 2, 1)).reshape(-1, 16), 5126, 'MAT4')
skins = [{'name': 'mannequin', 'joints': jn, 'inverseBindMatrices': acc, 'skeleton': 1}]

meshes = []
for pt in parts_out:
    pos = B.add(pt['P'].astype(np.float32), 5126, 'VEC3', target=34962, minmax=True)
    jts = B.add(pt['J'].astype(np.uint8), 5121, 'VEC4', target=34962)
    wts = B.add(pt['W'].astype(np.uint8), 5121, 'VEC4', normalized=True, target=34962)
    uv = np.zeros((len(pt['S']), 2), dtype=np.uint16)
    uv[:, 0] = np.round((pt['S'] + 0.5) / 16 * 65535).astype(np.uint16)
    uv[:, 1] = 32768
    tex = B.add(uv, 5123, 'VEC2', normalized=True, target=34962)
    idx = B.add(pt['I'].astype(np.uint16 if len(pt['P']) < 65536 else np.uint32), 5123 if len(pt['P']) < 65536 else 5125, 'SCALAR', target=34963)
    meshes.append({'name': pt['id'], 'primitives': [{'attributes': {'POSITION': pos, 'JOINTS_0': jts, 'WEIGHTS_0': wts, 'TEXCOORD_0': tex},
                                                     'indices': idx, 'material': 0}]})
    nodes.append({'name': pt['id'], 'mesh': len(meshes) - 1, 'skin': 0})
    nodes[0]['children'].append(len(nodes) - 1)

gltf = {
    'asset': {'version': '2.0', 'generator': 'econsim build_people.py',
              'copyright': 'CC0 1.0: Quaternius (quaternius.com), Universal Animation Library mannequin'},
    'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': nodes, 'meshes': meshes, 'skins': skins,
    'materials': [{'name': 'palette', 'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': 0, 'roughnessFactor': 1}}],
    'accessors': B.accs, 'bufferViews': B.views, 'buffers': [{'byteLength': len(B.data)}],
    'extras': {'roles': ROLES, 'joints': JOINTS, 'parents': PARENT},
}
js = json.dumps(gltf, separators=(',', ':')).encode()
js += b' ' * ((4 - len(js) % 4) % 4)
while len(B.data) % 4: B.data.append(0)
glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(B.data)) + struct.pack('<II', len(js), 0x4E4F534A) + js + \
      struct.pack('<II', len(B.data), 0x004E4942) + bytes(B.data)
os.makedirs(OUT, exist_ok=True)
open(os.path.join(OUT, 'people.glb'), 'wb').write(glb)
print('people.glb', len(glb), 'bytes')

# ------------------------------------------------------------------ animations
FPS = 30
ANIM_BONES = ['Body', 'Hips', 'Abdomen', 'Torso', 'Chest', 'Neck', 'Head',
              'Shoulder.L', 'UpperArm.L', 'LowerArm.L', 'Wrist.L', 'Shoulder.R', 'UpperArm.R', 'LowerArm.R', 'Wrist.R',
              'UpperLeg.L', 'LowerLeg.L', 'Foot.L', 'UpperLeg.R', 'LowerLeg.R', 'Foot.R']

def node_world_all(g, overrides):
    """World matrices of all nodes; overrides: node index -> (t, r, s) local."""
    from gl import compose
    W = [None] * len(g.nodes)
    def w(i):
        if W[i] is not None: return W[i]
        if i in overrides:
            t, r, s = overrides[i]
            L = compose(t, r, s)
        else:
            L = g.trs(i)
        p = g.parent[i]
        W[i] = L if p < 0 else w(p) @ L
        return W[i]
    for i in range(len(g.nodes)): w(i)
    return W

def retarget(g, anim_name, mapping, pelvis_src, thigh_src, out_name, ground='feet', loop=True, loco=False, trim=None):
    a = [a for a in g.j['animations'] if a['name'] == anim_name][0]
    dur = max(g.j['accessors'][s['input']]['max'][0] for s in a['samplers'])
    n = max(2, int(round(dur * FPS)))
    times = np.arange(n) / FPS if loop else np.linspace(0, dur, n)
    # sample channels
    tr = {}
    for c in a['channels']:
        node = c['target']['node']; path = c['target']['path']
        if path == 'weights': continue
        tr.setdefault(node, {})[path] = sample_channel(g, a['samplers'][c['sampler']], times)
    bw = bind_world(g)
    srcpos = {k: v[:3, 3] for k, v in bw.items()}
    sbind_q = {k: m2q(v[:3, :3] / np.linalg.norm(v[:3, :3], axis=0)) for k, v in bw.items()}
    # Both rigs are bound in the same T-pose, so world rotation deltas transfer
    # as is; matching bone directions would be wrong where joints are placed
    # differently (the modular foot pivots at the sole, the UAL foot at the ankle).
    ratio = TP[JI['UpperLeg.L']][1] / srcpos[thigh_src][1]  # leg length ratio (hip height)
    frames_q = np.zeros((n, len(ANIM_BONES), 4))
    frames_p = np.zeros((n, 3))
    feet = np.zeros((n, 2, 3)); knees = np.zeros((n, 2, 3))
    for f in range(n):
        ov = {}
        for node, ch in tr.items():
            nd = g.nodes[node]
            t = ch['translation'][f] if 'translation' in ch else np.array(nd.get('translation', [0, 0, 0]), float)
            r = ch['rotation'][f] if 'rotation' in ch else np.array(nd.get('rotation', [0, 0, 0, 1]), float)
            s = ch['scale'][f] if 'scale' in ch else np.array(nd.get('scale', [1, 1, 1]), float)
            ov[node] = (t, qnorm(r), s)
        Wn = node_world_all(g, ov)
        Tw = {}
        for nm in JOINTS:
            sb = mapping.get(nm)
            if nm == 'Root':
                Tw[nm] = np.array([0, 0, 0, 1.0]); continue
            if sb is None:
                Tw[nm] = Tw[JOINTS[PARENT[JI[nm]]]]; continue
            M = Wn[g.byname[sb]]
            sq = m2q(M[:3, :3] / np.linalg.norm(M[:3, :3], axis=0))
            Tw[nm] = qnorm(qmul(sq, qinv(sbind_q[sb])))
        for k, nm in enumerate(ANIM_BONES):
            par = JOINTS[PARENT[JI[nm]]]
            q = qnorm(qmul(qinv(Tw[par]), Tw[nm]))
            if q[3] < 0: q = -q
            frames_q[f, k] = q
        pp = Wn[g.byname[pelvis_src]][:3, 3]
        frames_p[f] = TP[JI['Body']] + (pp - srcpos[pelvis_src]) * ratio
        # target FK feet / knees for grounding and speed
        for s, side in enumerate(('.L', '.R')):
            hip = frames_p[f] + qrot(Tw['Body'], TP[JI['UpperLeg' + side]] - TP[JI['Body']])
            knee = hip + qrot(Tw['UpperLeg' + side], TP[JI['LowerLeg' + side]] - TP[JI['UpperLeg' + side]])
            foot = knee + qrot(Tw['LowerLeg' + side], TP[JI['Foot' + side]] - TP[JI['LowerLeg' + side]])
            feet[f, s] = foot; knees[f, s] = knee
    # face forward: remove the clip's mean yaw (measured on the chest) by
    # turning the whole pose (body rotation and position) about the vertical
    yaws = []
    for f in range(n):
        q = frames_q[f, 0]
        for nm in ('Hips', 'Abdomen', 'Torso', 'Chest'):
            q = qmul(q, frames_q[f, ANIM_BONES.index(nm)])
        fwd = qrot(q, np.array([0, 0, 1.0]))
        yaws.append(np.arctan2(fwd[0], fwd[2]))
    yaw = float(np.arctan2(np.mean(np.sin(yaws)), np.mean(np.cos(yaws))))
    if abs(yaw) > 0.02:
        ry = np.array([0, np.sin(-yaw / 2), 0, np.cos(-yaw / 2)])
        for f in range(n):
            frames_q[f, 0] = qnorm(qmul(ry, frames_q[f, 0]))
            frames_p[f] = qrot(ry, frames_p[f])
            for s_ in range(2):
                feet[f, s_] = qrot(ry, feet[f, s_]); knees[f, s_] = qrot(ry, knees[f, s_])
    foot_rest_y = TP[JI['Foot.L']][1]  # ankle height with the sole on the ground
    dy = 0.0
    if ground == 'feet':
        dy = foot_rest_y - feet[:, :, 1].min()
    elif ground == 'knees':
        dy = -min((feet[:, :, 1] - foot_rest_y).min(), (knees[:, :, 1] - 0.07).min())
    frames_p[:, 1] += dy
    feet[:, :, 1] += dy
    speed = 0.0
    if loco:
        # backward speed of a foot while it is flat on the ground (= body speed);
        # with too few flat frames (running) use its sweep over a 40% stance
        vs = []
        for s_ in range(2):
            y = feet[:, s_, 1]; z = feet[:, s_, 2]
            on = y < y.min() + 0.015
            for f in range(n):
                if on[f]:
                    vs.append(-(z[(f + 1) % n] - z[(f - 1) % n]) * FPS / 2)
        if len(vs) >= n * 0.25:
            speed = float(np.median(vs))
        else:
            sweep = np.mean([feet[:, s_, 2].max() - feet[:, s_, 2].min() for s_ in range(2)])
            speed = float(sweep / (0.4 * n / FPS))
    if trim:  # keep a sub-range and make it loop: ease the tail back into the head
        a0, a1 = trim
        frames_q = frames_q[a0:a1].copy(); frames_p = frames_p[a0:a1].copy()
        n = len(frames_q); K = min(12, n // 3)
        for i in range(n - K, n):
            w = (i - (n - K) + 1) / (K + 1)
            w = w * w * (3 - 2 * w)
            for b_ in range(frames_q.shape[1]):
                q0 = frames_q[i, b_]; q1 = frames_q[0, b_]
                if np.dot(q0, q1) < 0: q1 = -q1
                frames_q[i, b_] = qnorm(q0 * (1 - w) + q1 * w)
            frames_p[i] = frames_p[i] * (1 - w) + frames_p[0] * w
    print('  clip %-12s from %-22s frames %3d dur %.2f dy %+.3f yaw %+.2f speed %.2f' % (out_name, anim_name, n, n / FPS, dy, yaw, speed))
    return dict(name=out_name, q=frames_q, p=frames_p, loop=loop, speed=speed)

MOD_MAP = {n: n for n in JOINTS if not any(n.startswith(f) for f in FINGERS + ['Thumb'])}
ANIM_MAP = {v: k for k, v in UAL_MAP.items()}  # our joint -> UAL bone

clips = []
clips.append(retarget(ref, 'Idle', MOD_MAP, 'Body', 'UpperLeg.L', 'idle_m'))
clips.append(retarget(ref, 'Idle_Neutral', MOD_MAP, 'Body', 'UpperLeg.L', 'idle_n'))
clips.append(retarget(ref, 'Walk', MOD_MAP, 'Body', 'UpperLeg.L', 'walk_m', loco=True))
U = [('Idle_Loop', 'idle_u', 'feet', False), ('Idle_Talking_Loop', 'talk', 'feet', False),
     ('Sitting_Idle_Loop', 'sit', 'feet', False), ('Sitting_Talking_Loop', 'sit_talk', 'feet', False),
     ('Driving_Loop', 'drive', 'feet', False), ('Fixing_Kneeling', 'kneel', 'knees', False, (24, 122)),
     ('Walk_Loop', 'walk_u', 'feet', True), ('Walk_Formal_Loop', 'walk_formal', 'feet', True),
     ('Jog_Fwd_Loop', 'jog', 'feet', True), ('Dance_Loop', 'dance', 'feet', False)]
for src, name, ground, loco, *rest in U:
    clips.append(retarget(gu, src, ANIM_MAP, 'DEF-hips', 'DEF-thigh.L', name, ground=ground, loco=loco, trim=rest[0] if rest else None))

# binary: 'PANM' u32 version, u32 jsonLen, json, pad4, then int16 data
data = bytearray()
meta = {'fps': FPS, 'bones': ANIM_BONES, 'joints': JOINTS, 'parents': PARENT, 'clips': []}
for c in clips:
    n = len(c['q'])
    off = len(data) // 2
    arr = np.zeros((n, 3 + len(ANIM_BONES) * 4), dtype=np.int16)
    arr[:, :3] = np.clip(np.round(c['p'] * 8192), -32767, 32767)
    arr[:, 3:] = np.clip(np.round(c['q'].reshape(n, -1) * 32767), -32767, 32767)
    data += arr.tobytes()
    meta['clips'].append({'name': c['name'], 'frames': n, 'offset': off, 'loop': c['loop'], 'speed': round(c['speed'], 4)})
mj = json.dumps(meta, separators=(',', ':')).encode()
mj += b' ' * ((4 - (12 + len(mj)) % 4) % 4)
blob = b'PANM' + struct.pack('<II', 1, len(mj)) + mj + bytes(data)
open(os.path.join(OUT, 'people-anim.bin'), 'wb').write(blob)
print('people-anim.bin', len(blob), 'bytes')
