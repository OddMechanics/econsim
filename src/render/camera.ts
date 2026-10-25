// The camera: one ArcRotateCamera driven in four modes.
//
//   free    keyboard (arrows/WASD pan relative to the view with acceleration
//           and inertia, Shift = faster, Q/E rotate, R/F or PageUp/PageDown
//           zoom) plus Babylon's mouse orbit / pan / wheel.
//   follow  a smooth chase of the subject that keeps the user's orbit.
//   cinema  "like a movie": an automatic director picks shots (wide, tracking,
//           over-the-shoulder, close-ups, low-angle hero, chase cams, a look
//           into the opened building), cuts between them every few seconds or
//           on events, moves smoothly within a shot, avoids occluders and
//           never goes under the ground. Letterbox bars and a shot caption.
//   walk    (V) street level at eye height, steered with the keys.
//
// Every mode is expressed as ArcRotateCamera target + alpha/beta/radius, so
// code that reads `camera.radius` / `camera.target` keeps working. Note that
// assigning `camera.target = v` keeps the camera's *position* and re-aims
// (Babylon's setTarget); this module moves the target in place instead.
//
// Coordinates: sim (x, y) on the ground = Babylon (x, z); heights are Babylon y.
// A subject's heading h faces (cos h, 0, sin h).

import { ArcRotateCamera, Ray, Vector3 } from '@babylonjs/core';
import type { AbstractMesh, Scene } from '@babylonjs/core';

export type CameraMode = 'free' | 'follow' | 'cinema' | 'walk';
/** Why the mode changed: the user's own input, an API call, or the subject went away. */
export type ModeChangeReason = 'user' | 'api' | 'lost';
export type ShotType =
  | 'wide' | 'track' | 'side' | 'lead' | 'ots' | 'mcu' | 'closeup' | 'hero'
  | 'chase' | 'sidecar' | 'driveby' | 'aerial' | 'inside' | 'insideClose' | 'crane';

/** The opened-up building the subject is in (footprint as in `Building`). */
export interface CutawayBox {
  x: number; y: number; // center (sim coords)
  w: number; d: number; // width (along (sin a, -cos a)) and depth (along (cos a, sin a))
  floors: number;
  angle: number; // facing direction
  /** Storey height (default 3.2 m). */
  storey?: number;
  /** Ground height at the center (defaults to heightAt(x, y)). */
  ground?: number;
  /** Building id: meshes with metadata.id === id never count as occluders. */
  id?: number;
}

/** What the camera follows, given every frame. */
export interface Subject {
  x: number; y: number; // sim ground position (the vehicle's when driving)
  z: number; // feet height (Babylon y)
  heading: number; // radians, faces (cos h, sin h); the vehicle's heading when driving
  moving: boolean;
  driving: boolean;
  inside: boolean;
  /** Speaking right now (the director cuts to a close-up / over-the-shoulder). */
  talking?: boolean;
  /** Working at a station (favors medium close-ups). */
  working?: boolean;
  /** Who they're talking to (sim x, y; feet height z, default the subject's): dialogue shots are staged around them. */
  partner?: { x: number; y: number; z?: number } | null;
  /** Identity: a change is a hard cut. */
  id?: number;
  cutawayBuilding?: CutawayBox | null;
}

export interface CameraOptions {
  /** Terrain height at sim (x, y). */
  heightAt: (x: number, y: number) => number;
  /** Meshes that block the view (buildings). Disabled/invisible meshes are skipped automatically. */
  isOccluder: (m: AbstractMesh) => boolean;
  /** Wrap an existing camera instead of creating one. */
  camera?: ArcRotateCamera;
  /** Where the letterbox bars and caption go (default document.body). */
  overlayParent?: HTMLElement;
  /** Letterbox bars in cinema mode (default true). */
  letterbox?: boolean;
  /** Shot caption in cinema mode (default true). */
  captions?: boolean;
  /** Built-in shortcuts: C toggles cinema (with a subject), V toggles walk (default true). */
  shortcuts?: boolean;
  /** Seed for the director's choices (default: random). */
  seed?: number;
}

export interface CameraStats {
  /** Occlusion line tests so far / per second (smoothed). */
  rays: number;
  raysPerSec: number;
  /** In-shot occlusion samples that found the subject hidden. */
  blockedSamples: number;
  samples: number;
  cuts: number;
  /** Smoothed milliseconds per update(). */
  updateMs: number;
}

const TAU = Math.PI * 2;
const WALK_R = 0.05; // ArcRotate radius in walk mode (the eye orbits a point 5 cm ahead)
const EYE = 1.7;
const LETTERBOX = 2.35;
/** Storey height (same as FLOOR_H in sim/layout; kept local so this module only depends on Babylon). */
const FLOOR_H = 3.2;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);
const ease = (t: number) => { const k = clamp01(t); return k * k * (3 - 2 * k); };
/** Exponential approach factor for time constant tau. */
const follow = (dt: number, tau: number) => (tau <= 0 ? 1 : 1 - Math.exp(-dt / tau));
const wrap = (a: number) => { a %= TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; return a; };

const PAN_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const ORBIT_KEYS = new Set(['KeyQ', 'KeyE', 'KeyR', 'KeyF', 'PageUp', 'PageDown']);

const CAPTION: Record<ShotType, string> = {
  wide: 'Wide · establishing', track: 'Medium · tracking', side: 'Side tracking', lead: 'Leading shot',
  ots: 'Over the shoulder', mcu: 'Medium close-up', closeup: 'Close-up', hero: 'Low angle',
  chase: 'Chase cam', sidecar: 'Side tracking', driveby: 'Drive-by', aerial: 'Aerial',
  inside: 'Cutaway', insideClose: 'Interior', crane: 'Crane',
};

type Cat = 'walk' | 'stand' | 'talk' | 'drive' | 'inside' | 'closed';

const WEIGHTS: Record<Cat, Partial<Record<ShotType, number>>> = {
  walk: { track: 3, side: 2.6, lead: 1.6, ots: 1.2, hero: 1.2, wide: 1.4 },
  stand: { mcu: 2.6, closeup: 1.4, ots: 1.6, hero: 1.1, wide: 1.3, side: 0.5 },
  talk: { closeup: 3, mcu: 2.6, ots: 2.6, hero: 0.6, wide: 0.6 },
  drive: { chase: 3, sidecar: 2.4, driveby: 2, aerial: 1.6 },
  inside: { inside: 3, insideClose: 2.2 },
  closed: { wide: 2, crane: 0.6 },
};
/** Categories each shot type works in; others are tolerated for `TOLERANCE` seconds. */
const ALLOWED: Record<ShotType, Cat[]> = {
  wide: ['walk', 'stand', 'talk', 'closed'], track: ['walk'], side: ['walk', 'stand'], lead: ['walk'],
  ots: ['walk', 'stand', 'talk'], mcu: ['stand', 'talk'], closeup: ['stand', 'talk'], hero: ['walk', 'stand', 'talk'],
  chase: ['drive'], sidecar: ['drive'], driveby: ['drive'], aerial: ['drive'],
  inside: ['inside'], insideClose: ['inside'], crane: ['walk', 'stand', 'talk', 'drive', 'inside', 'closed'],
};
const TOLERANCE: Partial<Record<ShotType, number>> = { track: 2.5, lead: 1.5, mcu: 0.8, closeup: 0.6, side: 3 };
const DURATION: Record<ShotType, [number, number]> = {
  wide: [6, 10], track: [7, 14], side: [6, 12], lead: [5, 9], ots: [5, 9], mcu: [5, 9], closeup: [4, 7], hero: [5, 8],
  chase: [8, 14], sidecar: [6, 10], driveby: [5, 8], aerial: [7, 12], inside: [8, 14], insideClose: [6, 10], crane: [5, 8],
};

interface Shot {
  type: ShotType;
  t: number;
  dur: number;
  side: number; // ±1
  az: number; // azimuth relative to the heading (0 = in front of the subject)
  dist0: number; dist1: number; // dolly
  h0: number; h1: number; // camera height above the feet
  fov: number;
  focus: number; // height of the point of interest above the feet
  u: number; v: number; // where that point sits on screen (u: looking room, v: + = above center)
  posTau: number; aimTau: number;
  lockHeading: boolean; // stand shots keep the heading at the cut
  heading0: number;
  orbit: number; // rad/s drift around the subject (or pivot)
  anchor: Vector3 | null; // world-fixed camera
  pivot: Vector3 | null; // anchor orbits around this
  truck: Vector3 | null; // anchor slides by this over the shot
  boost: number; boostGoal: number; // raised to clear occluders
  blocked: number;
  invalid: number;
  lost: number;
}

/** A tiny seeded PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isTyping(el: EventTarget | Element | null): boolean {
  const e = el as HTMLElement | null;
  if (!e || !e.tagName) return false;
  const tag = e.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.isContentEditable;
}

export class CameraController {
  readonly camera: ArcRotateCamera;
  /** Called on every mode change (e.g. the user panned away from a follow). */
  onModeChange: (mode: CameraMode, prev: CameraMode, reason: ModeChangeReason) => void = () => {};
  /** Called on every cinema cut. */
  onShot: (type: ShotType, reason: string) => void = () => {};
  stats: CameraStats = { rays: 0, raysPerSec: 0, blockedSamples: 0, samples: 0, cuts: 0, updateMs: 0 };
  /** Debug: what the last cut tried (type:rays+/-). */
  lastCut = '';

  private _mode: CameraMode = 'free';
  private readonly opts: CameraOptions;
  private readonly freeLimits: { r0: number; r1: number; b0: number; b1: number; fov: number };
  private readonly keys = new Set<string>();
  private shift = false;
  private readonly vel = new Vector3(); // free/walk pan velocity (world)
  private rotVel = 0;
  private zoomVel = 0;
  private goalRadius = NaN;
  private fly: Vector3 | null = null;
  private lastTx = 0;
  private lastTz = 0;
  private lastSubject: Subject | null = null;
  private noSubject = 0;
  private readonly rand: () => number;
  private readonly ray = new Ray(Vector3.Zero(), new Vector3(1, 0, 0), 1);
  private near: AbstractMesh[] = [];
  private nearAt = new Vector3(Infinity, 0, 0);
  private nearAge = Infinity;
  private raysClock = 0;
  private prevRays = 0;
  // walk
  private readonly eye = new Vector3();
  private walkPrev: CameraMode = 'free';
  // subject tracking (smoothed)
  private readonly fs = new Vector3(); // feet
  private readonly raw = new Vector3();
  private readonly sv = new Vector3(); // velocity
  private hs = 0; // heading
  private tracked = false;
  private wasDriving = false;
  private prevFlags = { id: undefined as number | undefined, driving: false, inside: false, talking: false, cut: false, z: 0 };
  // cinema
  private shot: Shot | null = null;
  private pendingCut: string | null = null;
  private snap = true;
  private readonly camPos = new Vector3();
  private readonly off = new Vector3();
  private readonly aim = new Vector3();
  private monitorClock = 0;
  private monitorFlip = false;
  // overlay
  private bars: HTMLDivElement[] = [];
  private captionEl: HTMLDivElement | null = null;
  private captionTimer = 0;
  private _letterbox: boolean;
  private _captions: boolean;
  private visFrac = 1;
  // input
  private ptr: { x: number; y: number; button: number; ctrl: boolean; moved: boolean } | null = null;
  private readonly touches = new Set<number>();
  private readonly listeners: [EventTarget, string, EventListener][] = [];
  // temps
  private readonly t1 = new Vector3();
  private readonly t2 = new Vector3();
  private readonly t3 = new Vector3();
  private readonly t4 = new Vector3();

  constructor(private readonly scene: Scene, canvas: HTMLCanvasElement, opts: CameraOptions) {
    this.opts = opts;
    this._letterbox = opts.letterbox ?? true;
    this._captions = opts.captions ?? true;
    this.rand = rng(opts.seed ?? (Math.random() * 2 ** 32) >>> 0);
    let cam = opts.camera;
    if (!cam) {
      cam = new ArcRotateCamera('cam', -Math.PI / 2.4, 0.95, 260, Vector3.Zero(), scene);
      cam.lowerRadiusLimit = 3;
      cam.upperRadiusLimit = 1700;
      cam.lowerBetaLimit = 0.1;
      cam.upperBetaLimit = 1.48;
      cam.wheelDeltaPercentage = 0.015;
      cam.pinchDeltaPercentage = 0.004;
      cam.panningSensibility = 40;
      cam.minZ = 0.25;
      cam.maxZ = 7000;
      cam.attachControl(canvas, true);
    }
    this.camera = cam;
    cam.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');
    cam.mapPanning = true; // mouse pan slides over the ground instead of the screen plane
    this.freeLimits = {
      r0: cam.lowerRadiusLimit ?? 3, r1: cam.upperRadiusLimit ?? 1700,
      b0: cam.lowerBetaLimit ?? 0.1, b1: cam.upperBetaLimit ?? 1.48, fov: cam.fov,
    };
    // the target must be a vector we own (moved in place)
    cam.setTarget(cam.target.clone(), false, true, true);

    const on = (el: EventTarget, type: string, fn: EventListener, o?: AddEventListenerOptions) => {
      el.addEventListener(type, fn, o);
      this.listeners.push([el, type, fn]);
    };
    on(window, 'keydown', ((e: KeyboardEvent) => this.keyDown(e)) as EventListener);
    on(window, 'keyup', ((e: KeyboardEvent) => { this.keys.delete(e.code); this.shift = e.shiftKey; }) as EventListener);
    on(window, 'blur', () => { this.keys.clear(); this.shift = false; this.ptr = null; this.touches.clear(); });
    on(document, 'focusin', ((e: FocusEvent) => { if (isTyping(e.target)) this.keys.clear(); }) as EventListener);
    on(canvas, 'pointerdown', ((e: PointerEvent) => {
      this.touches.add(e.pointerId);
      this.ptr = { x: e.clientX, y: e.clientY, button: e.button, ctrl: e.ctrlKey || e.metaKey, moved: false };
    }) as EventListener);
    on(window, 'pointermove', ((e: PointerEvent) => {
      const p = this.ptr;
      if (!p || p.moved || !e.buttons) return;
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5) return;
      p.moved = true;
      const pan = p.button === 2 || p.ctrl || this.touches.size >= 2;
      this.userInput(pan ? 'pan' : 'orbit');
    }) as EventListener);
    const up = ((e: PointerEvent) => { this.touches.delete(e.pointerId); if (!this.touches.size) this.ptr = null; }) as EventListener;
    on(window, 'pointerup', up);
    on(window, 'pointercancel', up);
    on(canvas, 'wheel', () => this.userInput('zoom'), { passive: true });
    on(window, 'resize', () => this.layoutBars());
  }

  // ------------------------------------------------------------- public API

  get mode(): CameraMode { return this._mode; }
  /** The current cinema shot (null outside cinema). */
  get shotType(): ShotType | null { return this.shot?.type ?? null; }
  get shotTime(): number { return this.shot?.t ?? 0; }
  /**
   * How far away the view's focus is, for level-of-detail decisions (people
   * scale, speech bubbles): the orbit radius, or ~25 m in walk mode.
   */
  get viewDistance(): number { return this._mode === 'walk' ? 25 : this.camera.radius; }

  get letterbox(): boolean { return this._letterbox; }
  set letterbox(v: boolean) { this._letterbox = v; this.showOverlay(this._mode === 'cinema'); }
  get captions(): boolean { return this._captions; }
  set captions(v: boolean) { this._captions = v; this.showOverlay(this._mode === 'cinema'); }

  setMode(mode: CameraMode, reason: ModeChangeReason = 'api'): void {
    const prev = this._mode;
    if (mode === prev) return;
    const cam = this.camera;
    if (prev === 'walk') this.leaveWalk();
    if (prev === 'cinema') {
      this.shot = null;
      this.showOverlay(false);
      cam.fov = this.freeLimits.fov;
      // keep what's on screen as a valid orbit
      cam.radius = clamp(cam.radius, this.freeLimits.r0, this.freeLimits.r1);
      cam.beta = clamp(cam.beta, this.freeLimits.b0, this.freeLimits.b1);
    }
    this._mode = mode;
    this.stopInertia();
    if (mode === 'free' || mode === 'follow') this.setLimits(this.freeLimits.r0, this.freeLimits.r1, this.freeLimits.b0, this.freeLimits.b1);
    if (mode === 'follow') {
      this.goalRadius = cam.radius > 150 ? 70 : NaN;
      if (cam.beta < 0.5 && cam.radius > 150) cam.beta = 0.85;
    }
    if (mode === 'cinema') {
      this.setLimits(0.05, 5000, 0.02, Math.PI - 0.05);
      this.shot = null;
      this.snap = true;
      this.tracked = false;
      this.showOverlay(true);
    }
    if (mode === 'walk') this.enterWalk(prev);
    this.onModeChange(mode, prev, reason);
  }

  /** Cinema on/off (off = follow). Needs a subject. */
  toggleCinema(reason: ModeChangeReason = 'api'): void {
    if (this._mode === 'cinema') this.setMode(this.lastSubject ? 'follow' : 'free', reason);
    else if (this.lastSubject) this.setMode('cinema', reason);
  }

  /** Street-level view on/off (off = back to following if that's where it came from). */
  toggleWalk(reason: ModeChangeReason = 'api'): void {
    if (this._mode !== 'walk') { this.setMode('walk', reason); return; }
    const back = this.walkPrev === 'follow' || this.walkPrev === 'cinema';
    this.setMode(back && this.lastSubject ? this.walkPrev : 'free', reason);
  }

  /**
   * Look at sim (x, y) at height z. In follow mode only the zoom applies (the
   * chase keeps the subject centered); cinema ignores it; walk switches to
   * free. `smooth` glides there instead of jumping.
   */
  focusOn(x: number, y: number, z: number, radius?: number, smooth = false): void {
    const r = radius ? clamp(radius, this.freeLimits.r0, this.freeLimits.r1) : NaN;
    if (this._mode === 'cinema') return;
    if (this._mode === 'follow') { if (radius) this.goalRadius = r; return; }
    if (this._mode === 'walk') this.setMode('free', 'api');
    this.vel.setAll(0);
    if (smooth) {
      this.fly = new Vector3(x, z, y);
      this.goalRadius = r;
      return;
    }
    this.fly = null;
    this.camera.target.copyFromFloats(x, z, y);
    if (radius) this.camera.radius = r;
  }

  /** Jump to a specific cinema shot (testing / UI). Returns false if it isn't possible right now. */
  forceShot(type: ShotType): boolean {
    if (this._mode !== 'cinema' || !this.lastSubject) return false;
    const s = this.lastSubject;
    if (!this.tracked) this.track(0, s);
    const sh = this.findShot(type, s, true);
    if (!sh) return false;
    this.startShot(sh, 'forced');
    return true;
  }

  /** The camera's world position as of the last update (Babylon coords). */
  position(out = new Vector3()): Vector3 {
    const c = this.camera;
    const sb = Math.sin(c.beta);
    return out.copyFromFloats(c.target.x + c.radius * Math.cos(c.alpha) * sb, c.target.y + c.radius * Math.cos(c.beta), c.target.z + c.radius * Math.sin(c.alpha) * sb);
  }

  /**
   * Is the line from `from` to `to` clear of occluders, the terrain and the
   * opened building's floor slabs? (Babylon coords; counts toward stats.rays.)
   */
  lineClear(from: Vector3, to: Vector3, cut?: CutawayBox | null, extra = 0.45): boolean {
    this.stats.rays++;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-3) return true;
    const h = this.opts.heightAt;
    const n = Math.min(16, Math.max(3, Math.ceil(L / 4)));
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      const x = from.x + dx * f, y = from.y + dy * f, z = from.z + dz * f;
      if (y < h(x, z) + 0.12) return false;
    }
    if (cut && this.slabBlocks(from, to, cut)) return false;
    const r = this.ray;
    const skip = Math.min(0.3, L * 0.5); // don't hit what the subject stands in/at
    r.direction.copyFromFloats(dx / L, dy / L, dz / L);
    r.origin.copyFromFloats(from.x + r.direction.x * skip, from.y + r.direction.y * skip, from.z + r.direction.z * skip);
    r.length = L - skip + extra;
    this.refreshNear(from, false);
    for (const m of this.near) {
      if (m.isDisposed() || !m.isEnabled() || !m.isVisible) continue;
      if (r.intersectsMesh(m, true).hit) return false;
    }
    return true;
  }

  /** Call every frame before scene.render(). dt in real seconds. */
  update(dt: number, subject: Subject | null): void {
    const t0 = performance.now();
    dt = clamp(dt, 0, 0.1);
    if (subject) { this.lastSubject = subject; this.noSubject = 0; } else this.noSubject += dt;
    if (!subject && this.noSubject > 0.5 && this.lastSubject) {
      // the subject went away (deselected, died): stop following
      this.lastSubject = null;
      if (this._mode === 'follow' || this._mode === 'cinema') this.setMode('free', 'lost');
    }
    this.handleKeyBreaks();
    const cam = this.camera;
    switch (this._mode) {
      case 'free': this.updateOrbit(dt, null); break;
      case 'follow': this.updateOrbit(dt, subject ?? null); break;
      case 'cinema': if (subject) this.updateCinema(dt, subject); break;
      case 'walk': this.updateWalk(dt); break;
    }
    if (this._mode !== 'walk') cam.panningSensibility = clamp(10400 / Math.max(3, cam.radius), 4, 4000);
    // the near plane follows the viewing distance: precise depth from far away (no flickering ground), close shots still work
    cam.minZ = this._mode === 'walk' ? 0.2 : clamp(cam.radius * 0.008, 0.2, 4);
    if (this.captionTimer > 0) {
      this.captionTimer -= dt;
      if (this.captionTimer <= 0 && this.captionEl) this.captionEl.style.opacity = '0.45';
    }
    this.raysClock += dt;
    if (this.raysClock >= 1) {
      this.stats.raysPerSec = (this.stats.rays - this.prevRays) / this.raysClock;
      this.prevRays = this.stats.rays;
      this.raysClock = 0;
    }
    this.stats.updateMs = this.stats.updateMs * 0.95 + (performance.now() - t0) * 0.05;
  }

  dispose(): void {
    for (const [el, type, fn] of this.listeners) el.removeEventListener(type, fn);
    this.listeners.length = 0;
    for (const b of this.bars) b.remove();
    this.captionEl?.remove();
    this.bars = [];
    this.captionEl = null;
  }

  // ------------------------------------------------------------- input

  private keyDown(e: KeyboardEvent): void {
    this.shift = e.shiftKey;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping(e.target) || isTyping(document.activeElement)) return;
    const c = e.code;
    if ((this.opts.shortcuts ?? true) && !e.repeat) {
      if (c === 'KeyV') { this.toggleWalk('user'); return; }
      if (c === 'KeyC') { this.toggleCinema('user'); return; }
    }
    if (PAN_KEYS.has(c) || ORBIT_KEYS.has(c)) {
      this.keys.add(c);
      if (c.startsWith('Arrow') || c.startsWith('Page')) e.preventDefault();
    }
  }

  /** Keyboard intent while following: panning keys leave, orbit keys take over the camera from the director. */
  private handleKeyBreaks(): void {
    if (!this.keys.size) return;
    let pan = false, orbit = false;
    for (const k of this.keys) { if (PAN_KEYS.has(k)) pan = true; else if (ORBIT_KEYS.has(k)) orbit = true; }
    if (pan) this.userInput('pan');
    else if (orbit) this.userInput('orbit');
  }

  private userInput(kind: 'pan' | 'orbit' | 'zoom'): void {
    const m = this._mode;
    if (kind === 'pan') this.fly = null;
    if (kind === 'zoom') this.goalRadius = NaN;
    if (m === 'follow' && kind === 'pan') this.setMode('free', 'user');
    else if (m === 'cinema') this.setMode(kind === 'pan' ? 'free' : 'follow', 'user');
  }

  private stopInertia(): void {
    const c = this.camera;
    c.inertialAlphaOffset = 0;
    c.inertialBetaOffset = 0;
    c.inertialRadiusOffset = 0;
    c.inertialPanningX = 0;
    c.inertialPanningY = 0;
    c.movement?.resetPanVelocity?.();
    c.movement?.resetRotationVelocity?.();
    c.movement?.resetZoomVelocity?.();
  }

  private setLimits(r0: number, r1: number, b0: number, b1: number): void {
    const c = this.camera;
    c.lowerRadiusLimit = r0; c.upperRadiusLimit = r1;
    c.lowerBetaLimit = b0; c.upperBetaLimit = b1;
  }

  private key(...codes: string[]): boolean {
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  // ------------------------------------------------------------- free / follow

  private updateOrbit(dt: number, s: Subject | null): void {
    const cam = this.camera;
    const tg = cam.target;
    // pan (free only: in follow, pan keys already switched to free)
    let ix = 0, iz = 0;
    if (this.key('KeyW', 'ArrowUp')) iz += 1;
    if (this.key('KeyS', 'ArrowDown')) iz -= 1;
    if (this.key('KeyD', 'ArrowRight')) ix += 1;
    if (this.key('KeyA', 'ArrowLeft')) ix -= 1;
    const fx = -Math.cos(cam.alpha), fz = -Math.sin(cam.alpha);
    const rx = fz, rz = -fx; // up x forward
    const il = Math.hypot(ix, iz) || 1;
    const speed = Math.max(6, cam.radius) * 0.9 * (this.shift ? 2.6 : 1);
    const gx = ((fx * iz + rx * ix) / il) * speed, gz = ((fz * iz + rz * ix) / il) * speed;
    const input = ix !== 0 || iz !== 0;
    const k = follow(dt, input ? 0.16 : 0.3);
    this.vel.x += (gx - this.vel.x) * k;
    this.vel.z += (gz - this.vel.z) * k;
    if (!input && Math.hypot(this.vel.x, this.vel.z) < 0.02 * Math.max(1, cam.radius * 0.05)) this.vel.setAll(0);
    if (this.vel.x !== 0 || this.vel.z !== 0) {
      tg.x += this.vel.x * dt;
      tg.z += this.vel.z * dt;
    }
    // keep the target on the ground while it moves (keys, mouse pan)
    if (!s && Math.abs(tg.x - this.lastTx) + Math.abs(tg.z - this.lastTz) > 1e-3) {
      const g = this.opts.heightAt(tg.x, tg.z);
      tg.y += (g - tg.y) * follow(dt, 0.25);
    }
    this.lastTx = tg.x; this.lastTz = tg.z;
    if (this.fly) {
      if (input || s) this.fly = null;
      else {
        const k2 = follow(dt, 0.25);
        tg.x += (this.fly.x - tg.x) * k2; tg.y += (this.fly.y - tg.y) * k2; tg.z += (this.fly.z - tg.z) * k2;
        if (Vector3.DistanceSquared(tg, this.fly) < 0.01) { tg.copyFrom(this.fly); this.fly = null; }
      }
    }
    if (!s && !isNaN(this.goalRadius)) {
      cam.radius += (this.goalRadius - cam.radius) * follow(dt, 0.3);
      if (Math.abs(cam.radius - this.goalRadius) < 0.05 * this.goalRadius) this.goalRadius = NaN;
    }
    // rotate
    const ir = (this.key('KeyE') ? 1 : 0) - (this.key('KeyQ') ? 1 : 0);
    this.rotVel += (ir * 1.5 - this.rotVel) * follow(dt, ir ? 0.12 : 0.18);
    if (Math.abs(this.rotVel) < 1e-3 && !ir) this.rotVel = 0;
    cam.alpha += this.rotVel * dt;
    // zoom
    const iZ = (this.key('KeyF', 'PageDown') ? 1 : 0) - (this.key('KeyR', 'PageUp') ? 1 : 0);
    this.zoomVel += (iZ * 1.5 * (this.shift ? 1.8 : 1) - this.zoomVel) * follow(dt, iZ ? 0.12 : 0.18);
    if (Math.abs(this.zoomVel) < 1e-3 && !iZ) this.zoomVel = 0;
    if (this.zoomVel) {
      cam.radius = clamp(cam.radius * Math.exp(this.zoomVel * dt), cam.lowerRadiusLimit ?? 0.1, cam.upperRadiusLimit ?? 1e5);
      this.goalRadius = NaN;
    }
    if (!s) return;
    // follow: chase the subject, keep the orbit
    this.track(dt, s);
    const lead = s.driving ? 0.35 : 0.25;
    const lift = s.driving ? 0.8 : Math.min(1.1, 0.4 + cam.radius * 0.02);
    const px = this.fs.x + this.sv.x * lead, py = this.fs.y + lift, pz = this.fs.z + this.sv.z * lead;
    const kk = follow(dt, s.driving ? 0.14 : 0.22);
    tg.x += (px - tg.x) * kk;
    tg.y += (py - tg.y) * kk;
    tg.z += (pz - tg.z) * kk;
    if (!isNaN(this.goalRadius)) {
      cam.radius += (this.goalRadius - cam.radius) * follow(dt, 0.45);
      if (Math.abs(cam.radius - this.goalRadius) < 0.5) this.goalRadius = NaN;
    }
  }

  // ------------------------------------------------------------- walk

  private enterWalk(prev: CameraMode): void {
    const cam = this.camera;
    this.walkPrev = prev;
    const s = this.lastSubject;
    let yaw = cam.alpha; // view forward = -(cos a, sin a)
    if (s && (prev === 'follow' || prev === 'cinema')) {
      // stand a few meters behind the subject, looking the same way
      const back = s.driving ? 9 : 3.5;
      this.eye.copyFromFloats(s.x - Math.cos(s.heading) * back, 0, s.y - Math.sin(s.heading) * back);
      yaw = s.heading + Math.PI;
    } else this.eye.copyFromFloats(cam.target.x, 0, cam.target.z);
    this.findStandingSpot(this.eye);
    this.eye.y = this.opts.heightAt(this.eye.x, this.eye.z) + EYE;
    cam.fov = 0.9;
    this.setLimits(WALK_R, WALK_R, 0.35, 2.75);
    cam.alpha = yaw;
    cam.beta = Math.PI / 2 - 0.06;
    cam.radius = WALK_R;
    this.vel.setAll(0);
    this.placeWalk();
  }

  private leaveWalk(): void {
    const cam = this.camera;
    const fx = -Math.cos(cam.alpha), fz = -Math.sin(cam.alpha);
    const x = this.eye.x + fx * 18, z = this.eye.z + fz * 18;
    cam.fov = this.freeLimits.fov;
    this.setLimits(this.freeLimits.r0, this.freeLimits.r1, this.freeLimits.b0, this.freeLimits.b1);
    cam.target.copyFromFloats(x, this.opts.heightAt(x, z), z);
    cam.radius = 45;
    cam.beta = 1.05;
    this.vel.setAll(0);
  }

  /** Move a ground point out of buildings (spiral search with downward rays). */
  private findStandingSpot(p: Vector3): void {
    const h = this.opts.heightAt;
    const blocked = (x: number, z: number) => {
      const g = h(x, z);
      this.t1.copyFromFloats(x, g + 0.6, z);
      this.t2.copyFromFloats(x, g + 60, z);
      return !this.lineClear(this.t1, this.t2, null, 0);
    };
    if (!blocked(p.x, p.z)) return;
    for (let r = 3; r <= 45; r += 3) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU + r;
        const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
        if (!blocked(x, z)) { p.x = x; p.z = z; return; }
      }
    }
  }

  private updateWalk(dt: number): void {
    const cam = this.camera;
    const turn = (this.key('ArrowLeft', 'KeyQ') ? 1 : 0) - (this.key('ArrowRight', 'KeyE') ? 1 : 0);
    this.rotVel += (turn * 1.7 - this.rotVel) * follow(dt, 0.1);
    if (!turn && Math.abs(this.rotVel) < 1e-3) this.rotVel = 0;
    cam.alpha += this.rotVel * dt;
    const fx = -Math.cos(cam.alpha), fz = -Math.sin(cam.alpha);
    const rx = fz, rz = -fx;
    const iz = (this.key('KeyW', 'ArrowUp') ? 1 : 0) - (this.key('KeyS', 'ArrowDown') ? 1 : 0);
    const ix = (this.key('KeyD') ? 1 : 0) - (this.key('KeyA') ? 1 : 0);
    const il = Math.hypot(ix, iz) || 1;
    const speed = this.shift ? 6 : 1.9;
    const gx = ((fx * iz + rx * ix) / il) * speed, gz = ((fz * iz + rz * ix) / il) * speed;
    const k = follow(dt, ix || iz ? 0.18 : 0.12);
    this.vel.x += (gx - this.vel.x) * k;
    this.vel.z += (gz - this.vel.z) * k;
    const sx = this.vel.x * dt, sz = this.vel.z * dt;
    if (Math.abs(sx) + Math.abs(sz) > 1e-5) {
      const e = this.eye;
      const tryMove = (mx: number, mz: number): boolean => {
        const l = Math.hypot(mx, mz);
        if (l < 1e-6) return false;
        this.t1.copyFromFloats(e.x, e.y - 0.7, e.z);
        this.t2.copyFromFloats(e.x + (mx / l) * (l + 0.4), e.y - 0.7, e.z + (mz / l) * (l + 0.4));
        if (!this.meshClear(this.t1, this.t2)) return false;
        e.x += mx; e.z += mz;
        return true;
      };
      if (!tryMove(sx, sz) && !tryMove(sx, 0) && !tryMove(0, sz)) this.vel.setAll(0);
    }
    const g = this.opts.heightAt(this.eye.x, this.eye.z) + EYE;
    this.eye.y += (g - this.eye.y) * follow(dt, 0.12);
    this.placeWalk();
  }

  private placeWalk(): void {
    const cam = this.camera;
    const sb = Math.sin(cam.beta);
    cam.radius = WALK_R;
    cam.target.copyFromFloats(
      this.eye.x - WALK_R * Math.cos(cam.alpha) * sb,
      this.eye.y - WALK_R * Math.cos(cam.beta),
      this.eye.z - WALK_R * Math.sin(cam.alpha) * sb,
    );
  }

  /** Mesh-only line test (no terrain), for walking. */
  private meshClear(from: Vector3, to: Vector3): boolean {
    const r = this.ray;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-4) return true;
    this.stats.rays++;
    r.origin.copyFrom(from);
    r.direction.copyFromFloats(dx / L, dy / L, dz / L);
    r.length = L;
    this.refreshNear(from, false);
    for (const m of this.near) {
      if (m.isDisposed() || !m.isEnabled() || !m.isVisible) continue;
      if (r.intersectsMesh(m, true).hit) return false;
    }
    return true;
  }

  // ------------------------------------------------------------- occluders

  /**
   * Cache the occluder meshes near `at` (refreshed when far away or stale).
   * The opened building's own solid meshes (floor slabs, furniture) stay in:
   * its walls are separate ghost meshes that `isOccluder` should reject.
   */
  private refreshNear(at: Vector3, force: boolean): void {
    const R = 110;
    if (!force && this.nearAge < 1 && Math.hypot(at.x - this.nearAt.x, at.z - this.nearAt.z) < 30) return;
    this.nearAt.copyFrom(at);
    this.nearAge = 0;
    const out: AbstractMesh[] = [];
    const isOcc = this.opts.isOccluder;
    for (const m of this.scene.meshes) {
      if (!m.isEnabled() || !m.isVisible || m.getTotalVertices() === 0) continue;
      if (!isOcc(m)) continue;
      const bs = m.getBoundingInfo().boundingSphere;
      const c = bs.centerWorld;
      if (Math.hypot(c.x - at.x, c.z - at.z) > R + bs.radiusWorld) continue;
      out.push(m);
    }
    this.near = out;
  }

  private inFootprint(x: number, z: number, b: CutawayBox, pad: number): boolean {
    const dx = x - b.x, dz = z - b.y;
    const a = Math.cos(b.angle), s = Math.sin(b.angle);
    const along = dx * a + dz * s; // depth axis
    const across = dx * s - dz * a; // width axis
    return Math.abs(along) <= b.d / 2 + pad && Math.abs(across) <= b.w / 2 + pad;
  }

  /** Floor slabs of the opened building between `from` (the subject) and `to`. */
  private slabBlocks(from: Vector3, to: Vector3, b: CutawayBox): boolean {
    const g = b.ground ?? this.opts.heightAt(b.x, b.y);
    const floors = Math.max(1, b.floors), H = b.storey ?? FLOOR_H;
    for (let k = 1; k < floors; k++) {
      const top = g + k * H + 0.15, bottom = top - 0.3;
      for (const hk of [bottom, top]) {
        if ((from.y - hk) * (to.y - hk) >= 0) continue;
        const f = (hk - from.y) / (to.y - from.y);
        const x = from.x + (to.x - from.x) * f, z = from.z + (to.z - from.z) * f;
        if (this.inFootprint(x, z, b, -0.1)) return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------- subject tracking

  private track(dt: number, s: Subject): void {
    this.raw.copyFromFloats(s.x, s.z, s.y);
    const jump = Math.hypot(this.raw.x - this.fs.x, this.raw.z - this.fs.z);
    const expected = Math.hypot(this.sv.x, this.sv.z) * dt * 3 + 2.5;
    if (!this.tracked || jump > 30 || (jump > expected && s.driving === this.wasDriving) || s.driving !== this.wasDriving) {
      // first sight, a teleport, or getting in/out of a vehicle: no smoothing, no stale velocity
      this.fs.copyFrom(this.raw);
      this.sv.setAll(0);
      if (!this.tracked || jump > 30) this.hs = s.heading;
      this.tracked = true;
      this.wasDriving = s.driving;
      return;
    }
    if (dt <= 0) return;
    const k = follow(dt, s.driving ? 0.05 : 0.08);
    const vx = (this.raw.x - this.fs.x) * k / dt, vz = (this.raw.z - this.fs.z) * k / dt;
    const kv = follow(dt, 0.35);
    this.sv.x += (vx - this.sv.x) * kv;
    this.sv.z += (vz - this.sv.z) * kv;
    if (!s.moving) { this.sv.x *= 1 - follow(dt, 0.15); this.sv.z *= 1 - follow(dt, 0.15); }
    this.fs.x += (this.raw.x - this.fs.x) * k;
    if (Math.abs(this.raw.y - this.fs.y) > 1.5) this.fs.y = this.raw.y; // changed floors
    else this.fs.y += (this.raw.y - this.fs.y) * follow(dt, 0.1);
    this.fs.z += (this.raw.z - this.fs.z) * k;
    this.hs += wrap(s.heading - this.hs) * follow(dt, s.driving ? 0.3 : 0.5);
  }

  private category(s: Subject): Cat {
    if (s.driving) return 'drive';
    if (s.inside) return s.cutawayBuilding ? 'inside' : 'closed';
    if (s.moving) return 'walk';
    return s.talking || s.working ? 'talk' : 'stand';
  }

  // ------------------------------------------------------------- cinema

  private updateCinema(dt: number, s: Subject): void {
    this.nearAge += dt;
    this.track(dt, s);
    // events
    const pf = this.prevFlags;
    const hasCut = !!s.cutawayBuilding;
    let ev: string | null = null;
    if (pf.id !== s.id) ev = 'subject';
    else if (pf.driving !== s.driving) ev = s.driving ? 'drive-start' : 'drive-stop';
    else if (pf.inside !== s.inside || pf.cut !== hasCut) ev = s.inside ? 'enter' : 'exit';
    else if (!pf.talking && s.talking) ev = 'talk';
    else if (Math.abs(s.z - pf.z) > 1.5 && !s.driving) ev = 'floor'; // went up/down a floor
    pf.z = s.z;
    pf.id = s.id; pf.driving = s.driving; pf.inside = s.inside; pf.talking = !!s.talking; pf.cut = hasCut;
    if (ev) this.pendingCut = ev;
    const cat = this.category(s);

    const sh = this.shot;
    if (!sh) this.cut(s, this.pendingCut === 'subject' || !this.pendingCut ? 'start' : this.pendingCut);
    else {
      sh.t += dt;
      const pc = this.pendingCut;
      // cut right away when the subject vanished from the shot; otherwise let it breathe a little
      const minAge = pc === 'subject' || pc === 'occluded' || pc === 'floor' ? 0 : !ALLOWED[sh.type].includes(cat) ? 0.3 : 0.8;
      if (this.pendingCut && sh.t > minAge) this.cut(s, this.pendingCut);
      else if (sh.t >= sh.dur) this.cut(s, 'time');
      else if (!ALLOWED[sh.type].includes(cat)) {
        sh.invalid += dt;
        if (sh.invalid > (TOLERANCE[sh.type] ?? 1)) this.cut(s, 'state');
      } else sh.invalid = 0;
    }
    this.applyShot(dt);
    this.monitor(dt, s);
  }

  private cut(s: Subject, reason: string): void {
    this.pendingCut = null;
    const cat = this.category(s);
    const prefer: ShotType[] = [];
    if (reason === 'start' || reason === 'subject') {
      prefer.push(cat === 'drive' ? 'aerial' : cat === 'inside' ? 'inside' : 'wide');
    } else if (reason === 'drive-start') prefer.push(this.rand() < 0.5 ? 'sidecar' : 'chase');
    else if (reason === 'drive-stop' || reason === 'exit') prefer.push('wide');
    else if (reason === 'enter') prefer.push('inside');
    else if (reason === 'talk') prefer.push(this.rand() < 0.5 ? 'ots' : 'closeup');
    // weighted order of the remaining types, never the same twice in a row
    const w = { ...WEIGHTS[cat] };
    const cur = this.shot?.type ?? null;
    const order: ShotType[] = [];
    for (const p of prefer) if (p !== cur && w[p] !== undefined && !order.includes(p)) order.push(p);
    const pool = Object.entries(w).filter(([t]) => t !== cur && !order.includes(t as ShotType)) as [ShotType, number][];
    while (pool.length) {
      let tot = 0;
      for (const [, v] of pool) tot += v;
      let r = this.rand() * tot, i = 0;
      for (; i < pool.length - 1; i++) { r -= pool[i][1]; if (r <= 0) break; }
      order.push(pool[i][0]);
      pool.splice(i, 1);
    }
    if (cur && w[cur] !== undefined) order.push(cur);
    if (!s.cutawayBuilding) order.push('crane');
    let budget = 60;
    const tried: string[] = [];
    for (const type of order) {
      const startRays = this.stats.rays;
      const sh = this.findShot(type, s, type === 'crane' && order.indexOf(type) === order.length - 1);
      budget -= this.stats.rays - startRays;
      tried.push(`${type}:${this.stats.rays - startRays}${sh ? '+' : '-'}`);
      this.lastCut = `${reason} ${cat} ${tried.join(' ')}`;
      if (sh) { this.startShot(sh, reason); return; }
      if (budget <= 0) break;
    }
    this.lastCut += ' fallback';
    this.startShot(this.findShot(s.cutawayBuilding ? 'insideClose' : 'crane', s, true) ?? this.findShot('crane', s, true)!, reason);
  }

  private startShot(sh: Shot, reason: string): void {
    this.shot = sh;
    this.snap = true;
    this.monitorClock = 0;
    this.stats.cuts++;
    this.camera.fov = sh.fov;
    this.setCaption(CAPTION[sh.type]);
    this.onShot(sh.type, reason);
  }

  private newShot(type: ShotType, s: Subject): Shot {
    const r = this.rand;
    const [d0, d1] = DURATION[type];
    return {
      type, t: 0, dur: d0 + r() * (d1 - d0), side: r() < 0.5 ? -1 : 1, az: 0, dist0: 5, dist1: 5, h0: 1.6, h1: 1.6,
      fov: 0.8, focus: s.driving ? 0.8 : 1.3, u: 0.25, v: 0.1, posTau: 0.5, aimTau: 0.25, lockHeading: false,
      heading0: s.partner && !s.moving ? Math.atan2(s.partner.y - s.y, s.partner.x - s.x) : this.hs, orbit: 0, anchor: null, pivot: null, truck: null, boost: 0, boostGoal: 0, blocked: 0, invalid: 0, lost: 0,
    };
  }

  /** Candidate parameter sets for a shot type, best first. */
  private variants(type: ShotType, s: Subject): Shot[] {
    const r = this.rand;
    const out: Shot[] = [];
    const mk = (f: (sh: Shot) => void) => { const sh = this.newShot(type, s); f(sh); out.push(sh); };
    const sides = r() < 0.5 ? [1, -1] : [-1, 1];
    const fs = this.fs;
    const talk = !!(s.talking || s.partner);
    switch (type) {
      case 'track':
        for (const side of sides) for (const j of [0, 0.35]) mk((sh) => {
          sh.side = side; sh.az = Math.PI + side * (0.32 + j); sh.dist0 = 5.6; sh.dist1 = 4.6; sh.h0 = 2.2; sh.h1 = 1.95;
          sh.focus = 1.45; sh.u = 0.22; sh.v = 0.22; sh.posTau = 0.55; sh.aimTau = 0.22; sh.fov = 0.75;
        });
        break;
      case 'side':
        for (const side of sides) for (const j of [0, -0.3, 0.3]) mk((sh) => {
          sh.side = side; sh.az = side * (Math.PI / 2 + j); sh.dist0 = 6.6; sh.dist1 = 5.4; sh.h0 = 1.55; sh.h1 = 1.6;
          sh.focus = 1.35; sh.u = 0.3; sh.v = 0.15; sh.posTau = 0.45; sh.aimTau = 0.2; sh.fov = 0.7; sh.lockHeading = !s.moving;
        });
        break;
      case 'lead':
        for (const side of sides) mk((sh) => {
          sh.side = side; sh.az = side * 0.22; sh.dist0 = 5.2; sh.dist1 = 4.3; sh.h0 = 1.55; sh.h1 = 1.5;
          sh.focus = 1.45; sh.u = 0.12; sh.v = 0.2; sh.posTau = 0.35; sh.aimTau = 0.18; sh.fov = 0.7;
        });
        break;
      case 'ots':
        for (const side of sides) mk((sh) => {
          sh.side = side; sh.az = Math.PI + side * 0.12; sh.dist0 = 1.5; sh.dist1 = 1.3; sh.h0 = 1.72; sh.h1 = 1.7;
          sh.focus = 1.45; sh.u = 0; sh.v = 0; sh.posTau = 0.35; sh.aimTau = 0.3; sh.fov = 0.7; sh.lockHeading = !s.moving;
        });
        break;
      case 'mcu':
        // in a conversation, stand off to the side so the other person isn't in the way
        for (const side of sides) for (const j of talk ? [0.85, 1.05, 0.7] : [0.45, 0.75, 0.2]) mk((sh) => {
          sh.side = side; sh.az = side * j; sh.dist0 = 3.0; sh.dist1 = 2.7; sh.h0 = 1.58; sh.h1 = 1.56;
          sh.focus = 1.6; sh.u = 0.28; sh.v = 0.3; sh.posTau = 0.6; sh.aimTau = 0.3; sh.fov = 0.55; sh.lockHeading = true;
        });
        break;
      case 'closeup':
        for (const side of sides) for (const j of talk ? [0.8, 1.0, 0.65] : [0.35, 0.6, 0.15]) mk((sh) => {
          sh.side = side; sh.az = side * j; sh.dist0 = 2.15; sh.dist1 = 1.95; sh.h0 = 1.63; sh.h1 = 1.62;
          sh.focus = 1.62; sh.u = 0.26; sh.v = 0.28; sh.posTau = 0.6; sh.aimTau = 0.3; sh.fov = 0.42; sh.lockHeading = true;
        });
        break;
      case 'hero':
        for (const side of sides) for (const j of [0.55, 0.9, 0.3]) mk((sh) => {
          sh.side = side; sh.az = side * j; sh.dist0 = 3.9; sh.dist1 = 3.3; sh.h0 = 0.45; sh.h1 = 0.4;
          sh.focus = 1.55; sh.u = 0.2; sh.v = 0.18; sh.posTau = 0.45; sh.aimTau = 0.25; sh.fov = 0.9;
          sh.orbit = -side * 0.05; sh.lockHeading = !s.moving;
        });
        break;
      case 'wide':
        for (const a of [0.7, 1.3, 2.3, 0.4, Math.PI, 1.9]) for (const side of sides) mk((sh) => {
          const D = 26 + r() * 12, el = 0.2 + r() * 0.2;
          const ang = this.hs + side * a;
          sh.side = side;
          sh.anchor = new Vector3(fs.x + Math.cos(ang) * D, fs.y + 1 + Math.tan(el) * D, fs.z + Math.sin(ang) * D);
          // slide sideways while panning with the subject
          const tr = (r() < 0.5 ? -1 : 1) * D * 0.14;
          sh.truck = new Vector3(-Math.sin(ang) * tr, r() * 2, Math.cos(ang) * tr);
          sh.dist0 = sh.dist1 = D;
          sh.focus = 1.0; sh.u = 0.25; sh.v = -0.05; sh.posTau = 0.6; sh.aimTau = 0.5; sh.fov = 0.8;
        });
        break;
      case 'chase':
        for (const j of [0, 0.15, -0.15]) mk((sh) => {
          sh.az = Math.PI + j; sh.dist0 = 9.5; sh.dist1 = 8.5; sh.h0 = 3.3; sh.h1 = 2.9; sh.focus = 0.8;
          sh.posTau = 0.3; sh.aimTau = 0.15; sh.fov = 0.85;
        });
        break;
      case 'sidecar':
        for (const side of sides) mk((sh) => {
          sh.side = side; sh.az = side * (Math.PI / 2 - 0.35); sh.dist0 = 10.5; sh.dist1 = 8.8; sh.h0 = 1.5; sh.h1 = 1.7;
          sh.focus = 0.8; sh.u = 0.22; sh.v = -0.12; sh.posTau = 0.22; sh.aimTau = 0.12; sh.fov = 0.7;
        });
        break;
      case 'aerial':
        for (const side of sides) mk((sh) => {
          sh.side = side; sh.az = Math.PI + side * 0.5; sh.dist0 = 24; sh.dist1 = 30; sh.h0 = 18; sh.h1 = 23;
          sh.focus = 0.8; sh.u = 0.15; sh.v = -0.05; sh.posTau = 0.9; sh.aimTau = 0.35; sh.fov = 0.8;
        });
        break;
      case 'driveby': {
        const sp = Math.hypot(this.sv.x, this.sv.z);
        if (sp < 3) break;
        const fx = this.sv.x / sp, fz = this.sv.z / sp;
        for (const side of sides) for (const ahead of [2.6, 1.8]) mk((sh) => {
          sh.side = side;
          const px = fs.x + this.sv.x * ahead + -fz * side * 6.5, pz = fs.z + this.sv.z * ahead + fx * side * 6.5;
          sh.anchor = new Vector3(px, this.opts.heightAt(px, pz) + 0.8, pz);
          sh.dist0 = sh.dist1 = Math.hypot(sp * ahead, 6.5);
          sh.focus = 0.8; sh.u = 0.15; sh.v = 0; sh.posTau = 0.5; sh.aimTau = 0.07; sh.fov = 0.75;
        });
        break;
      }
      case 'inside':
      case 'insideClose': {
        const b = s.cutawayBuilding;
        if (!b) break;
        const close = type === 'insideClose';
        const els = close ? [0.32, 0.22, 0.12, 0.45] : [0.95, 0.72, 0.52, 0.36, 0.24, 0.12];
        const base = b.angle + Math.PI / 4 + (r() - 0.5) * 0.4;
        const azs: number[] = [];
        for (let k = 0; k < 8; k++) azs.push(base + ((k * 3) % 8) * (Math.PI / 4)); // diagonals first, spread out
        const half = Math.hypot(b.w, b.d) / 2;
        const start = out.length;
        for (const el of els) for (const a of azs) mk((sh) => {
          const ca = Math.cos(a), sa = Math.sin(a);
          const exit = this.exitDistance(fs.x, fs.z, ca, sa, b);
          const D = close ? exit + 3.5 : exit + Math.max(4.5, half * 0.55);
          const H = D * Math.tan(el);
          sh.anchor = new Vector3(fs.x + ca * D, fs.y + 1.2 + H, fs.z + sa * D);
          sh.pivot = new Vector3(b.x, 0, b.y);
          sh.orbit = (r() < 0.5 ? -1 : 1) * (close ? 0.03 : 0.025);
          sh.dist0 = sh.dist1 = Math.hypot(D, H);
          sh.focus = 1.2; sh.u = close ? 0.18 : 0.08; sh.v = 0; sh.posTau = 0.8; sh.aimTau = 0.45;
          sh.fov = close ? 0.65 : 0.75;
        });
        // prefer cameras that see most of the subject's floor past the slabs above (stable sort)
        const g = b.ground ?? this.opts.heightAt(b.x, b.y);
        const H = b.storey ?? FLOOR_H;
        const eyeY = g + 0.15 + Math.max(0, Math.round((fs.y - g - 0.15) / H)) * H + 1.5;
        const grid: Vector3[] = [];
        for (const fl of [-0.5, 0, 0.5]) for (const fw of [-0.5, 0, 0.5]) {
          const p = new Vector3(b.x + Math.cos(b.angle) * fl * (b.d - 3) + Math.sin(b.angle) * fw * (b.w - 3), eyeY,
            b.y + Math.sin(b.angle) * fl * (b.d - 3) - Math.cos(b.angle) * fw * (b.w - 3));
          grid.push(p);
        }
        const cam = new Vector3();
        const score = out.slice(start).map((sh, i) => {
          this.rigPos(sh, cam, fs, this.hs);
          let n = 0;
          for (const p of grid) if (!this.slabBlocks(p, cam, b)) n++;
          return { sh, n, i };
        });
        score.sort((p, q) => q.n - p.n || p.i - q.i);
        out.length = start;
        for (const e of score) out.push(e.sh);
        break;
      }
      case 'crane':
        for (const a of [0, 2.1, 4.2]) mk((sh) => {
          sh.az = this.hs + a; sh.lockHeading = true; sh.heading0 = 0; sh.dist0 = 7; sh.dist1 = 6; sh.h0 = 24; sh.h1 = 20;
          sh.focus = 0.5; sh.u = 0; sh.v = 0; sh.posTau = 1; sh.aimTau = 0.4; sh.fov = 0.8;
        });
        break;
    }
    return out;
  }

  /** Horizontal distance from (x, z) to the footprint's boundary along (dx, dz). */
  private exitDistance(x: number, z: number, dx: number, dz: number, b: CutawayBox): number {
    const a = Math.cos(b.angle), s = Math.sin(b.angle);
    const pl = (x - b.x) * a + (z - b.y) * s, pw = (x - b.x) * s - (z - b.y) * a;
    const dl = dx * a + dz * s, dw = dx * s - dz * a;
    let t = Infinity;
    const slab = (p: number, d: number, h: number) => {
      if (Math.abs(d) < 1e-6) return;
      const tt = ((d > 0 ? h : -h) - p) / d;
      if (tt >= 0) t = Math.min(t, tt);
    };
    slab(pl, dl, b.d / 2);
    slab(pw, dw, b.w / 2);
    return isFinite(t) ? t : 0;
  }

  /** Would the conversation partner's head/body stand in the line of sight? */
  private partnerBlocks(s: Subject, from: Vector3, to: Vector3): boolean {
    const p = s.partner!;
    const py = (p.z ?? s.z) + 1.35;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const L2 = dx * dx + dy * dy + dz * dz || 1;
    const t = clamp(((p.x - from.x) * dx + (py - from.y) * dy + (p.y - from.z) * dz) / L2, 0, 1);
    const ex = from.x + dx * t - p.x, ey = from.y + dy * t - py, ez = from.z + dz * t - p.y;
    return t > 0.05 && Math.hypot(ex, ez) < 0.45 && Math.abs(ey) < 0.6;
  }

  /** Move a point (Babylon coords) into the footprint, `inset` meters from its walls. */
  private clampInto(p: Vector3, b: CutawayBox, inset: number): void {
    const a = Math.cos(b.angle), s = Math.sin(b.angle);
    const dx = p.x - b.x, dz = p.z - b.y;
    const l = clamp(dx * a + dz * s, -b.d / 2 + inset, b.d / 2 - inset);
    const w = clamp(dx * s - dz * a, -b.w / 2 + inset, b.w / 2 - inset);
    p.x = b.x + a * l + s * w;
    p.z = b.y + s * l - a * w;
  }

  /** The first variant (plus raised / pulled-in fallbacks) that sees the subject. */
  private findShot(type: ShotType, s: Subject, force: boolean): Shot | null {
    const vs = this.variants(type, s);
    if (!vs.length) return null;
    const cut = s.cutawayBuilding ?? null;
    const head = this.t3, chest = this.t4;
    const pos = new Vector3();
    const center = new Vector3();
    if (cut) {
      // the middle of the subject's floor should be visible too (they walk around in there)
      const g = cut.ground ?? this.opts.heightAt(cut.x, cut.y);
      const H = cut.storey ?? FLOOR_H;
      const floor = Math.max(0, Math.round((this.fs.y - g - 0.15) / H));
      center.copyFromFloats(cut.x, g + 0.15 + floor * H + 1.2, cut.y);
    }
    const fut = new Vector3();
    const speed = Math.hypot(this.sv.x, this.sv.z);
    /** 0 = blocked now, 1 = clear now, 2 = clear now and in a few seconds. */
    const tryShot = (sh: Shot): number => {
      head.copyFromFloats(this.fs.x, this.fs.y + sh.focus + (s.driving ? 0.5 : 0.25), this.fs.z);
      chest.copyFromFloats(this.fs.x, this.fs.y + Math.max(0.6, sh.focus - 0.5), this.fs.z);
      this.rigPos(sh, pos, this.fs, this.hs);
      this.groundClamp(pos, sh);
      // cheap analytic test first (no ray): the opened building's floor slabs
      if (cut && (this.slabBlocks(head, pos, cut) || this.slabBlocks(center, pos, cut))) return 0;
      if (s.partner && sh.type !== 'ots' && this.partnerBlocks(s, head, pos)) return 0;
      if (!this.lineClear(head, pos, cut)) return 0;
      if (!this.lineClear(chest, pos, cut)) return 0;
      // where the subject (and a moving rig) will be in a few seconds
      if (s.moving && speed > 0.5) {
        const keepT = sh.t;
        const horizons = s.driving ? [Math.min(1.2, sh.dur * 0.3)] : [Math.min(1.5, sh.dur * 0.3), Math.min(3.5, sh.dur * 0.6)];
        for (const ahead of horizons) {
          fut.copyFromFloats(this.fs.x + this.sv.x * ahead, this.fs.y, this.fs.z + this.sv.z * ahead);
          if (cut) this.clampInto(fut, cut, 1);
          sh.t = ahead;
          this.rigPos(sh, pos, fut, this.hs);
          this.groundClamp(pos, sh);
          head.x = fut.x; head.z = fut.z;
          const ok = !(cut && this.slabBlocks(head, pos, cut)) && this.lineClear(head, pos, cut);
          if (!ok) { sh.t = keepT; return 1; }
        }
        sh.t = keepT;
      }
      return 2;
    };
    let rays = 0;
    let ok: Shot | null = null;
    const start = this.stats.rays;
    for (const sh of vs) {
      const q = tryShot(sh);
      if (q === 2) return sh;
      if (q === 1 && !ok) ok = sh;
      rays = this.stats.rays - start;
      if (rays > 36) break;
    }
    if (ok) return ok;
    // fallbacks: raise the camera, then pull it in
    if (type !== 'closeup' && type !== 'mcu' && type !== 'ots' && type !== 'inside' && type !== 'insideClose') {
      for (const f of [{ up: 4, k: 1 }, { up: 0, k: 0.6 }, { up: 8, k: 0.75 }]) {
        const sh = vs[0];
        sh.h0 += f.up; sh.h1 += f.up; sh.dist0 *= f.k; sh.dist1 *= f.k;
        if (sh.anchor) {
          sh.anchor.y += f.up;
          if (f.k !== 1) {
            sh.anchor.x = this.fs.x + (sh.anchor.x - this.fs.x) * f.k;
            sh.anchor.z = this.fs.z + (sh.anchor.z - this.fs.z) * f.k;
          }
        }
        if (tryShot(sh)) return sh;
        if (this.stats.rays - start > 52) break;
      }
    }
    return force ? vs[0] : null;
  }

  /** The rig's camera position at the shot's current time, around feet point `base`. */
  private rigPos(sh: Shot, out: Vector3, base: Vector3, hs: number): void {
    const e = ease(sh.t / sh.dur);
    if (sh.anchor) {
      out.copyFrom(sh.anchor);
      if (sh.pivot && sh.orbit) {
        const a = sh.orbit * sh.t, c = Math.cos(a), s = Math.sin(a);
        const dx = out.x - sh.pivot.x, dz = out.z - sh.pivot.z;
        out.x = sh.pivot.x + dx * c - dz * s;
        out.z = sh.pivot.z + dx * s + dz * c;
      }
      if (sh.truck) { out.x += sh.truck.x * e; out.y += sh.truck.y * e; out.z += sh.truck.z * e; }
      out.y += sh.boost;
      return;
    }
    const dist = sh.dist0 + (sh.dist1 - sh.dist0) * e;
    const h = sh.h0 + (sh.h1 - sh.h0) * e;
    const ref = sh.lockHeading ? sh.heading0 : hs;
    const a = sh.type === 'crane' ? sh.az : ref + sh.az + sh.orbit * sh.t;
    out.copyFromFloats(base.x + Math.cos(a) * dist, base.y + h + sh.boost, base.z + Math.sin(a) * dist);
    if (sh.type === 'ots') {
      // beside the shoulder: the subject's right is (sin h, -cos h)
      out.x += Math.sin(ref) * sh.side * 0.55;
      out.z += -Math.cos(ref) * sh.side * 0.55;
    }
  }

  private groundClamp(p: Vector3, sh: Shot | null): void {
    const min = sh && (sh.type === 'hero' || sh.type === 'driveby') ? 0.3 : 0.8;
    const g = this.opts.heightAt(p.x, p.z) + min;
    if (p.y < g) p.y = g;
  }

  private applyShot(dt: number): void {
    const sh = this.shot!;
    const want = this.t1;
    sh.boost += (sh.boostGoal - sh.boost) * follow(dt, 0.6);
    this.rigPos(sh, want, this.fs, this.hs);
    this.groundClamp(want, sh);
    const pos = this.camPos;
    if (this.snap) {
      pos.copyFrom(want);
      this.off.copyFrom(want).subtractInPlace(this.fs);
    } else if (sh.anchor) {
      pos.addInPlace(want.subtractInPlace(pos).scaleInPlace(follow(dt, sh.posTau)));
    } else {
      // damp the offset from the subject: smooth swings, no translational lag
      const k = follow(dt, sh.posTau);
      this.off.x += (want.x - this.fs.x - this.off.x) * k;
      this.off.y += (want.y - this.fs.y - this.off.y) * k;
      this.off.z += (want.z - this.fs.z - this.off.z) * k;
      pos.copyFrom(this.fs).addInPlace(this.off);
    }
    this.groundClamp(pos, sh);

    // what to look at
    const goal = this.t2;
    const fwdX = Math.cos(this.hs), fwdZ = Math.sin(this.hs);
    const pt = this.lastSubject?.partner;
    if (sh.type === 'ots' && pt && !this.lastSubject?.moving) {
      // over the shoulder onto the other person's face
      goal.copyFromFloats(pt.x, (pt.z ?? this.fs.y) + 1.5, pt.y);
    } else if (sh.type === 'ots') {
      const ref = sh.lockHeading ? sh.heading0 : this.hs;
      goal.copyFromFloats(this.fs.x + Math.cos(ref) * 4 - Math.sin(ref) * sh.side * 0.35, this.fs.y + 1.45, this.fs.z + Math.sin(ref) * 4 + Math.cos(ref) * sh.side * 0.35);
    } else if (sh.type === 'chase') {
      goal.copyFromFloats(this.fs.x + fwdX * 7, this.fs.y + 1.0, this.fs.z + fwdZ * 7);
    } else if (sh.type === 'aerial') {
      goal.copyFromFloats(this.fs.x + fwdX * 8, this.fs.y + 0.5, this.fs.z + fwdZ * 8);
    } else {
      // rule of thirds: put the focus point at (u, v) on screen, with looking room
      const fx = this.fs.x, fy = this.fs.y + sh.focus, fz = this.fs.z;
      let dx = fx - pos.x, dy = fy - pos.y, dz = fz - pos.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      dx /= d; dy /= d; dz /= d;
      let rx = dz, rz = -dx; // up x forward
      const rl = Math.hypot(rx, rz) || 1;
      rx /= rl; rz /= rl;
      // camera up = forward x right
      const cux = dy * rz, cuy = dz * rx - dx * rz, cuz = -dy * rx;
      const tanH = Math.tan(sh.fov / 2);
      const aspect = this.scene.getEngine().getAspectRatio(this.camera);
      const halfH = d * tanH * this.visFrac, halfW = d * tanH * aspect;
      const face = fwdX * rx + fwdZ * rz; // subject faces screen-right if > 0
      const sgn = Math.abs(face) > 0.2 ? Math.sign(face) : -sh.side;
      const u = -sgn * sh.u * (0.4 + 0.6 * Math.min(1, Math.abs(face) * 1.6 + 0.3));
      goal.copyFromFloats(
        fx - rx * u * halfW - cux * sh.v * halfH,
        fy - cuy * sh.v * halfH,
        fz - rz * u * halfW - cuz * sh.v * halfH,
      );
    }
    if (this.snap) this.aim.copyFrom(goal);
    else this.aim.addInPlace(goal.subtractInPlace(this.aim).scaleInPlace(follow(dt, sh.aimTau)));
    this.snap = false;
    this.place(pos, this.aim);
  }

  /** Every 0.15 s: is the subject still visible? Raise the camera, then cut away. */
  private monitor(dt: number, s: Subject): void {
    const sh = this.shot;
    if (!sh) return;
    this.monitorClock += dt;
    const every = 0.15;
    if (this.monitorClock < every) return;
    this.monitorClock = 0;
    this.monitorFlip = !this.monitorFlip;
    const p = this.t3.copyFromFloats(this.fs.x, this.fs.y + (this.monitorFlip ? sh.focus + 0.2 : Math.max(0.6, sh.focus - 0.5)), this.fs.z);
    const ok = this.lineClear(p, this.camPos, s.cutawayBuilding ?? null);
    this.stats.samples++;
    if (!ok) {
      this.stats.blockedSamples++;
      const inside = sh.type === 'inside' || sh.type === 'insideClose';
      sh.blocked += every;
      const lift = !inside && sh.type !== 'closeup' && sh.type !== 'mcu' && sh.type !== 'ots';
      if (lift && sh.boostGoal < 8) sh.boostGoal += 3;
      if (sh.blocked >= (inside ? every : 2 * every) - 1e-6) this.pendingCut = 'occluded';
    } else sh.blocked = 0;
    // anchored shots lose the subject when it walks away
    if (sh.anchor) {
      const d = Math.hypot(this.fs.x - this.camPos.x, this.fs.z - this.camPos.z);
      // a drive-by is over once the car is well past the camera
      const along = (this.fs.x - this.camPos.x) * this.sv.x + (this.fs.z - this.camPos.z) * this.sv.z;
      const passed = sh.type === 'driveby' && along > 0 && d > 20;
      if (passed || (sh.type !== 'driveby' && d > sh.dist0 * 2.2 + 6) || d > 80) this.pendingCut = 'lost';
    }
  }

  private place(pos: Vector3, aim: Vector3): void {
    const cam = this.camera;
    cam.target.copyFrom(aim);
    const dx = pos.x - aim.x, dy = pos.y - aim.y, dz = pos.z - aim.z;
    const r = Math.max(0.05, Math.hypot(dx, dy, dz));
    let a = Math.atan2(dz, dx);
    a += Math.round((cam.alpha - a) / TAU) * TAU;
    cam.alpha = a;
    cam.beta = Math.acos(clamp(dy / r, -1, 1));
    cam.radius = r;
  }

  // ------------------------------------------------------------- overlay

  private ensureOverlay(): void {
    if (this.bars.length) return;
    const parent = this.opts.overlayParent ?? document.body;
    for (const top of [true, false]) {
      const b = document.createElement('div');
      b.className = 'cine-bar';
      Object.assign(b.style, {
        position: 'fixed', left: '0', right: '0', [top ? 'top' : 'bottom']: '0', height: '0px', background: '#000',
        zIndex: '1', pointerEvents: 'none', transition: 'transform 0.7s cubic-bezier(.3,.7,.2,1)',
        transform: top ? 'translateY(-100%)' : 'translateY(100%)',
      } as Partial<CSSStyleDeclaration>);
      parent.appendChild(b);
      this.bars.push(b);
    }
    const c = document.createElement('div');
    c.className = 'cine-caption';
    Object.assign(c.style, {
      position: 'fixed', left: '28px', bottom: '0px', zIndex: '1', pointerEvents: 'none', color: '#e8e8e8',
      font: '600 11px/1 system-ui, sans-serif', letterSpacing: '0.22em', textTransform: 'uppercase',
      opacity: '0', transition: 'opacity 0.6s ease', textShadow: '0 1px 2px #000',
    } as Partial<CSSStyleDeclaration>);
    parent.appendChild(c);
    this.captionEl = c;
    this.layoutBars();
  }

  private barHeight(): number {
    const W = window.innerWidth, H = window.innerHeight;
    return Math.round(clamp((H - W / LETTERBOX) / 2, H * 0.04, H * 0.16));
  }

  private layoutBars(): void {
    if (!this.bars.length) return;
    const bh = this.barHeight();
    for (const b of this.bars) b.style.height = `${bh}px`;
    if (this.captionEl) this.captionEl.style.bottom = this._letterbox ? `${Math.max(8, bh / 2 - 5)}px` : '16px';
    this.visFrac = this._mode === 'cinema' && this._letterbox ? 1 - (2 * bh) / window.innerHeight : 1;
  }

  private showOverlay(on: boolean): void {
    if (on) this.ensureOverlay();
    if (!this.bars.length) return;
    const bars = on && this._letterbox;
    this.bars[0].style.transform = bars ? 'translateY(0)' : 'translateY(-100%)';
    this.bars[1].style.transform = bars ? 'translateY(0)' : 'translateY(100%)';
    if (this.captionEl) {
      this.captionEl.style.display = on && this._captions ? 'block' : 'none';
      if (!on) this.captionEl.style.opacity = '0';
    }
    this.layoutBars();
    if (!on) this.visFrac = 1;
  }

  private setCaption(text: string): void {
    const c = this.captionEl;
    if (!c || !this._captions) return;
    c.textContent = text;
    c.style.opacity = '1';
    this.captionTimer = 2.2;
  }
}
