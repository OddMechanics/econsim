// How the road network grows: streets vs country roads, lots per zone.
import { makeCtx } from '../src/sim/ctx';
import { createState } from '../src/sim/sim';
import { growRoads, lotFail } from '../src/sim/roads';
const s = createState(Number(process.argv[2] ?? 7));
const ctx = makeCtx(s);
const t0 = performance.now();
for (let i = 0; i < 400; i++) growRoads(ctx, (['core', 'urban', 'urban', 'suburb', 'industrial', 'rural'] as const)[i % 6], 25);
const kinds: Record<string, number> = {};
for (const e of s.roads.edges) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
const zones: Record<string, number> = {};
for (const l of s.roads.lots) zones[l.zone] = (zones[l.zone] ?? 0) + 1;
console.log(`${((performance.now() - t0) / 1000).toFixed(1)}s edges`, kinds, 'lots', zones, lotFail, 'plan left', s.roads.plan.filter((p) => !p.done).length, 'of', s.roads.plan.length);
