// The 3D view: owns the Babylon scene and camera, lights it by the time of
// day, and every frame turns the simulation state into what the specialised
// renderers draw (terrain, roads, buildings, people, vehicles). It also
// handles picking, the selection, speech bubbles and name tags.

import {
  ArcRotateCamera, Color3, Color4, DirectionalLight, Engine, GlowLayer, HemisphericLight, LinesMesh, Matrix, Mesh, MeshBuilder,
  PointerEventTypes, Scene, ShadowGenerator, StandardMaterial, Vector3, VertexData,
} from '@babylonjs/core';
import { POLITICS } from '../sim/config';
import { TERRITORY_COLS, cellCenter } from '../sim/government';
import type { Role } from '../sim/types';
import { MINUTES_PER_DAY } from '../sim/config';
import { BUILDINGS, invWeight } from '../sim/goods';
import { FLOOR_H, stationsOf } from '../sim/layout';
import type { Simulation } from '../sim/sim';
import type { Building, Person } from '../sim/types';
import { GATE } from '../sim/types';
import { heightAt, inGrid } from '../sim/world';
import { BuildingRenderer, standHeight, type BuildingLook } from './buildings';
import { AdRenderer } from './ads';
import { clothColor } from './palette';
import { PeopleRenderer, type PersonVisual } from './people';
import { ROAD_SURFACE, RoadRenderer } from './roads';
import { TerrainRenderer } from './terrain';
import { CountryNature } from './countryNature';
import { FieldRenderer } from './fields';
import { drapedLot } from './farmLayout';
import { VehicleRenderer, type VehicleVisual } from './vehicles';
import { CameraController, type CameraMode, type Subject } from './camera';

export type Selection = { type: 'person' | 'building' | 'firm'; id: number } | null;

/** A person's signature color (their shirt), used in the UI too. */
export function personColor(p: Person): Color3 {
  return clothColor(p.looks.shirt, 0);
}

const SEATED = new Set(['sit', 'type', 'eat', 'drive', 'watch']);
/** Poses that count as working (the cinema director favors medium close-ups). */
const WORK_POSES = new Set(['type', 'manual', 'cook', 'serve', 'build', 'gather', 'carry']);

export class WorldRenderer {
  engine: Engine;
  scene: Scene;
  camera: ArcRotateCamera;
  /** Keyboard / follow / cinema / street-level camera (owns `camera`). */
  cam: CameraController;
  /** The camera mode changed (e.g. the user panned away from a follow): update Follow/Cinema buttons. */
  onCameraMode: (mode: CameraMode, reason: string) => void = () => {};
  ownership = false;
  /** Show city limits and electoral districts on the ground. */
  politicsMap = false;
  /** Draw people and vehicles (off = buildings only, for speed). */
  showMovers = true;
  /** A government being inspected: its borders are shown as a glowing wall along the limits (polity id, -1 = none). */
  inspectedPolity = -1;
  private borderWall: Mesh | null = null;
  private borderKey = '';
  private mapLines: LinesMesh | null = null;
  private mapKey = '';
  /** Following the selected person (the follow or the cinema camera). */
  get follow(): boolean { return this.cam.mode === 'follow' || this.cam.mode === 'cinema'; }
  set follow(v: boolean) { this.cam.setMode(v ? 'follow' : 'free'); }
  selection: Selection = null;
  /** The building shown opened up (selected, or where the followed person is). */
  cutaway: number | null = null;
  onPick: (sel: Selection) => void = () => {};

  private sun: DirectionalLight;
  private hemi: HemisphericLight;
  private shadows: ShadowGenerator;
  private glow: GlowLayer;
  private terrain: TerrainRenderer;
  /** Trees and boulders out in the countryside. */
  private country: CountryNature;
  /** Crops, pastures, fences, herds and tractors on the countryside's farms. */
  private fields: FieldRenderer;
  private roads: RoadRenderer;
  private buildings: BuildingRenderer;
  private ads: AdRenderer;
  private people: PeopleRenderer;
  private vehicles: VehicleRenderer;
  private ring: Mesh;
  private label: HTMLDivElement;
  private bubbles: HTMLDivElement;
  private bubblePool: HTMLDivElement[] = [];
  private clock = { nature: 0, roads: 0, fields: 99 };
  private natureVer = -1;
  private personVisuals: PersonVisual[] = [];
  private vehicleVisuals: VehicleVisual[] = [];
  nightLevel = 0;
  /** Height of the drawn ground at a point (for buildings standing on unleveled countryside ground). */
  private readonly groundFn = (x: number, y: number): number => this.terrain.groundY(x, y);
  /** Smoothed milliseconds per frame spent in each part (for tuning; see window.__econsim). */
  perf: Record<string, number> = {};

  constructor(canvas: HTMLCanvasElement, private sim: Simulation) {
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, antialias: true });
    this.engine.setHardwareScalingLevel(1 / Math.min(2, window.devicePixelRatio || 1));
    const scene = new Scene(this.engine);
    this.scene = scene;
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.00055;

    // the camera controller creates the ArcRotateCamera (same limits as before) and handles keys
    this.cam = new CameraController(scene, canvas, {
      heightAt: (x, y) => heightAt(this.sim.state.world, x, y),
      // building meshes; the opened-up building's walls are separate '-ghost' meshes, its slabs and furniture do occlude
      isOccluder: (m) => (m.metadata as { kind?: string } | null)?.kind === 'building' && !m.name.endsWith('-ghost'),
    });
    this.camera = this.cam.camera;
    this.cam.onModeChange = (mode, _prev, reason) => this.onCameraMode(mode, reason);

    this.hemi = new HemisphericLight('sky', new Vector3(0.2, 1, 0.1), scene);
    this.hemi.groundColor = Color3.FromHexString('#4a4a3a');
    this.sun = new DirectionalLight('sun', new Vector3(-0.5, -1, -0.35), scene);
    this.sun.autoUpdateExtends = false;
    this.shadows = new ShadowGenerator(2048, this.sun);
    this.shadows.usePercentageCloserFiltering = true;
    this.shadows.filteringQuality = ShadowGenerator.QUALITY_LOW;
    this.shadows.getShadowMap()!.refreshRate = 2; // every other frame is plenty
    this.shadows.bias = 0.0008;
    this.shadows.normalBias = 0.06;
    this.glow = new GlowLayer('glow', scene, { mainTextureRatio: 0.5 });
    this.glow.intensity = 0;

    this.terrain = new TerrainRenderer(scene, this.shadows, sim.state.world);
    this.country = new CountryNature(scene, this.shadows, (x, y) => this.terrain.groundY(x, y), (x, y) => this.terrain.natureKind(x, y));
    this.country.setWorld(sim.state.world, this.terrain.noiseSeed);
    this.fields = new FieldRenderer(scene, this.shadows);
    this.roads = new RoadRenderer(scene, this.shadows);
    this.buildings = new BuildingRenderer(scene, this.shadows);
    this.ads = this.makeAds();
    this.people = new PeopleRenderer(scene, this.shadows);
    this.vehicles = new VehicleRenderer(scene, this.shadows);
    this.glow.addExcludedMesh(this.vehicles.coneMesh);

    this.ring = MeshBuilder.CreateTorus('selRing', { diameter: 1, thickness: 0.06, tessellation: 40 }, scene);
    const ringMat = new StandardMaterial('selRingMat', scene);
    ringMat.emissiveColor = Color3.FromHexString('#ffd34d');
    ringMat.disableLighting = true;
    this.ring.material = ringMat;
    this.ring.isPickable = false;
    this.ring.setEnabled(false);

    this.label = document.createElement('div');
    this.label.className = 'name-tag';
    document.body.appendChild(this.label);
    this.bubbles = document.createElement('div');
    this.bubbles.className = 'bubbles';
    document.body.appendChild(this.bubbles);

    this.focusOnSquare();
    this.setupInput();
    window.addEventListener('resize', () => this.engine.resize());
  }

  private makeAds(): AdRenderer {
    const ads = new AdRenderer(this.scene, this.shadows);
    // wall ads sit on their building's own ground (on slopes)
    ads.groundOf = (id) => { const b = this.sim.ctx.bById.get(id); return b ? heightAt(this.sim.state.world, b.x, b.y) : undefined; };
    // who rents out an ad space: ad companies get an owner plate, empty spaces say whom to call
    ads.ownerInfo = (id) => {
      const f = this.sim.ctx.fById.get(id);
      if (f) return { name: f.name, hue: f.hue, adco: f.kind === 'adco' };
      const p = this.sim.ctx.byId.get(id);
      return p ? { name: p.name } : null;
    };
    return ads;
  }

  /** Swap in a different simulation (new world or loaded save). */
  setSim(sim: Simulation): void {
    this.sim = sim;
    this.selection = null;
    this.cutaway = null;
    this.terrain.setWorld(sim.state.world);
    this.country.setWorld(sim.state.world, this.terrain.noiseSeed);
    this.clock.fields = 99;
    this.roads.dispose();
    this.roads = new RoadRenderer(this.scene, this.shadows);
    this.buildings.dispose();
    this.buildings = new BuildingRenderer(this.scene, this.shadows);
    this.ads.dispose();
    this.ads = this.makeAds();
    this.natureVer = -1;
    this.cam.setMode('free');
    this.focusOnSquare();
  }

  private focusOnSquare(): void {
    const c = this.sim.state.center;
    if (c) this.focusOn(c.x, c.y, 260);
  }

  /** Look at sim (x, y). While following only the zoom applies; `smooth` glides there. */
  focusOn(x: number, y: number, radius?: number, smooth = false): void {
    this.cam.focusOn(x, y, heightAt(this.sim.state.world, x, y), radius, smooth);
  }

  // ------------------------------------------------------------ per frame

  render(alpha: number, dtReal: number, gameSecondsPerSecond: number): void {
    const s = this.sim.state;
    const time = performance.now() / 1000;
    this.clock.nature += dtReal;
    this.clock.roads += dtReal;
    const perf = this.perf;
    let t = performance.now();
    const mark = (k: string) => { const n = performance.now(); perf[k] = (perf[k] ?? 0) * 0.9 + (n - t) * 0.1; t = n; };
    this.updateLighting(s.tick + alpha);
    if (s.world.ver !== this.natureVer && this.clock.nature > 2) {
      this.natureVer = s.world.ver;
      this.clock.nature = 0;
      this.terrain.updateNature(s.world);
    }
    if ((this.clock.fields += dtReal) > 3) {
      this.clock.fields = 0;
      this.country.sync(s.roads, this.sim.ctx.nodeById, s.roads.lots);
      this.fields.sync(s.buildings, this.sim.ctx.lotById, this.terrain.surface, s.world);
    }
    this.fields.update(this.camera.position);
    // (the shadow map covers this far around the camera's target; see updateLighting)
    const shadowR = this.scene.shadowsEnabled ? this.sun.shadowFrustumSize * 0.75 : 0;
    this.country.update(this.camera.position, this.camera.target, shadowR);
    this.terrain.updateView(this.camera.position, this.camera.target, shadowR);
    mark('nature');
    if (this.clock.roads > 0.5) {
      this.clock.roads = 0;
      this.roads.sync(s.roads, this.sim.ctx.nodeById, this.sim.ctx.edgeById, s.world);
    }
    mark('roads');
    this.buildings.setNight(this.nightLevel);
    this.buildings.setHour(((s.tick + alpha) % MINUTES_PER_DAY) / 60); // flats and offices light up and go dark by the hour
    this.roads.setNight(this.nightLevel);
    this.updateCutaway();
    this.updatePoliticsMap();
    this.buildings.sync(s.buildings, (b) => this.lookOf(b));
    this.ads.setNight(this.nightLevel);
    this.ads.sync(s.ads, s.world, this.camera.position.x, this.camera.position.z);
    mark('buildings');
    this.updatePeople(alpha, time);
    mark('people');
    this.updateVehicles(alpha, time, gameSecondsPerSecond);
    this.cam.update(dtReal, this.cameraSubject(alpha));
    this.updateSelection(alpha);
    mark('misc');
    this.scene.render();
    mark('draw');
    this.updateBubbles();
  }

  private lookOf(b: Building): BuildingLook {
    const ctx = this.sim.ctx;
    const lot = ctx.lotById.get(b.lot);
    const firm = ctx.fById.get(b.firm);
    const gov = ctx.govOfFirm.get(b.owner);
    let ownerColor: Color3 | null = null;
    if (this.ownership) {
      const p = ctx.byId.get(b.owner) ?? ctx.byId.get(ctx.fById.get(b.owner)?.owner ?? -1);
      if (p) ownerColor = personColor(p);
      else if (gov) ownerColor = Color3.FromHSV(gov.hue * 360, 0.5, 0.95);
    }
    // what the sign says: the company, the government, the channel or the website
    const name = b.kind === 'cityhall' && gov ? gov.name
      : firm?.channel ? firm.channel.name : firm?.site ? firm.site.name : firm?.name;
    const lotZ = lot ? (lot.x - b.x) * Math.cos(b.angle) + (lot.y - b.y) * Math.sin(b.angle) : 0;
    const draped = !!lot && drapedLot(b.kind, lot.w, lot.d, !inGrid(this.sim.state.world, lot.x, lot.y));
    return {
      lotW: lot?.w ?? b.w + 4,
      lotD: lot?.d ?? b.d + 4,
      lotZ, draped, terrain: draped ? this.groundFn : undefined,
      ground: heightAt(this.sim.state.world, b.x, b.y),
      firmName: name,
      firmHue: gov ? gov.hue : firm?.site ? firm.site.color : firm?.hue,
      ownerColor,
      ...({ live: !!firm?.channel && firm.channel.onAir >= 0 } as object),
    };
  }

  /**
   * The inspected government's borders: a translucent wall in its flag
   * colour along the city limits (visible from any distance), fading upward.
   */
  private updateBorderWall(): void {
    const s = this.sim.state;
    const g = this.sim.ctx.gById.get(this.inspectedPolity);
    const key = g && g.status !== 'gone' ? `${g.id}:${g.cells.length}:${g.hue}` : '';
    if (key === this.borderKey) return;
    this.borderKey = key;
    this.borderWall?.dispose();
    this.borderWall = null;
    if (!g || g.status === 'gone') return;
    const w = s.world;
    const half = POLITICS.cell / 2;
    const inside = new Set(g.cells);
    const col = Color3.FromHSV(g.hue * 360, 0.75, 1);
    const positions: number[] = [], colors: number[] = [], indices: number[] = [];
    const H = 26;
    const wall = (ax: number, ay: number, bx: number, by: number) => {
      const n = positions.length / 3;
      const ha = heightAt(w, ax, ay) - 0.5, hb = heightAt(w, bx, by) - 0.5;
      positions.push(ax, ha, ay, bx, hb, by, bx, hb + H, by, ax, ha + H, ay);
      colors.push(col.r, col.g, col.b, 0.8, col.r, col.g, col.b, 0.8, col.r, col.g, col.b, 0, col.r, col.g, col.b, 0);
      indices.push(n, n + 1, n + 2, n, n + 2, n + 3);
    };
    // a light tint over the whole territory (following the ground in 25 m steps)
    const tint = (x0: number, y0: number, x1: number, y1: number) => {
      const n = positions.length / 3;
      for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) {
        positions.push(x, heightAt(w, x, y) + 1.2, y);
        colors.push(col.r, col.g, col.b, 0.13);
      }
      indices.push(n, n + 1, n + 2, n, n + 2, n + 3);
    };
    for (const c of g.cells) {
      const [x, y] = cellCenter(c);
      const cx = c % TERRITORY_COLS, cy = Math.floor(c / TERRITORY_COLS);
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) tint(x - half + i * half, y - half + j * half, x + i * half, y + j * half);
      if (!inside.has(cy * TERRITORY_COLS + cx + 1)) wall(x + half, y - half, x + half, y + half);
      if (!inside.has(cy * TERRITORY_COLS + cx - 1)) wall(x - half, y - half, x - half, y + half);
      if (!inside.has((cy + 1) * TERRITORY_COLS + cx)) wall(x - half, y + half, x + half, y + half);
      if (!inside.has((cy - 1) * TERRITORY_COLS + cx)) wall(x - half, y - half, x + half, y - half);
    }
    if (!indices.length) return;
    const mesh = new Mesh('borderWall', this.scene);
    const data = new VertexData();
    data.positions = positions;
    data.colors = colors;
    data.indices = indices;
    data.applyToMesh(mesh);
    const mat = new StandardMaterial('borderWallMat', this.scene);
    mat.disableLighting = true;
    mat.emissiveColor = Color3.White();
    mat.backFaceCulling = false;
    mat.alpha = 0.999; // vertex alpha needs blending on
    mesh.hasVertexAlpha = true;
    mesh.material = mat;
    mesh.isPickable = false;
    this.borderWall = mesh;
  }

  /** City limits (bright) and district borders (faint) drawn on the ground. */
  private updatePoliticsMap(): void {
    this.updateBorderWall();
    const s = this.sim.state;
    // the inspected government's districts show too (its limits get the wall)
    const show = this.politicsMap ? s.polities : s.polities.filter((g) => g.id === this.inspectedPolity);
    const key = show.length ? `${this.politicsMap}|` + show.map((g) => `${g.id}:${g.cells.length}:${g.districts.length}:${g.status}`).join(',') : '';
    if (key === this.mapKey) return;
    this.mapKey = key;
    this.mapLines?.dispose();
    this.mapLines = null;
    if (!show.length) return;
    const lines: Vector3[][] = [];
    const colors: Color4[][] = [];
    const w = s.world;
    const half = POLITICS.cell / 2;
    const seg = (ax: number, ay: number, bx: number, by: number, c: Color4) => {
      lines.push([new Vector3(ax, heightAt(w, ax, ay) + 0.6, ay), new Vector3(bx, heightAt(w, bx, by) + 0.6, by)]);
      colors.push([c, c]);
    };
    for (const g of show) {
      if (g.status === 'gone') continue;
      const inside = new Set(g.cells);
      const col = Color3.FromHSV(g.hue * 360, 0.6, 1);
      const limit = new Color4(col.r, col.g, col.b, 1);
      const districtOf = new Map<number, number>();
      g.districts.forEach((d, i) => d.forEach((c) => districtOf.set(c, i)));
      const faint = new Color4(1, 1, 1, 0.45);
      for (const c of g.cells) {
        const [x, y] = cellCenter(c);
        const cx = c % TERRITORY_COLS, cy = Math.floor(c / TERRITORY_COLS);
        const nb: [number, number, number, number, number, number][] = [
          [cx + 1, cy, x + half, y - half, x + half, y + half], [cx - 1, cy, x - half, y - half, x - half, y + half],
          [cx, cy + 1, x - half, y + half, x + half, y + half], [cx, cy - 1, x - half, y - half, x + half, y - half],
        ];
        for (const [nx, ny, ax, ay, bx, by] of nb) {
          const n = ny * TERRITORY_COLS + nx;
          if (!inside.has(n)) seg(ax, ay, bx, by, limit);
          else if (districtOf.size && districtOf.get(n) !== districtOf.get(c) && n > c) seg(ax, ay, bx, by, faint);
        }
      }
    }
    if (!lines.length) return;
    this.mapLines = MeshBuilder.CreateLineSystem('politicsMap', { lines, colors, useVertexAlpha: true }, this.scene);
    this.mapLines.isPickable = false;
  }

  /** Work clothes by job. */
  private outfitOf(p: Person): PersonVisual['outfit'] {
    const role = this.sim.ctx.cById.get(p.job)?.role as Role | undefined;
    if (this.sim.ctx.s.polities.some((g) => g.offices.some((o) => o.holder === p.id && (o.kind === 'exec' || o.kind === 'council')))) return 'suit';
    switch (role) {
      case 'officer': return 'police' as PersonVisual['outfit'];
      case 'builder': case 'miner': case 'quarrier': case 'logger': return 'hivis';
      case 'cook': return 'chef';
      case 'waiter': case 'cashier': return 'apron';
      case 'worker': case 'farmhand': case 'driver': return 'work';
      case 'manager': case 'presenter': case 'official': return 'suit';
      case 'clerk': case 'civil': case 'journalist': case 'programmer': return 'office';
    }
    return p.firms.length ? 'office' : 'casual';
  }

  refreshOwnership(): void {
    const ctx = this.sim.ctx;
    if (!this.ownership) { this.roads.setLotOverlay(null, () => null); return; }
    this.roads.setLotOverlay(this.sim.state.roads.lots, (lot) => {
      const p = ctx.byId.get(lot.owner) ?? ctx.byId.get(ctx.fById.get(lot.owner)?.owner ?? -1);
      if (p) return personColor(p);
      const g = ctx.govOfFirm.get(lot.owner);
      if (g) return Color3.FromHSV(g.hue * 360, 0.35, 0.75); // public land
      return null; // the Territory's
    });
  }

  private updateCutaway(): void {
    let id: number | null = null;
    const sel = this.selection;
    if (sel?.type === 'building') id = sel.id;
    else if (sel?.type === 'firm' && this.camera.radius < 200) {
      // a company: open up its main site (a leased floor opens its tower at that floor)
      const f = this.sim.ctx.fById.get(sel.id);
      const site = f?.sites.map((s) => this.sim.ctx.bById.get(s)).find((b) => b?.built && !b.ruined);
      if (site) id = site.id;
    } else if (sel?.type === 'person') {
      const p = this.sim.ctx.byId.get(sel.id);
      if (p && p.inside >= 0 && this.camera.radius < 140) id = p.inside;
    }
    if (id !== this.cutaway) {
      this.cutaway = id;
      this.buildings.setCutaway(id);
    }
  }

  private updatePeople(alpha: number, time: number): void {
    const ctx = this.sim.ctx;
    const w = this.sim.state.world;
    const out = this.personVisuals;
    out.length = 0;
    if (!this.showMovers) { this.people.update(out, time, 1); return; }
    const selId = this.selection?.type === 'person' ? this.selection.id : -1;
    for (const p of this.sim.state.people) {
      if (p.driving >= 0) continue; // drawn in the vehicle
      // away at the regional hospital outside the map (parked at the far gate meanwhile): not drawn
      if (p.ill?.admitted === GATE || p.task?.steps[p.task.i]?.k === 'away') continue;
      let z = 0;
      const x = p.px + (p.x - p.px) * alpha, y = p.py + (p.y - p.py) * alpha;
      if (p.inside >= 0) {
        const b = ctx.bById.get(p.inside);
        if (!b) continue;
        const st = p.seat >= 0 ? stationsOf(b)[p.seat] : undefined;
        // inside: drawn when the building is opened up (a tower opened up shows its shops and office floors too)
        const open = st?.outside || !b.built || this.cutaway === b.id || (b.host !== undefined && this.cutaway === b.host);
        if (!open) continue;
        z = heightAt(w, b.x, b.y) + (st ? st.floor * FLOOR_H : 0) + standHeight(b); // (a trailer's floor is up on blocks)
        if (p.pose === 'sleep') z += 0.5;
      } else {
        // in town people walk on raised sidewalks
        // on the sidewalk, the road, a dirt track or the ground
        z = Math.max(-0.3, heightAt(w, x, y)) + this.roads.surfaceAt(x, y);
      }
      const moving = p.x !== p.px || p.y !== p.py;
      const pose = p.pose === 'walk' && !moving ? 'stand' : p.pose;
      out.push({
        id: p.id, x, y, z, heading: p.heading,
        pose,
        moving: moving && !SEATED.has(p.pose),
        looks: p.looks,
        carrying: invWeight(p.inv) > 6,
        highlight: p.id === selId,
        talking: !!p.saying,
        holding: pose === 'phone' ? 'phone' : pose === 'protest' ? 'sign' : pose === 'speech' ? 'mic' : pose === 'eat' && p.inside >= 0 && p.inside !== p.home ? 'cup' : null,
        outfit: this.outfitOf(p),
        seated: SEATED.has(pose),
      });
    }
    const scale = Math.min(2.5, Math.max(1, this.cam.viewDistance / 110));
    this.people.update(out, time, scale);
  }


  private updateVehicles(alpha: number, time: number, gameSpeed: number): void {
    const w = this.sim.state.world;
    const out = this.vehicleVisuals;
    out.length = 0;
    if (!this.showMovers) { this.vehicles.update(out, time, this.nightLevel); return; }
    for (const v of this.sim.state.vehicles) {
      const x = v.px + (v.x - v.px) * alpha, y = v.py + (v.y - v.py) * alpha;
      const moved = Math.hypot(v.x - v.px, v.y - v.py); // meters per game minute
      out.push({
        id: v.id, kind: v.kind, x, y, z: Math.max(-0.2, heightAt(w, x, y)) + ROAD_SURFACE.asphalt, heading: v.heading, hue: v.hue,
        speed: Math.min(30, (moved / 60) * Math.min(gameSpeed, 60)),
        hasDriver: v.driver >= 0 || (!!v.trip && v.trip.phase !== 'stop'), // outside fleets' drivers aren't city people
        // company trucks and vans carry a livery (outside fleets: their own brand and color)
        brand: v.kind !== 'car' ? v.brand ?? this.sim.ctx.fById.get(v.owner)?.name : undefined,
        brandHue: this.sim.ctx.fById.get(v.owner)?.hue ?? v.hue,
      });
    }
    this.vehicles.update(out, time, this.nightLevel);
  }

  private updateLighting(t: number): void {
    const day = (t % MINUTES_PER_DAY) / MINUTES_PER_DAY; // 0 = midnight
    const hour = day * 24;
    // sun up from ~5:30 to ~20:00, full daylight 7:30-18:30
    const elev = Math.sin(Math.max(0, Math.min(1, (hour - 5.5) / 14.5)) * Math.PI);
    const smooth = (a: number, b: number, x: number) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
    const daylight = smooth(5.3, 7.5, hour) * (1 - smooth(18.5, 20.6, hour));
    this.nightLevel = 1 - daylight;
    const az = day * Math.PI * 2;
    this.sun.direction = new Vector3(Math.cos(az) * 0.8, -Math.max(0.25, elev), Math.sin(az) * 0.5 - 0.3).normalize();
    this.sun.intensity = 1.0 * Math.min(1, Math.max(0, elev * 1.5));
    this.sun.diffuse = Color3.Lerp(Color3.FromHexString('#ffb46b'), Color3.FromHexString('#fff6e8'), Math.min(1, Math.max(0, elev * 2)));
    this.hemi.intensity = 0.2 + 0.42 * daylight;
    this.hemi.diffuse = Color3.Lerp(Color3.FromHexString('#5b6aa0'), Color3.FromHexString('#f2f4ff'), daylight);
    const sky = Color3.Lerp(Color3.FromHexString('#0b1222'), Color3.FromHexString('#a9cbe3'), daylight);
    this.scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);
    this.scene.fogColor = sky;
    this.glow.intensity = 0.75 * this.nightLevel;
    this.glow.isEnabled = this.nightLevel > 0.05;
    // shadows only matter when you're close enough to see them
    this.scene.shadowsEnabled = this.camera.radius < 650 && this.sun.intensity > 0.05;
    const target = this.camera.target;
    this.sun.shadowFrustumSize = Math.min(700, Math.max(40, this.camera.radius * 1.3));
    this.sun.position = target.subtract(this.sun.direction.scale(600));
    this.sun.shadowMinZ = 1;
    this.sun.shadowMaxZ = 1400;
  }

  private updateSelection(alpha: number): void {
    const ctx = this.sim.ctx;
    const sel = this.selection;
    let pos: Vector3 | null = null;
    let name = '';
    this.ring.setEnabled(false);
    if (sel?.type === 'person') {
      const p = ctx.byId.get(sel.id);
      if (!p) { this.selection = null; return; }
      const v = p.driving >= 0 ? ctx.vById.get(p.driving) : undefined;
      const x = v ? v.px + (v.x - v.px) * alpha : p.px + (p.x - p.px) * alpha;
      const y = v ? v.py + (v.y - v.py) * alpha : p.py + (p.y - p.py) * alpha;
      const vis = this.personVisuals.find((q) => q.id === p.id);
      pos = new Vector3(x, vis ? vis.z : heightAt(this.sim.state.world, x, y), y);
      name = p.name;
    } else if (sel?.type === 'building') {
      const b = ctx.bById.get(sel.id);
      if (!b) { this.selection = null; return; }
      pos = new Vector3(b.x, heightAt(this.sim.state.world, b.x, b.y) + 0.15, b.y);
      this.ring.setEnabled(true);
      this.ring.position.copyFrom(pos);
      this.ring.scaling.setAll(Math.max(b.w, b.d) * 1.25);
      name = ctx.fById.get(b.firm)?.name ?? BUILDINGS[b.kind].label;
    }
    if (!pos || !name) { this.label.style.display = 'none'; return; }
    const sp = this.project(pos.add(new Vector3(0, sel?.type === 'person' ? 2.3 * Math.min(2.5, Math.max(1, this.cam.viewDistance / 110)) : 6, 0)));
    this.label.style.display = sp ? 'block' : 'none';
    if (sp) {
      this.label.style.transform = `translate(${sp[0]}px, ${sp[1]}px) translate(-50%, -100%)`;
      this.label.textContent = name;
    }
  }

  private project(v: Vector3): [number, number] | null {
    const sp = Vector3.Project(v, Matrix.Identity(), this.scene.getTransformMatrix(),
      this.camera.viewport.toGlobal(this.engine.getRenderWidth(), this.engine.getRenderHeight()));
    if (sp.z <= 0 || sp.z >= 1) return null;
    const ratio = this.engine.getHardwareScalingLevel();
    return [sp.x * ratio, sp.y * ratio];
  }

  /** Speech bubbles over people talking near the camera. */
  private updateBubbles(): void {
    const close = this.cam.viewDistance < 160;
    let used = 0;
    if (close) {
      const ctx = this.sim.ctx;
      const target = this.camera.target;
      for (const v of this.personVisuals) {
        if (used >= 24) break;
        const p = ctx.byId.get(v.id);
        if (!p?.saying) continue;
        if (Math.hypot(v.x - target.x, v.y - target.z) > this.cam.viewDistance * 1.2) continue;
        const sp = this.project(new Vector3(v.x, v.z + 2.1 * Math.min(2.5, Math.max(1, this.cam.viewDistance / 110)), v.y));
        if (!sp) continue;
        let el = this.bubblePool[used];
        if (!el) {
          el = document.createElement('div');
          el.className = 'bubble';
          this.bubbles.appendChild(el);
          this.bubblePool.push(el);
        }
        el.textContent = p.saying;
        el.style.display = 'block';
        el.style.transform = `translate(${sp[0]}px, ${sp[1]}px) translate(-50%, -100%)`;
        used++;
      }
    }
    for (let i = used; i < this.bubblePool.length; i++) this.bubblePool[i].style.display = 'none';
  }

  /** What the camera follows: the selected person (or their vehicle), with the building opened up around them. */
  private cameraSubject(alpha: number): Subject | null {
    const sel = this.selection;
    if (sel?.type !== 'person') return null;
    const ctx = this.sim.ctx, s = this.sim.state, w = s.world;
    const p = ctx.byId.get(sel.id);
    if (!p) return null;
    const v = p.driving >= 0 ? ctx.vById.get(p.driving) : undefined;
    const x = v ? v.px + (v.x - v.px) * alpha : p.px + (p.x - p.px) * alpha;
    const y = v ? v.py + (v.y - v.py) * alpha : p.py + (p.y - p.py) * alpha;
    const vis = v ? undefined : this.personVisuals.find((q) => q.id === p.id);
    const z = vis ? vis.z : Math.max(-0.2, heightAt(w, x, y)) + (v ? ROAD_SURFACE.asphalt : 0);
    const b = !v && p.inside >= 0 ? ctx.bById.get(p.inside) : undefined;
    const st = b && p.seat >= 0 ? stationsOf(b)[p.seat] : undefined;
    const indoors = !!b && b.built && !st?.outside;
    // who they're talking to (a recent conversation with someone close by)
    let partner: Subject['partner'] = null;
    if (p.saying) {
      for (let i = s.conversations.length - 1; i >= 0 && s.tick - s.conversations[i].t <= 15; i--) {
        const c = s.conversations[i];
        if (c.a !== p.id && c.b !== p.id) continue;
        const q = this.personVisuals.find((pv) => pv.id === (c.a === p.id ? c.b : c.a));
        if (q && Math.hypot(q.x - x, q.y - y) < 5) partner = { x: q.x, y: q.y, z: q.z };
        break;
      }
    }
    return {
      id: p.id, x, y, z,
      heading: v ? v.heading : p.heading,
      moving: v ? v.x !== v.px || v.y !== v.py : (p.x !== p.px || p.y !== p.py) && !SEATED.has(p.pose),
      driving: !!v,
      inside: indoors,
      talking: !!p.saying,
      working: WORK_POSES.has(p.pose),
      partner,
      cutawayBuilding: indoors && this.cutaway === b!.id
        ? { x: b!.x, y: b!.y, w: b!.w, d: b!.d, floors: b!.floors, angle: b!.angle, ground: heightAt(w, b!.x, b!.y), id: b!.id }
        : null,
    };
  }

  // ----------------------------------------------------------------- input

  private setupInput(): void {
    let downX = 0, downY = 0;
    this.scene.onPointerObservable.add((info) => {
      const e = info.event as PointerEvent;
      if (info.type === PointerEventTypes.POINTERDOWN) { downX = e.clientX; downY = e.clientY; }
      if (info.type !== PointerEventTypes.POINTERUP || e.button !== 0) return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
      const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY, (m) => m.isPickable && m.isEnabled() && m.isVisible);
      let sel: Selection = null;
      if (pick?.hit) {
        const pid = this.people.pickedId(pick);
        const vid = pid < 0 ? this.vehicles.pickedId(pick) : -1;
        const adId = pid < 0 && vid < 0 ? this.ads.pickedId(pick) : -1;
        const bid = pid < 0 && vid < 0 && adId < 0 ? this.buildings.pickedId(pick) : -1;
        if (adId >= 0) {
          // clicking an ad shows who paid for it
          const ad = this.sim.state.ads.find((a) => a.id === adId);
          if (ad && this.sim.ctx.byId.has(ad.sponsor)) sel = { type: 'person', id: ad.sponsor };
          else if (ad && this.sim.ctx.fById.has(ad.sponsor)) sel = { type: 'firm', id: ad.sponsor };
          else if (ad && ad.owner !== undefined && this.sim.ctx.fById.has(ad.owner)) sel = { type: 'firm', id: ad.owner }; // empty space: its owner
        } else if (pid >= 0) sel = { type: 'person', id: pid };
        else if (vid >= 0) {
          const v = this.sim.ctx.vById.get(vid);
          const who = v ? (v.driver >= 0 ? v.driver : v.owner) : -1;
          if (this.sim.ctx.byId.has(who)) sel = { type: 'person', id: who };
          else if (this.sim.ctx.fById.has(who)) sel = { type: 'firm', id: who };
        } else if (bid >= 0) sel = { type: 'building', id: bid };
      }
      this.selection = sel;
      this.onPick(sel);
    });
  }

}
