import './ui/styles.css';
import { AUTOSAVE_SECONDS, NIGHT } from './sim/config';
import { dayOf, formatTime, isNight } from './sim/ctx';
import { deserialize, serialize } from './sim/save';
import { createState, Simulation } from './sim/sim';
import { WorldRenderer } from './render/renderer';
import { downloadFile, getSave, pickFile, putSave } from './ui/storage';
import { UI, type ViewMode } from './ui/ui';

const AUTOSAVE_KEY = 'autosave-v4';
const TICK_SECONDS = 60; // one tick is one game minute
const FRAME_BUDGET_MS = 24; // per frame, for the simulation
const FAST_BUDGET_MS = 150; // per frame while skipping ahead or with the 3D view off (the panels redraw ~6×/s)
const PEEK_MS = 1000; // while skipping with the view on, draw the city once a second

async function start(): Promise<void> {
  // resume the last world if there is one, so a forgotten save isn't lost
  let sim: Simulation;
  let resumed = false;
  const saved = await getSave(AUTOSAVE_KEY);
  try {
    sim = new Simulation(saved ? deserialize(saved) : createState(randomSeed()));
    resumed = !!saved;
  } catch {
    sim = new Simulation(createState(randomSeed()));
  }

  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const renderer = new WorldRenderer(canvas, sim);
  let speed = 600;
  let acc = 0;
  let lastAutosave = performance.now();
  // speed modes: skip ahead to a tick (nothing drawn but a glimpse each second),
  // and how much of the 3D view to draw at all
  let skip: { from: number; to: number } | null = null;
  let view: ViewMode = 'full';
  let rate = 0; // game minutes per real second, smoothed
  let lastPeek = 0;

  const autosave = async () => {
    lastAutosave = performance.now();
    if (await putSave(AUTOSAVE_KEY, serialize(sim.state))) ui.markSaved();
  };
  const swap = (next: Simulation) => {
    sim = next;
    acc = 0;
    skip = null;
    renderer.setSim(next);
    ui.setSim(next);
    void autosave();
  };

  const ui = new UI(sim, renderer, {
    setSpeed: (m) => { speed = m; },
    skipTo: (tick) => {
      if (tick <= sim.tick) {
        if (skip) ui.toast(`Stopped at ${formatTime(sim.tick)}.`);
        skip = null;
      } else skip = { from: sim.tick, to: tick };
    },
    setView: (m) => {
      view = m;
      renderer.showMovers = m === 'full';
      canvas.style.visibility = m === 'none' ? 'hidden' : '';
    },
    save: () => downloadFile(`econsim-day-${dayOf(sim.tick) + 1}.json`, serialize(sim.state)),
    load: async () => {
      const text = await pickFile();
      if (!text) return;
      try {
        swap(new Simulation(deserialize(text)));
        ui.toast(`Loaded a world at day ${dayOf(sim.tick) + 1}.`);
      } catch (e) {
        ui.toast(String((e as Error).message));
      }
    },
    newWorld: () => {
      if (!confirm('Start a new world? The current one is kept only if you saved it to a file.')) return;
      swap(new Simulation(createState(randomSeed())));
      ui.toast('A new group of settlers arrived.');
    },
  });
  (window as unknown as { __econsim: unknown }).__econsim = { renderer, ui, get sim() { return sim; } };
  if (resumed) ui.toast(`Resumed your world from day ${dayOf(sim.tick) + 1} (autosave).`);

  renderer.engine.runRenderLoop(() => {
    const dt = Math.min(0.25, renderer.engine.getDeltaTime() / 1000);
    const t0 = performance.now();
    // nights pass much faster than days (a user request)
    const effective = speed * (isNight(sim.tick) ? NIGHT.speedup : 1);
    const tick0 = sim.tick;
    if (skip || view === 'none') {
      // nothing to draw, so run flat out (unless paused while just viewing without 3D)
      if (skip || speed > 0) {
        const end = skip?.to ?? Infinity;
        while (performance.now() - t0 < FAST_BUDGET_MS && sim.tick < end) sim.step();
      }
      acc = 0;
      const ran = sim.tick - tick0;
      rate = rate * 0.9 + (ran / Math.max(0.001, dt)) * 0.1;
      if (skip && sim.tick >= skip.to) {
        ui.toast(`Skipped ahead to ${formatTime(sim.tick)}.`);
        skip = null;
      }
      ui.setRunOverlay(skip || view === 'none' ? { skip: skip ?? undefined, noView: view === 'none', rate } : null);
      if (view !== 'none' && performance.now() - lastPeek > PEEK_MS) {
        lastPeek = performance.now();
        renderer.render(1, dt, 3600);
      }
      ui.update();
      if (performance.now() - lastAutosave > AUTOSAVE_SECONDS * 1000) void autosave();
      return;
    }
    ui.setRunOverlay(null);
    if (speed === Infinity) {
      while (performance.now() - t0 < FRAME_BUDGET_MS) for (let i = 0; i < 10; i++) sim.step();
      acc = 0;
    } else if (speed > 0) {
      acc += (dt * effective) / TICK_SECONDS;
      while (acc >= 1 && performance.now() - t0 < FRAME_BUDGET_MS) {
        sim.step();
        acc -= 1;
      }
      if (acc > 3) acc = 1; // can't keep up: slow down rather than stutter
    }
    renderer.perf.sim = (renderer.perf.sim ?? 0) * 0.9 + (performance.now() - t0) * 0.1;
    const alpha = speed === Infinity || effective >= 600 ? 1 : Math.min(1, acc);
    renderer.render(alpha, dt, speed === Infinity ? 3600 : effective);
    ui.update();
    if (performance.now() - lastAutosave > AUTOSAVE_SECONDS * 1000) void autosave();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void autosave();
  });
  window.addEventListener('pagehide', () => void autosave());
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

void start();
