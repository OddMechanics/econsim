"""Tiny glTF reader + quaternion/matrix helpers (numpy)."""
import json, struct, os
import numpy as np

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

class Gltf:
    def __init__(self, path):
        if path.endswith('.glb'):
            b = open(path, 'rb').read()
            jl = struct.unpack_from('<I', b, 12)[0]
            self.j = json.loads(b[20:20 + jl])
            off = 20 + jl
            bl = struct.unpack_from('<I', b, off)[0]
            self.bufs = [b[off + 8: off + 8 + bl]]
        else:
            self.j = json.load(open(path))
            d = os.path.dirname(path)
            self.bufs = []
            for bf in self.j['buffers']:
                u = bf['uri']
                if u.startswith('data:'):
                    import base64
                    self.bufs.append(base64.b64decode(u.split(',', 1)[1]))
                else:
                    self.bufs.append(open(os.path.join(d, u), 'rb').read())
        self.nodes = self.j['nodes']
        self.parent = [-1] * len(self.nodes)
        for i, n in enumerate(self.nodes):
            for c in n.get('children', []):
                self.parent[c] = i
        self.byname = {n.get('name'): i for i, n in enumerate(self.nodes)}

    def acc(self, i):
        a = self.j['accessors'][i]
        bv = self.j['bufferViews'][a['bufferView']]
        dt = CT[a['componentType']]
        nc = NC[a['type']]
        buf = self.bufs[bv['buffer']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = bv.get('byteStride', 0)
        isz = np.dtype(dt).itemsize * nc
        if stride and stride != isz:
            raw = np.frombuffer(buf, dtype=np.uint8, count=stride * (a['count'] - 1) + isz, offset=off)
            out = np.empty((a['count'], nc), dtype=dt)
            for k in range(a['count']):
                out[k] = np.frombuffer(raw[k * stride: k * stride + isz].tobytes(), dtype=dt)
        else:
            out = np.frombuffer(buf, dtype=dt, count=a['count'] * nc, offset=off).reshape(a['count'], nc)
        out = out.astype(np.float64) if dt == np.float32 else out
        if a.get('normalized'):
            if dt == np.uint8: out = out / 255.0
            elif dt == np.uint16: out = out / 65535.0
            elif dt == np.int8: out = np.maximum(out / 127.0, -1)
            elif dt == np.int16: out = np.maximum(out / 32767.0, -1)
        return out

    def trs(self, i):
        n = self.nodes[i]
        if 'matrix' in n:
            m = np.array(n['matrix']).reshape(4, 4).T
            return m
        t = n.get('translation', [0, 0, 0]); r = n.get('rotation', [0, 0, 0, 1]); s = n.get('scale', [1, 1, 1])
        return compose(np.array(t), np.array(r), np.array(s))

    def world(self, i):
        m = self.trs(i)
        p = self.parent[i]
        while p >= 0:
            m = self.trs(p) @ m
            p = self.parent[p]
        return m

# ---- quaternion (x, y, z, w) helpers
def qmul(a, b):
    ax, ay, az, aw = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    bx, by, bz, bw = b[..., 0], b[..., 1], b[..., 2], b[..., 3]
    return np.stack([
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz], axis=-1)
def qinv(q):
    return q * np.array([-1, -1, -1, 1.0])
def qnorm(q):
    return q / np.linalg.norm(q, axis=-1, keepdims=True)
def qrot(q, v):
    qv = np.concatenate([v, np.zeros(v.shape[:-1] + (1,))], axis=-1)
    return qmul(qmul(q, qv), qinv(q))[..., :3]
def q2m(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
def m2q(m):
    m = np.asarray(m, dtype=np.float64)
    t = m[0, 0] + m[1, 1] + m[2, 2]
    if t > 0:
        s = np.sqrt(t + 1.0) * 2
        q = [(m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s, 0.25 * s]
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = np.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        q = [0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s, (m[2, 1] - m[1, 2]) / s]
    elif m[1, 1] > m[2, 2]:
        s = np.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        q = [(m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s, (m[0, 2] - m[2, 0]) / s]
    else:
        s = np.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        q = [(m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s, (m[1, 0] - m[0, 1]) / s]
    q = np.array(q)
    return q / np.linalg.norm(q)
def compose(t, r, s):
    m = np.eye(4)
    m[:3, :3] = q2m(r) * np.asarray(s)[None, :]
    m[:3, 3] = t
    return m
def decompose(m):
    t = m[:3, 3].copy()
    s = np.linalg.norm(m[:3, :3], axis=0)
    r = m2q(m[:3, :3] / s[None, :])
    return t, r, s
def slerp(a, b, u):
    d = np.dot(a, b)
    if d < 0: b = -b; d = -d
    if d > 0.9995:
        return qnorm(a + (b - a) * u)
    th = np.arccos(d)
    return (np.sin((1 - u) * th) * a + np.sin(u * th) * b) / np.sin(th)
def q_between(u, v):
    """Minimal rotation taking unit vector u to unit vector v."""
    u = u / np.linalg.norm(u); v = v / np.linalg.norm(v)
    d = np.dot(u, v)
    if d < -0.999999:
        ax = np.cross([1, 0, 0], u)
        if np.linalg.norm(ax) < 1e-6: ax = np.cross([0, 1, 0], u)
        ax /= np.linalg.norm(ax)
        return np.array([ax[0], ax[1], ax[2], 0.0])
    c = np.cross(u, v)
    q = np.array([c[0], c[1], c[2], 1 + d])
    return q / np.linalg.norm(q)

def sample_channel(g, sampler, t):
    """Sample a glTF animation sampler at times t (array). Returns (len(t), n)."""
    ti = g.acc(sampler['input'])[:, 0]
    vo = g.acc(sampler['output'])
    interp = sampler.get('interpolation', 'LINEAR')
    if interp == 'CUBICSPLINE':
        vo = vo.reshape(len(ti), 3, -1)[:, 1, :]
    out = np.empty((len(t), vo.shape[1]))
    for k, tt in enumerate(t):
        if tt <= ti[0]: out[k] = vo[0]; continue
        if tt >= ti[-1]: out[k] = vo[-1]; continue
        i = np.searchsorted(ti, tt) - 1
        u = (tt - ti[i]) / (ti[i + 1] - ti[i])
        if interp == 'STEP': out[k] = vo[i]
        elif vo.shape[1] == 4: out[k] = slerp(vo[i], vo[i + 1], u)
        else: out[k] = vo[i] * (1 - u) + vo[i + 1] * u
    return out
