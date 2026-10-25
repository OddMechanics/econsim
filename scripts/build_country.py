"""Build public/models/country/country.glb: the countryside's props as one
small GLB of vertex-colored meshes, from CC0 packs (see LICENSE.txt).

Each model becomes one mesh (no node transforms): un-indexed flat triangles
with POSITION, NORMAL and COLOR_0 (linear RGB, normalized ubyte), scaled to
meters, standing on y = 0, facing +Z (glTF space). Colors come from the
Kenney colormap texture (sampled at each triangle's UV centroid), from the
materials' base colors, or from the OBJ materials' Kd.

usage: python3 -I build_country.py <kenney_car_kit_dir> <kenney_nature_kit_dir> <quaternius_farm_animals_dir> <out.glb>
  (the unzipped downloads: "Car Kit", "Nature Kit", "Farm Animals by @Quaternius")
"""
import json, os, struct, sys
import numpy as np
from PIL import Image

CAR, NATURE, ANIMALS, OUT = sys.argv[1:5]

CT = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def quat_mat(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def node_matrix(n):
    m = np.eye(4)
    if 'matrix' in n:
        return np.array(n['matrix']).reshape(4, 4).T
    s = np.diag(n.get('scale', [1, 1, 1]) + [1])
    r = np.eye(4)
    r[:3, :3] = quat_mat(n.get('rotation', [0, 0, 0, 1]))
    t = np.eye(4)
    t[:3, 3] = n.get('translation', [0, 0, 0])
    return t @ r @ s @ m


def read_glb(path):
    """Triangles (n, 3, 3) and linear colors (n, 3) of every mesh in a GLB, in its scene's space."""
    b = open(path, 'rb').read()
    jl = struct.unpack_from('<I', b, 12)[0]
    j = json.loads(b[20:20 + jl])
    off = 20 + jl
    bl = struct.unpack_from('<I', b, off)[0]
    buf = b[off + 8: off + 8 + bl]
    texture = None
    if j.get('images'):
        texture = np.asarray(Image.open(os.path.join(os.path.dirname(path), j['images'][0]['uri'])).convert('RGB'), dtype=np.float64) / 255

    def acc(i):
        a = j['accessors'][i]
        bv = j['bufferViews'][a['bufferView']]
        dt, nc = CT[a['componentType']], NCOMP[a['type']]
        o = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = bv.get('byteStride', 0) or np.dtype(dt).itemsize * nc
        raw = np.frombuffer(buf, dtype=np.uint8, count=stride * (a['count'] - 1) + np.dtype(dt).itemsize * nc, offset=o)
        out = np.stack([np.frombuffer(raw[k * stride: k * stride + np.dtype(dt).itemsize * nc].tobytes(), dtype=dt) for k in range(a['count'])])
        return out.astype(np.float64) if dt == np.float32 else out.astype(np.int64)

    parent = {}
    for i, n in enumerate(j['nodes']):
        for c in n.get('children', []):
            parent[c] = i

    def world(i):
        m = node_matrix(j['nodes'][i])
        while i in parent:
            i = parent[i]
            m = node_matrix(j['nodes'][i]) @ m
        return m

    tris, cols = [], []
    for ni, n in enumerate(j['nodes']):
        if 'mesh' not in n:
            continue
        w = world(ni)
        for p in j['meshes'][n['mesh']]['primitives']:
            pos = acc(p['attributes']['POSITION'])
            pos = (w[:3, :3] @ pos.T).T + w[:3, 3]
            idx = acc(p['indices']).reshape(-1, 3)
            t = pos[idx]
            mat = j['materials'][p['material']] if 'material' in p else {}
            pbr = mat.get('pbrMetallicRoughness', {})
            if texture is not None and 'TEXCOORD_0' in p['attributes'] and 'baseColorTexture' in pbr:
                uv = acc(p['attributes']['TEXCOORD_0'])[idx].mean(axis=1)
                h, wd = texture.shape[:2]
                px = np.clip((uv[:, 0] % 1) * wd, 0, wd - 1).astype(int)
                py = np.clip((uv[:, 1] % 1) * h, 0, h - 1).astype(int)
                c = srgb_to_linear(texture[py, px])
            else:
                c = np.tile(np.array(pbr.get('baseColorFactor', [1, 1, 1, 1])[:3]), (len(t), 1))
            tris.append(t)
            cols.append(c)
    return np.concatenate(tris), np.concatenate(cols)


def read_obj(path):
    """Triangles and linear colors (the materials' Kd) of an OBJ."""
    mtl, kd, cur = {}, None, None
    verts, tris, cols = [], [], []
    d = os.path.dirname(path)
    for line in open(path):
        sp = line.split()
        if not sp:
            continue
        if sp[0] == 'mtllib':
            name = None
            for ml in open(os.path.join(d, sp[1])):
                ms = ml.split()
                if ms and ms[0] == 'newmtl':
                    name = ms[1]
                elif ms and ms[0] == 'Kd':
                    mtl[name] = [float(x) for x in ms[1:4]]
        elif sp[0] == 'v':
            verts.append([float(x) for x in sp[1:4]])
        elif sp[0] == 'usemtl':
            cur = mtl.get(sp[1], [1, 1, 1])
        elif sp[0] == 'f':
            ids = [int(x.split('/')[0]) - 1 for x in sp[1:]]
            for k in range(1, len(ids) - 1):
                tris.append([verts[ids[0]], verts[ids[k]], verts[ids[k + 1]]])
                cols.append(cur)
    return np.array(tris, dtype=np.float64), np.array(cols, dtype=np.float64)


def normalize(t, length=None, axis=2, scale=None):
    """Stand on y = 0, centered in x/z, scaled so its extent along `axis` is `length` (or by `scale` per axis)."""
    p = t.reshape(-1, 3)
    mn, mx = p.min(0), p.max(0)
    c = (mn + mx) / 2
    t = t - np.array([c[0], mn[1], c[2]])
    if scale is not None:
        return t * np.array(scale)
    return t * (length / (mx[axis] - mn[axis]))


models = {}
# farm animals (Quaternius): face +Z already
t, c = read_obj(os.path.join(ANIMALS, 'OBJ', 'Cow.obj'))
models['cow'] = (normalize(t, 2.4), c)
t, c = read_obj(os.path.join(ANIMALS, 'OBJ', 'Sheep.obj'))
models['sheep'] = (normalize(t, 1.3), c)
# vehicles (Kenney Car Kit): face +Z
t, c = read_glb(os.path.join(CAR, 'Models', 'GLB format', 'tractor.glb'))
models['tractor'] = (normalize(t, 3.9), c)
t, c = read_glb(os.path.join(CAR, 'Models', 'GLB format', 'ambulance.glb'))
models['ambulance'] = (normalize(t, 5.4), c)
# a fence section (Kenney Nature Kit): 1 unit long along x -> 3 m long, 1.1 m high
t, c = read_glb(os.path.join(NATURE, 'Models', 'GLTF format', 'fence_simple.glb'))
p = t.reshape(-1, 3)
models['fence'] = (normalize(t, scale=[3.0 / (p[:, 0].max() - p[:, 0].min()), 1.1 / (p[:, 1].max() - p[:, 1].min()), 3.0]), c)

# a hedge bush (Kenney Nature Kit plant_bushLarge), recolored from the kit's mint green to a hedge green, ~2.2 m wide
t, c = read_glb(os.path.join(NATURE, 'Models', 'GLTF format', 'plant_bushLarge.glb'))
p = t.reshape(-1, 3)
shade = c.mean(axis=1, keepdims=True) / max(1e-6, c.mean())  # (keeps the model's own light and dark parts)
c = np.clip(shade * srgb_to_linear(np.array([0x4c, 0x7a, 0x38]) / 255), 0, 1)
models['hedge'] = (normalize(t, 2.2, axis=0), c)

# ---- write the GLB
bin_parts, views, accessors, meshes = [], [], [], []
off = 0


def add(data, target, comp, typ, count, normalized=False, mn=None, mx=None):
    global off
    raw = data.tobytes()
    pad = (-len(raw)) % 4
    bin_parts.append(raw + b'\0' * pad)
    views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(raw), 'target': target})
    off += len(raw) + pad
    a = {'bufferView': len(views) - 1, 'componentType': comp, 'count': count, 'type': typ}
    if normalized:
        a['normalized'] = True
    if mn is not None:
        a['min'], a['max'] = mn, mx
    accessors.append(a)
    return len(accessors) - 1


for name, (t, c) in models.items():
    n = len(t)
    pos = t.reshape(-1, 3).astype(np.float32)
    e1, e2 = t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]
    nr = np.cross(e1, e2)
    nr /= np.maximum(1e-12, np.linalg.norm(nr, axis=1, keepdims=True))
    nrm = np.repeat(nr, 3, axis=0).astype(np.float32)
    col = np.concatenate([np.repeat(np.clip(c, 0, 1), 3, axis=0), np.ones((n * 3, 1))], axis=1)
    col = np.round(col * 255).astype(np.uint8)
    ap = add(pos, 34962, 5126, 'VEC3', n * 3, mn=pos.min(0).tolist(), mx=pos.max(0).tolist())
    an = add(nrm, 34962, 5126, 'VEC3', n * 3)
    ac = add(col, 34962, 5121, 'VEC4', n * 3, normalized=True)
    meshes.append({'name': name, 'primitives': [{'attributes': {'POSITION': ap, 'NORMAL': an, 'COLOR_0': ac}}]})
    print(f'{name}: {n} triangles, size {np.round(pos.max(0) - pos.min(0), 2).tolist()} m')

gltf = {
    'asset': {'version': '2.0', 'generator': 'econsim build_country.py'},
    'scene': 0, 'scenes': [{'nodes': list(range(len(meshes)))}],
    'nodes': [{'mesh': i, 'name': m['name']} for i, m in enumerate(meshes)],
    'meshes': meshes, 'accessors': accessors, 'bufferViews': views,
    'buffers': [{'byteLength': off}],
}
js = json.dumps(gltf, separators=(',', ':')).encode()
js += b' ' * ((-len(js)) % 4)
binb = b''.join(bin_parts)
with open(OUT, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binb)))
    f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
    f.write(struct.pack('<II', len(binb), 0x004E4942) + binb)
print('wrote', OUT, 12 + 8 + len(js) + 8 + len(binb), 'bytes')
