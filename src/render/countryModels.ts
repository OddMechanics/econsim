// The countryside's ready-made models (public/models/country/country.glb):
// a dairy cow and a sheep (Quaternius, CC0), a tractor and an ambulance
// (Kenney Car Kit, CC0), a rail fence section and a hedge bush (Kenney
// Nature Kit, CC0);
// see LICENSE.txt there. They're loaded once, in the background, and handed
// out as vertex data in the scene's (left-handed) space with display colors,
// for thin-instanced meshes. Until they arrive, nothing that needs them is
// drawn.

import { LoadAssetContainerAsync, Mesh, VertexBuffer, VertexData, type Scene } from '@babylonjs/core';

export type CountryModel = 'cow' | 'sheep' | 'tractor' | 'ambulance' | 'fence' | 'hedge';

const viteEnv = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
const URL = (viteEnv?.BASE_URL ?? '/') + 'models/country/country.glb';

let loading: Promise<Map<string, VertexData>> | null = null;

/** Linear (glTF) color to the display values our materials use. */
const toDisplay = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

async function load(scene: Scene): Promise<Map<string, VertexData>> {
  await import('@babylonjs/loaders/glTF');
  const container = await LoadAssetContainerAsync(URL, scene);
  const out = new Map<string, VertexData>();
  for (const m of container.meshes) {
    if (!(m instanceof Mesh) || !m.getTotalVertices()) continue;
    const pos = Float32Array.from(m.getVerticesData(VertexBuffer.PositionKind)!);
    const nrm = Float32Array.from(m.getVerticesData(VertexBuffer.NormalKind)!);
    const col = Float32Array.from(m.getVerticesData(VertexBuffer.ColorKind)!);
    const n = pos.length / 3;
    // glTF is right-handed: mirror x (the loader would do it with a root node) and keep the faces' winding outward
    for (let i = 0; i < n; i++) { pos[i * 3] = -pos[i * 3]; nrm[i * 3] = -nrm[i * 3]; }
    for (let i = 0; i < col.length; i++) if (i % 4 !== 3) col[i] = toDisplay(col[i]);
    const idx = new Uint32Array(n);
    for (let t = 0; t < n; t += 3) { idx[t] = t; idx[t + 1] = t + 2; idx[t + 2] = t + 1; }
    const vd = new VertexData();
    vd.positions = pos;
    vd.normals = nrm;
    vd.colors = col;
    vd.indices = idx;
    out.set(m.name, vd);
  }
  container.dispose();
  return out;
}

/** The models (loaded on first call; later calls share the same promise). */
export function countryModels(scene: Scene): Promise<Map<string, VertexData>> {
  loading ??= load(scene).catch((e) => {
    console.warn('country models failed to load', e);
    return new Map<string, VertexData>();
  });
  return loading;
}

/** A hidden template mesh for thin instances of a model. */
export function modelMesh(scene: Scene, vd: VertexData, name: string): Mesh {
  const m = new Mesh(name, scene);
  vd.applyToMesh(m);
  m.isPickable = false;
  m.isVisible = false;
  return m;
}
