// Bench for the HTML UI (src/ui/*): mounts the real panels against a sim
// state, with a stand-in for the 3D renderer. Open /dev/ui.html on the dev
// server. ?days=N runs a fresh world first; window.__load(json) loads a save.
// window.__ui / window.__sim are there for scripted screenshots.

import '../src/ui/styles.css';
import { MINUTES_PER_DAY } from '../src/sim/config';
import { deserialize, SAVE_FORMAT } from '../src/sim/save';
import { createState, Simulation } from '../src/sim/sim';
import { UI } from '../src/ui/ui';
import type { WorldRenderer } from '../src/render/renderer';

const q = new URLSearchParams(location.search);

/** Just what the UI touches on the renderer. */
function fakeRenderer(): WorldRenderer {
  const r = {
    selection: null, follow: false, ownership: false, politicsMap: false, cutaway: null, perf: {},
    camera: { radius: 120 },
    cam: { mode: 'free', toggleCinema() {}, setMode() {} },
    onPick() {}, onCameraMode() {}, focusOn() {}, refreshOwnership() {}, setSim() {}, render() {},
  };
  return r as unknown as WorldRenderer;
}

let sim = new Simulation(createState(Number(q.get('seed') ?? 4242)));
const days = Number(q.get('days') ?? 0);
for (let i = 0; i < days * MINUTES_PER_DAY; i++) sim.step();
const renderer = fakeRenderer();
const ui = new UI(sim, renderer, { setSpeed() {}, save() {}, load() {}, newWorld() {} });
ui.setSpeed(0);
const run = q.get('run') === '1';
const frame = () => {
  if (run) sim.step();
  ui.update();
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);

const w = window as unknown as Record<string, unknown>;
w.__ui = ui;
w.__renderer = renderer;
Object.defineProperty(w, '__sim', { get: () => sim });
w.__load = (json: string) => {
  // a bench: accept saves from a slightly older format (the sim changes while the UI is worked on)
  const data = JSON.parse(json) as { format: number };
  data.format = SAVE_FORMAT;
  sim = new Simulation(deserialize(JSON.stringify(data)));
  ui.setSim(sim);
  return { day: Math.floor(sim.state.tick / MINUTES_PER_DAY) + 1, people: sim.state.people.length };
};
