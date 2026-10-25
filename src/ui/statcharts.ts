// Charts for the statistics window. Same rules as charts.ts: one y-axis,
// thin 2px lines, recessive hairline grid, a crosshair readout listing every
// series (values first), a legend for 2+ series and end labels for up to 4
// lines, area washes at ~10%, 2px surface gaps between stacked layers, and a
// table view for every chart. Colors come from the --series-N tokens and
// always follow the entity (a sector or good keeps its color).

export interface Series {
  name: string;
  color: string;
  values: (number | null)[];
}

export type Fmt = (v: number) => string;

/** 1,284 · 12.9K · 4.2M */
export const compact: Fmt = (v) => {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(0)}K`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(2);
};
export const percent: Fmt = (v) => `${(v * 100).toFixed(v < 0.1 && v > -0.1 ? 1 : 0)}%`;
export const whole: Fmt = (v) => Math.round(v).toLocaleString();

const css = (el: Element, name: string, fallback: string) => getComputedStyle(el).getPropertyValue(name).trim() || fallback;
/** Canvas can't read CSS variables: turn var(--series-1) into its color. */
const resolve = (el: Element, c: string) => { const m = /^var\((--[^)]+)\)$/.exec(c.trim()); return m ? css(el, m[1], '#888') : c; };

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (v <= m * p + 1e-9) return m * p;
  return 10 * p;
}

/** A card: title, a plain-language line on how to read it, a table toggle, and the chart. */
export function card(title: string, sub: string): { el: HTMLDivElement; body: HTMLDivElement; table: HTMLDivElement; toggle: HTMLButtonElement } {
  const el = document.createElement('div');
  el.className = 'sv-card';
  el.innerHTML = `<div class="sv-card-h"><div><div class="sv-title"></div><div class="sv-sub"></div></div><button class="sv-tbl" title="Show the numbers as a table">Table</button></div><div class="sv-body"></div><div class="sv-table" hidden></div>`;
  el.querySelector('.sv-title')!.textContent = title;
  el.querySelector('.sv-sub')!.textContent = sub;
  const body = el.querySelector('.sv-body') as HTMLDivElement;
  const table = el.querySelector('.sv-table') as HTMLDivElement;
  const toggle = el.querySelector('.sv-tbl') as HTMLButtonElement;
  toggle.addEventListener('click', () => {
    const show = table.hidden;
    table.hidden = !show;
    body.hidden = show;
    toggle.classList.toggle('on', show);
  });
  return { el, body, table, toggle };
}

/** A simple HTML table (text set with textContent: names come from the simulation). */
function fillTable(host: HTMLElement, head: string[], rows: (string | number)[][]): void {
  const t = document.createElement('table');
  const tr = document.createElement('tr');
  head.forEach((h, i) => { const th = document.createElement('th'); th.textContent = h; if (i) th.className = 'r'; tr.appendChild(th); });
  t.appendChild(tr);
  for (const r of rows) {
    const row = document.createElement('tr');
    r.forEach((c, i) => { const td = document.createElement('td'); td.textContent = String(c); if (i) td.className = 'r'; row.appendChild(td); });
    t.appendChild(row);
  }
  host.replaceChildren(t);
}

// ------------------------------------------------------------- time charts

export interface TimeOpts {
  /** 'line' (default), 'stacked' (layers add up), or 'area' (one series with a wash). */
  kind?: 'line' | 'stacked' | 'area';
  fmt?: Fmt;
  fmtX?: (x: number) => string;
  /** Let the y-axis start above zero (for indexes and prices that never get near 0). */
  free?: boolean;
  height?: number;
}

/** Lines or stacked areas over game days. */
export class TimeChart {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private tip: HTMLDivElement;
  private legend: HTMLDivElement;
  private tableHost: HTMLDivElement;
  private x: number[] = [];
  private series: Series[] = [];
  private hover = -1;
  private legendKey = '';
  private opts: Required<TimeOpts>;

  constructor(title: string, sub: string, opts: TimeOpts = {}) {
    this.opts = { kind: 'line', fmt: compact, fmtX: (d) => `Day ${d + 1}`, free: false, height: 170, ...opts };
    const c = card(title, sub);
    this.el = c.el;
    this.tableHost = c.table;
    this.legend = document.createElement('div');
    this.legend.className = 'legend';
    const plot = document.createElement('div');
    plot.className = 'sv-plot';
    plot.style.height = `${this.opts.height}px`;
    plot.innerHTML = '<canvas></canvas><div class="tip"></div>';
    c.body.append(this.legend, plot);
    this.canvas = plot.querySelector('canvas')!;
    this.tip = plot.querySelector('.tip')!;
    plot.addEventListener('pointermove', (e) => {
      const n = this.x.length;
      if (n < 2) return;
      const r = this.canvas.getBoundingClientRect();
      const { left, right } = this.pad();
      const f = (e.clientX - r.left - left) / (r.width - left - right);
      this.hover = Math.max(0, Math.min(n - 1, Math.round(f * (n - 1))));
      this.draw();
    });
    plot.addEventListener('pointerleave', () => { this.hover = -1; this.draw(); });
  }

  /** Room on the right for end labels on line charts with a few series (measured when drawn). */
  private labelRoom = 10;
  private pad() {
    return { left: 46, right: this.labelRoom, top: 8, bottom: 20 };
  }

  set(x: number[], series: Series[]): void {
    this.x = x;
    this.series = series;
    const key = series.map((s) => s.name + s.color).join('|');
    if (key !== this.legendKey) {
      this.legendKey = key;
      // a legend for two or more series (a single series is named by the title)
      this.legend.replaceChildren(...(series.length > 1 ? series.map((s) => {
        const span = document.createElement('span');
        const i = document.createElement('i');
        i.className = this.opts.kind === 'line' ? 'key-line' : 'key-rect';
        i.style.background = s.color;
        span.append(i, document.createTextNode(s.name));
        return span;
      }) : []));
    }
    this.draw();
    // the table view: up to 12 evenly spaced days, newest last
    const n = x.length;
    const idx: number[] = [];
    for (let k = Math.max(0, n - 12); k < n; k++) idx.push(n <= 12 ? k : Math.round(((k - (n - 12)) / 11) * (n - 1)));
    fillTable(this.tableHost, ['Day', ...series.map((s) => s.name)], [...new Set(idx)].map((i) => [this.opts.fmtX(x[i]), ...series.map((s) => (s.values[i] === null || s.values[i] === undefined ? '—' : this.opts.fmt(s.values[i]!)))]));
  }

  draw(): void {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const muted = css(this.el, '--text-muted', '#8f8e85');
    const secondary = css(this.el, '--text-secondary', '#c3c2b7');
    const grid = css(this.el, '--grid', '#34342f');
    const surface = css(this.el, '--surface-1', '#1a1a19');
    const { x } = this;
    // colors resolved for the canvas
    const series = this.series.map((s) => ({ ...s, color: resolve(this.el, s.color) }));
    const n = x.length;
    g.font = '11px system-ui, sans-serif';
    // end labels ("2.7K Employed") for 2–4 lines: make room for the longest
    const endLabels = this.opts.kind === 'line' && series.length > 1 && series.length <= 4 && n >= 2;
    const labelText = (s: Series) => { const v = s.values[n - 1]; return v === null || v === undefined || !Number.isFinite(v) ? '' : `${this.opts.fmt(v)} ${s.name}`; };
    this.labelRoom = endLabels ? Math.min(150, 18 + Math.max(...series.map((s) => g.measureText(labelText(s)).width))) : 10;
    const { left, right, top, bottom } = this.pad();
    const pw = W - left - right, ph = H - top - bottom;
    g.font = '11px system-ui, sans-serif';
    if (n < 2 || !series.length) {
      g.fillStyle = muted;
      g.fillText('Collecting data: a point is added at the end of each game day.', left, top + ph / 2);
      this.tip.style.display = 'none';
      return;
    }
    const stacked = this.opts.kind === 'stacked';
    // stacked: cumulative tops per layer
    const tops: number[][] = [];
    if (stacked) {
      const acc = new Array(n).fill(0);
      for (const s of series) tops.push(s.values.map((v, i) => (acc[i] += Math.max(0, v ?? 0))));
    }
    let lo = Infinity, hi = -Infinity;
    const scan = stacked ? [tops[tops.length - 1]] : series.map((s) => s.values);
    for (const vs of scan) for (const v of vs) if (v !== null && Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    if (!this.opts.free || stacked) lo = Math.min(0, lo);
    else lo = lo - (hi - lo) * 0.1;
    if (hi - lo < 1e-9) hi = lo + 1;
    hi = lo + niceCeil(hi - lo);
    const X = (i: number) => left + (i / (n - 1)) * pw;
    const Y = (v: number) => top + ph - ((v - lo) / (hi - lo)) * ph;
    // hairline grid with clean tick values
    g.strokeStyle = grid;
    g.lineWidth = 1;
    g.fillStyle = muted;
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    for (let k = 0; k <= 4; k++) {
      const v = lo + ((hi - lo) * k) / 4;
      const yy = Math.round(Y(v)) + 0.5;
      g.beginPath(); g.moveTo(left, yy); g.lineTo(left + pw, yy); g.stroke();
      g.fillText(this.opts.fmt(v), left - 6, yy);
    }
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    g.fillText(this.opts.fmtX(x[0]), left, H - 5);
    g.textAlign = 'right';
    g.fillText(this.opts.fmtX(x[n - 1]), left + pw, H - 5);
    if (stacked) {
      // layers from the bottom up, each a fill in its color with a 2px surface gap on top
      for (let si = series.length - 1; si >= 0; si--) {
        const topv = tops[si], below = si ? tops[si - 1] : new Array(n).fill(0);
        g.beginPath();
        for (let i = 0; i < n; i++) (i ? g.lineTo : g.moveTo).call(g, X(i), Y(topv[i]));
        for (let i = n - 1; i >= 0; i--) g.lineTo(X(i), Y(below[i]));
        g.closePath();
        g.fillStyle = series[si].color;
        g.fill();
      }
      g.strokeStyle = surface;
      g.lineWidth = 2;
      for (let si = 0; si < series.length - 1; si++) {
        g.beginPath();
        for (let i = 0; i < n; i++) (i ? g.lineTo : g.moveTo).call(g, X(i), Y(tops[si][i]));
        g.stroke();
      }
    } else {
      series.forEach((s) => {
        if (this.opts.kind === 'area') {
          g.beginPath();
          let first = -1, last = -1;
          for (let i = 0; i < n; i++) { const v = s.values[i]; if (v === null || !Number.isFinite(v)) continue; if (first < 0) { g.moveTo(X(i), Y(v)); first = i; } else g.lineTo(X(i), Y(v)); last = i; }
          if (first >= 0) { g.lineTo(X(last), Y(Math.max(lo, 0))); g.lineTo(X(first), Y(Math.max(lo, 0))); g.closePath(); g.globalAlpha = 0.12; g.fillStyle = s.color; g.fill(); g.globalAlpha = 1; }
        }
        g.strokeStyle = s.color;
        g.lineWidth = 2;
        g.lineJoin = 'round';
        g.lineCap = 'round';
        g.beginPath();
        let started = false;
        for (let i = 0; i < n; i++) {
          const v = s.values[i];
          if (v === null || !Number.isFinite(v)) { started = false; continue; }
          if (!started) { g.moveTo(X(i), Y(v)); started = true; } else g.lineTo(X(i), Y(v));
        }
        g.stroke();
      });
      // end labels for a few lines (skipped when they'd collide; the legend and readout carry them then)
      if (this.opts.kind === 'line' && series.length > 1 && series.length <= 4) {
        const ends = series.map((s) => { const v = s.values[n - 1]; return v === null || !Number.isFinite(v) ? null : { s, y: Y(v), v }; }).filter((e): e is { s: Series; y: number; v: number } => !!e).sort((a, b) => a.y - b.y);
        const clash = ends.some((e, i) => i && e.y - ends[i - 1].y < 13);
        if (!clash) {
          g.textAlign = 'left';
          g.textBaseline = 'middle';
          for (const e of ends) {
            g.fillStyle = e.s.color;
            g.beginPath(); g.arc(left + pw, e.y, 4, 0, Math.PI * 2); g.fill();
            g.fillStyle = secondary;
            let text = labelText(e.s);
            while (text.length > 4 && g.measureText(text).width > right - 12) text = text.slice(0, -2) + '…';
            g.fillText(text, left + pw + 8, e.y);
          }
        }
      }
    }
    // the crosshair and readout: every series at that day, values first
    if (this.hover >= 0) {
      const i = this.hover;
      g.strokeStyle = muted;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(Math.round(X(i)) + 0.5, top); g.lineTo(Math.round(X(i)) + 0.5, top + ph); g.stroke();
      if (!stacked) series.forEach((s) => {
        const v = s.values[i];
        if (v === null || !Number.isFinite(v)) return;
        g.fillStyle = surface; g.beginPath(); g.arc(X(i), Y(v), 6, 0, Math.PI * 2); g.fill();
        g.fillStyle = s.color; g.beginPath(); g.arc(X(i), Y(v), 4, 0, Math.PI * 2); g.fill();
      });
      const head = document.createElement('div');
      head.className = 'tip-h';
      head.textContent = this.opts.fmtX(x[i]);
      const rows = series.map((s) => {
        const row = document.createElement('div');
        const key = document.createElement('i');
        key.className = 'key-line';
        key.style.background = s.color;
        const b = document.createElement('b');
        const v = s.values[i];
        b.textContent = v === null || v === undefined || !Number.isFinite(v) ? '—' : this.opts.fmt(v);
        row.append(key, document.createTextNode(s.name), b);
        return row;
      });
      if (stacked && series.length > 1) {
        const row = document.createElement('div');
        row.className = 'tip-total';
        const b = document.createElement('b');
        b.textContent = this.opts.fmt(tops[tops.length - 1][i]);
        row.append(document.createTextNode('Total'), b);
        rows.push(row);
      }
      this.tip.replaceChildren(head, ...rows);
      this.tip.style.display = 'block';
      const tx = X(i) + 14 + this.tip.offsetWidth > W ? X(i) - 14 - this.tip.offsetWidth : X(i) + 14;
      this.tip.style.left = `${tx}px`;
      this.tip.style.top = `${top}px`;
    } else this.tip.style.display = 'none';
  }
}

// ------------------------------------------------------------- bar lists

export interface Bar { label: string; value: number; note?: string; color?: string; onClick?: () => void }

/** Horizontal bars, biggest first: one series, one color (the title says what they are). */
export class BarList {
  readonly el: HTMLDivElement;
  private body: HTMLDivElement;
  private tableHost: HTMLDivElement;
  constructor(title: string, sub: string, private fmt: Fmt = compact, private color = 'var(--series-1)') {
    const c = card(title, sub);
    this.el = c.el;
    this.body = c.body;
    this.tableHost = c.table;
  }

  set(bars: Bar[], max = 10): void {
    const list = bars.slice(0, max);
    const top = Math.max(1e-9, ...list.map((b) => b.value));
    const rows = list.map((b) => {
      const row = document.createElement('div');
      row.className = 'sv-bar' + (b.onClick ? ' link' : '');
      const name = document.createElement('span');
      name.className = 'sv-bar-name';
      name.textContent = b.label;
      const track = document.createElement('span');
      track.className = 'sv-bar-track';
      const fill = document.createElement('i');
      fill.style.width = `${Math.max(0.5, (Math.max(0, b.value) / top) * 100)}%`;
      fill.style.background = b.color ?? this.color;
      track.appendChild(fill);
      const val = document.createElement('span');
      val.className = 'sv-bar-val';
      val.textContent = this.fmt(b.value);
      row.append(name, track, val);
      row.title = `${b.label}: ${this.fmt(b.value)}${b.note ? ` (${b.note})` : ''}`;
      if (b.onClick) row.addEventListener('click', b.onClick);
      return row;
    });
    this.body.replaceChildren(...(rows.length ? rows : [Object.assign(document.createElement('p'), { className: 'muted small', textContent: 'Nothing yet.' })]));
    fillTable(this.tableHost, ['', 'Value'], bars.map((b) => [b.label, this.fmt(b.value)]));
  }
}

// ------------------------------------------------------------- columns

/** Vertical columns for ordered bins (e.g. people by wealth). One series, one color. */
export class Columns {
  readonly el: HTMLDivElement;
  private body: HTMLDivElement;
  private tableHost: HTMLDivElement;
  constructor(title: string, sub: string, private fmt: Fmt = whole) {
    const c = card(title, sub);
    this.el = c.el;
    this.body = c.body;
    this.tableHost = c.table;
  }

  set(cols: { label: string; value: number }[]): void {
    const top = Math.max(1e-9, ...cols.map((c) => c.value));
    const wrap = document.createElement('div');
    wrap.className = 'sv-cols';
    for (const c of cols) {
      const col = document.createElement('div');
      col.className = 'sv-col';
      col.title = `${c.label}: ${this.fmt(c.value)}`;
      const v = document.createElement('span');
      v.className = 'sv-col-val';
      v.textContent = this.fmt(c.value);
      const bar = document.createElement('i');
      bar.style.height = `${Math.max(1, (c.value / top) * 100)}%`;
      const l = document.createElement('span');
      l.className = 'sv-col-label';
      l.textContent = c.label;
      const stack = document.createElement('div');
      stack.className = 'sv-col-bar';
      stack.append(v, bar);
      col.append(stack, l);
      wrap.appendChild(col);
    }
    this.body.replaceChildren(wrap);
    fillTable(this.tableHost, ['', 'Count'], cols.map((c) => [c.label, this.fmt(c.value)]));
  }
}

// ------------------------------------------------------------- order book

/** The open orders in one market: how much is wanted at or above each price (bids), and offered at or below (asks). */
export class DepthChart {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private tip: HTMLDivElement;
  private tableHost: HTMLDivElement;
  private bids: { price: number; qty: number }[] = [];
  private asks: { price: number; qty: number }[] = [];
  private hoverX = -1;
  constructor(title: string, sub: string) {
    const c = card(title, sub);
    this.el = c.el;
    this.tableHost = c.table;
    const legend = document.createElement('div');
    legend.className = 'legend';
    legend.innerHTML = '<span><i class="key-rect" style="background:var(--series-1)"></i>Wanted (bids)</span><span><i class="key-rect" style="background:var(--series-2)"></i>Offered (asks)</span>';
    const plot = document.createElement('div');
    plot.className = 'sv-plot';
    plot.style.height = '170px';
    plot.innerHTML = '<canvas></canvas><div class="tip"></div>';
    c.body.append(legend, plot);
    this.canvas = plot.querySelector('canvas')!;
    this.tip = plot.querySelector('.tip')!;
    plot.addEventListener('pointermove', (e) => { this.hoverX = e.clientX - this.canvas.getBoundingClientRect().left; this.draw(); });
    plot.addEventListener('pointerleave', () => { this.hoverX = -1; this.draw(); });
  }

  set(bids: { price: number; qty: number }[], asks: { price: number; qty: number }[]): void {
    this.bids = bids;
    this.asks = asks;
    this.draw();
    fillTable(this.tableHost, ['Side', 'Price', 'Quantity'], [
      ...bids.slice().sort((a, b) => b.price - a.price).slice(0, 8).map((o) => ['wanted', compact(o.price), whole(o.qty)]),
      ...asks.slice().sort((a, b) => a.price - b.price).slice(0, 8).map((o) => ['offered', compact(o.price), whole(o.qty)]),
    ]);
  }

  draw(): void {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const muted = css(this.el, '--text-muted', '#8f8e85');
    const grid = css(this.el, '--grid', '#34342f');
    const blue = css(this.el, '--series-1', '#3987e5');
    const orange = css(this.el, '--series-2', '#d95926');
    g.font = '11px system-ui, sans-serif';
    const left = 46, right = 10, top = 8, bottom = 20;
    const pw = W - left - right, ph = H - top - bottom;
    if (!this.bids.length && !this.asks.length) {
      g.fillStyle = muted;
      g.fillText('No open orders in this market right now.', left, top + ph / 2);
      this.tip.style.display = 'none';
      return;
    }
    // cumulative steps: bids from the highest price down, asks from the lowest up
    const bids = this.bids.slice().sort((a, b) => b.price - a.price);
    const asks = this.asks.slice().sort((a, b) => a.price - b.price);
    const bidSteps: { p: number; q: number }[] = [], askSteps: { p: number; q: number }[] = [];
    let q = 0; for (const o of bids) { q += o.qty; bidSteps.push({ p: o.price, q }); }
    q = 0; for (const o of asks) { q += o.qty; askSteps.push({ p: o.price, q }); }
    const prices = [...bids, ...asks].map((o) => o.price);
    let pLo = Math.min(...prices), pHi = Math.max(...prices);
    if (pHi - pLo < 1e-6) { pLo *= 0.9; pHi *= 1.1; }
    const pad = (pHi - pLo) * 0.05;
    pLo = Math.max(0, pLo - pad); pHi += pad;
    const qHi = niceCeil(Math.max(bidSteps[bidSteps.length - 1]?.q ?? 0, askSteps[askSteps.length - 1]?.q ?? 0, 1));
    const X = (p: number) => left + ((p - pLo) / (pHi - pLo)) * pw;
    const Y = (v: number) => top + ph - (v / qHi) * ph;
    g.strokeStyle = grid; g.lineWidth = 1; g.fillStyle = muted; g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let k = 0; k <= 4; k++) { const v = (qHi * k) / 4; const yy = Math.round(Y(v)) + 0.5; g.beginPath(); g.moveTo(left, yy); g.lineTo(left + pw, yy); g.stroke(); g.fillText(compact(v), left - 6, yy); }
    g.textBaseline = 'alphabetic'; g.textAlign = 'left'; g.fillText(compact(pLo), left, H - 5); g.textAlign = 'right'; g.fillText(compact(pHi), left + pw, H - 5);
    g.textAlign = 'center'; g.fillText('price', left + pw / 2, H - 5);
    const drawSide = (steps: { p: number; q: number }[], color: string, dir: 1 | -1) => {
      if (!steps.length) return;
      g.beginPath();
      const edge = dir === -1 ? pHi : pLo;
      g.moveTo(X(steps[0].p), Y(0));
      let prevQ = 0;
      for (const st of steps) { g.lineTo(X(st.p), Y(prevQ)); g.lineTo(X(st.p), Y(st.q)); prevQ = st.q; }
      g.lineTo(X(dir === -1 ? pLo : pHi), Y(prevQ));
      void edge;
      g.strokeStyle = color; g.lineWidth = 2; g.stroke();
      g.lineTo(X(dir === -1 ? pLo : pHi), Y(0)); g.closePath();
      g.globalAlpha = 0.12; g.fillStyle = color; g.fill(); g.globalAlpha = 1;
    };
    drawSide(bidSteps, blue, -1);
    drawSide(askSteps, orange, 1);
    if (this.hoverX >= left && this.hoverX <= left + pw) {
      const p = pLo + ((this.hoverX - left) / pw) * (pHi - pLo);
      const wanted = bids.filter((o) => o.price >= p).reduce((a, o) => a + o.qty, 0);
      const offered = asks.filter((o) => o.price <= p).reduce((a, o) => a + o.qty, 0);
      g.strokeStyle = muted; g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(this.hoverX) + 0.5, top); g.lineTo(Math.round(this.hoverX) + 0.5, top + ph); g.stroke();
      const head = document.createElement('div'); head.className = 'tip-h'; head.textContent = `At a price of ${compact(p)}`;
      const row = (label: string, v: number, color: string) => { const r = document.createElement('div'); const k = document.createElement('i'); k.className = 'key-line'; k.style.background = color; const b = document.createElement('b'); b.textContent = whole(v); r.append(k, document.createTextNode(label), b); return r; };
      this.tip.replaceChildren(head, row('wanted at this or more', wanted, blue), row('offered at this or less', offered, orange));
      this.tip.style.display = 'block';
      const tx = this.hoverX + 14 + this.tip.offsetWidth > W ? this.hoverX - 14 - this.tip.offsetWidth : this.hoverX + 14;
      this.tip.style.left = `${tx}px`; this.tip.style.top = `${top}px`;
    } else this.tip.style.display = 'none';
  }
}

// ------------------------------------------------------------- sparklines

/** A small trend line for a stat tile: the series in the muted ink, the latest point in the accent. */
export function sparkline(values: number[], w = 96, h = 26): string {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return '';
  const lo = Math.min(...v), hi = Math.max(...v);
  const span = hi - lo || 1;
  const pts = v.map((x, i) => `${((i / (v.length - 1)) * (w - 6) + 3).toFixed(1)},${(h - 3 - ((x - lo) / span) * (h - 6)).toFixed(1)}`);
  const [lx, ly] = pts[pts.length - 1].split(',');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts.join(' ')}" fill="none" stroke="var(--text-muted)" stroke-width="1.5" stroke-linejoin="round"/><circle cx="${lx}" cy="${ly}" r="3" fill="var(--series-1)" stroke="var(--surface-1)" stroke-width="2"/></svg>`;
}

// ------------------------------------------------------------- compass

export interface Dot { x: number; y: number; color: string; id: number; label: string; info: string }
export interface Marker { x: number; y: number; label: string; color: string; kind: 'ring' | 'cross' }

/**
 * The political compass: economic left–right across, liberal–authoritarian up
 * the side, a dot per person. Hover finds the nearest dot (no need to land on
 * it); click opens that person. Party platforms are rings, the city average a cross.
 */
export class CompassChart {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private tip: HTMLDivElement;
  private legend: HTMLDivElement;
  private tableHost: HTMLDivElement;
  private dots: Dot[] = [];
  private markers: Marker[] = [];
  private hover = -1;
  private R = 2; // axis range (positions run about -1.5..1.5)

  constructor(title: string, sub: string, modes: [string, string][], mode: string, onMode: (m: string) => void, private onPick: (id: number) => void) {
    const c = card(title, sub);
    this.el = c.el;
    this.tableHost = c.table;
    const seg = document.createElement('div');
    seg.className = 'group sv-seg';
    seg.innerHTML = '<span class="muted small" style="padding:0 6px">Color by</span>';
    for (const [k, l] of modes) {
      const b = document.createElement('button');
      b.textContent = l;
      b.dataset.mode = k;
      b.className = k === mode ? 'on' : '';
      b.addEventListener('click', () => { seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.mode === k)); onMode(k); });
      seg.appendChild(b);
    }
    this.legend = document.createElement('div');
    this.legend.className = 'legend';
    const plot = document.createElement('div');
    plot.className = 'sv-plot';
    plot.style.height = '460px';
    plot.innerHTML = '<canvas></canvas><div class="tip"></div>';
    c.body.append(seg, this.legend, plot);
    this.canvas = plot.querySelector('canvas')!;
    this.tip = plot.querySelector('.tip')!;
    plot.addEventListener('pointermove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      const { X, Y } = this.frame();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      let best = -1, bd = 14 * 14;
      for (let i = 0; i < this.dots.length; i++) { const d = this.dots[i]; const dx = X(d.x) - mx, dy = Y(d.y) - my; const dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = i; } }
      if (best !== this.hover) { this.hover = best; this.draw(); }
      plot.style.cursor = best >= 0 ? 'pointer' : 'default';
    });
    plot.addEventListener('pointerleave', () => { this.hover = -1; this.draw(); });
    plot.addEventListener('click', () => { if (this.hover >= 0) this.onPick(this.dots[this.hover].id); });
  }

  /** The square plot area and its scales. */
  private frame() {
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    const size = Math.min(W - 40, H - 40);
    const left = (W - size) / 2, top = 18;
    const X = (v: number) => left + ((Math.max(-this.R, Math.min(this.R, v)) + this.R) / (2 * this.R)) * size;
    const Y = (v: number) => top + ((this.R - Math.max(-this.R, Math.min(this.R, v))) / (2 * this.R)) * size;
    return { W, H, size, left, top, X, Y };
  }

  set(dots: Dot[], markers: Marker[], legend: { label: string; color: string; n: number }[]): void {
    this.dots = dots;
    this.markers = markers;
    this.hover = -1;
    this.legend.replaceChildren(...legend.map((l) => {
      const s = document.createElement('span');
      const i = document.createElement('i');
      i.className = 'key-dot';
      i.style.background = l.color;
      s.append(i, document.createTextNode(`${l.label} (${l.n})`));
      return s;
    }));
    this.draw();
    fillTable(this.tableHost, ['Group', 'People', 'Average left–right', 'Average liberal–authoritarian'], legend.map((l) => {
      const ds = dots.filter((d) => d.color === l.color);
      const ax = ds.reduce((a, d) => a + d.x, 0) / Math.max(1, ds.length), ay = ds.reduce((a, d) => a + d.y, 0) / Math.max(1, ds.length);
      return [l.label, whole(ds.length), ax.toFixed(2), ay.toFixed(2)];
    }));
  }

  draw(): void {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const { W, H, size, left, top, X, Y } = this.frame();
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const muted = css(this.el, '--text-muted', '#8f8e85');
    const secondary = css(this.el, '--text-secondary', '#c3c2b7');
    const grid = css(this.el, '--grid', '#34342f');
    const surface = css(this.el, '--surface-1', '#1a1a19');
    // frame, quarter lines, and the center cross
    g.strokeStyle = grid; g.lineWidth = 1;
    g.strokeRect(Math.round(left) + 0.5, Math.round(top) + 0.5, Math.round(size), Math.round(size));
    for (const v of [-1, 1]) {
      g.beginPath(); g.moveTo(Math.round(X(v)) + 0.5, top); g.lineTo(Math.round(X(v)) + 0.5, top + size); g.stroke();
      g.beginPath(); g.moveTo(left, Math.round(Y(v)) + 0.5); g.lineTo(left + size, Math.round(Y(v)) + 0.5); g.stroke();
    }
    g.strokeStyle = muted;
    g.beginPath(); g.moveTo(Math.round(X(0)) + 0.5, top); g.lineTo(Math.round(X(0)) + 0.5, top + size); g.stroke();
    g.beginPath(); g.moveTo(left, Math.round(Y(0)) + 0.5); g.lineTo(left + size, Math.round(Y(0)) + 0.5); g.stroke();
    g.font = '11px system-ui, sans-serif';
    g.fillStyle = muted;
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText('Authoritarian left', left + 6, top + 6);
    g.textAlign = 'right'; g.fillText('Authoritarian right', left + size - 6, top + 6);
    g.textBaseline = 'bottom'; g.fillText('Libertarian right', left + size - 6, top + size - 6);
    g.textAlign = 'left'; g.fillText('Libertarian left', left + 6, top + size - 6);
    g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillText('← economic left · economic right →', left + size / 2, top + size + 4);
    g.save(); g.translate(left - 8, top + size / 2); g.rotate(-Math.PI / 2); g.textBaseline = 'bottom'; g.fillText('← liberal · authoritarian →', 0, 0); g.restore();
    // the dots (gray groups first, so colored ones sit on top)
    const order = this.dots.map((_d, i) => i).sort((a, b) => (this.dots[a].color.includes('muted') || this.dots[a].color.includes('dim') ? 0 : 1) - (this.dots[b].color.includes('muted') || this.dots[b].color.includes('dim') ? 0 : 1));
    const colorCache = new Map<string, string>();
    const col = (cname: string) => { let v = colorCache.get(cname); if (!v) { v = resolve(this.el, cname); colorCache.set(cname, v); } return v; };
    g.globalAlpha = this.dots.length > 3000 ? 0.45 : 0.65;
    for (const i of order) { const d = this.dots[i]; g.fillStyle = col(d.color); g.beginPath(); g.arc(X(d.x), Y(d.y), 2.5, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1;
    // markers: party platforms (rings) and the city's average (a cross), with labels in text ink
    for (const m of this.markers) {
      const mx = X(m.x), my = Y(m.y);
      if (m.kind === 'ring') {
        g.strokeStyle = surface; g.lineWidth = 5; g.beginPath(); g.arc(mx, my, 7, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = col(m.color); g.lineWidth = 2.5; g.beginPath(); g.arc(mx, my, 7, 0, Math.PI * 2); g.stroke();
      } else {
        g.strokeStyle = surface; g.lineWidth = 5; g.beginPath(); g.moveTo(mx - 7, my); g.lineTo(mx + 7, my); g.moveTo(mx, my - 7); g.lineTo(mx, my + 7); g.stroke();
        g.strokeStyle = secondary; g.lineWidth = 2; g.beginPath(); g.moveTo(mx - 7, my); g.lineTo(mx + 7, my); g.moveTo(mx, my - 7); g.lineTo(mx, my + 7); g.stroke();
      }
      g.fillStyle = secondary; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText(m.label, mx + 11, my);
    }
    if (this.hover >= 0) {
      const d = this.dots[this.hover];
      g.strokeStyle = surface; g.lineWidth = 3; g.beginPath(); g.arc(X(d.x), Y(d.y), 6, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = secondary; g.lineWidth = 1.5; g.beginPath(); g.arc(X(d.x), Y(d.y), 6, 0, Math.PI * 2); g.stroke();
      const head = document.createElement('div'); head.className = 'tip-h'; head.textContent = d.label;
      const info = document.createElement('div'); info.style.display = 'block'; info.textContent = d.info;
      this.tip.replaceChildren(head, info);
      this.tip.style.display = 'block';
      const tx = X(d.x) + 14 + this.tip.offsetWidth > W ? X(d.x) - 14 - this.tip.offsetWidth : X(d.x) + 14;
      this.tip.style.left = `${tx}px`;
      this.tip.style.top = `${Math.min(H - this.tip.offsetHeight - 4, Math.max(4, Y(d.y) - 10))}px`;
    } else this.tip.style.display = 'none';
  }
}

// ------------------------------------------------------------- diverging bars

/** Bars either side of zero (e.g. how far left or right a group leans). Blue one way, red the other, gray center line. */
export class DivergingBars {
  readonly el: HTMLDivElement;
  private body: HTMLDivElement;
  private tableHost: HTMLDivElement;
  constructor(title: string, sub: string, private neg: string, private pos: string, private fmt: Fmt = (v) => v.toFixed(2), private negColor = 'var(--div-neg)', private posColor = 'var(--div-pos)') {
    const c = card(title, sub);
    this.el = c.el;
    this.body = c.body;
    this.tableHost = c.table;
  }

  set(rows: { label: string; value: number; group?: string }[]): void {
    const max = Math.max(1e-9, ...rows.map((r) => Math.abs(r.value)));
    const head = document.createElement('div');
    head.className = 'sv-div-head';
    const l = document.createElement('span'); l.textContent = `← ${this.neg}`;
    const r = document.createElement('span'); r.textContent = `${this.pos} →`;
    head.append(document.createElement('span'), l, r, document.createElement('span'));
    const els: HTMLElement[] = [head];
    let lastGroup = '';
    for (const row of rows) {
      if (row.group && row.group !== lastGroup) {
        lastGroup = row.group;
        const gEl = document.createElement('div'); gEl.className = 'pl-group'; gEl.textContent = row.group; els.push(gEl);
      }
      const el = document.createElement('div');
      el.className = 'sv-div';
      const name = document.createElement('span'); name.className = 'sv-bar-name'; name.textContent = row.label;
      const left = document.createElement('span'); left.className = 'sv-div-l';
      const right = document.createElement('span'); right.className = 'sv-div-r';
      const bar = document.createElement('i');
      bar.style.width = `${(Math.abs(row.value) / max) * 100}%`;
      bar.style.background = row.value < 0 ? this.negColor : this.posColor;
      (row.value < 0 ? left : right).appendChild(bar);
      const val = document.createElement('span'); val.className = 'sv-bar-val'; val.textContent = (row.value > 0 ? '+' : '') + this.fmt(row.value);
      el.append(name, left, right, val);
      el.title = `${row.label}: ${(row.value > 0 ? '+' : '') + this.fmt(row.value)}`;
      els.push(el);
    }
    this.body.replaceChildren(...els);
    fillTable(this.tableHost, ['', 'Value'], rows.map((x) => [x.group ? `${x.group}: ${x.label}` : x.label, this.fmt(x.value)]));
  }
}

// ------------------------------------------------------------- ranked bars

/** Every item as a thin bar, sorted from lowest to highest (e.g. every company's profit). Hover names it; click opens it. */
export class RankedBars {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private tip: HTMLDivElement;
  private tableHost: HTMLDivElement;
  private items: { label: string; value: number; id: number }[] = [];
  private hover = -1;
  constructor(title: string, sub: string, private fmt: Fmt, private onPick: (id: number) => void) {
    const c = card(title, sub);
    this.el = c.el;
    this.tableHost = c.table;
    const legend = document.createElement('div');
    legend.className = 'legend';
    // money: losses red, profits blue
    legend.innerHTML = '<span><i class="key-rect" style="background:var(--div-pos)"></i>Loss</span><span><i class="key-rect" style="background:var(--div-neg)"></i>Profit</span>';
    const plot = document.createElement('div');
    plot.className = 'sv-plot';
    plot.style.height = '190px';
    plot.innerHTML = '<canvas></canvas><div class="tip"></div>';
    c.body.append(legend, plot);
    this.canvas = plot.querySelector('canvas')!;
    this.tip = plot.querySelector('.tip')!;
    plot.addEventListener('pointermove', (e) => {
      const n = this.items.length;
      if (!n) return;
      const r = this.canvas.getBoundingClientRect();
      const left = 46, right = 10;
      const i = Math.floor(((e.clientX - r.left - left) / (r.width - left - right)) * n);
      const h = i >= 0 && i < n ? i : -1;
      if (h !== this.hover) { this.hover = h; this.draw(); }
      plot.style.cursor = h >= 0 ? 'pointer' : 'default';
    });
    plot.addEventListener('pointerleave', () => { this.hover = -1; this.draw(); });
    plot.addEventListener('click', () => { if (this.hover >= 0) this.onPick(this.items[this.hover].id); });
  }

  set(items: { label: string; value: number; id: number }[]): void {
    this.items = items.slice().sort((a, b) => a.value - b.value);
    this.draw();
    fillTable(this.tableHost, ['', 'Value'], this.items.slice().reverse().map((x) => [x.label, this.fmt(x.value)]));
  }

  draw(): void {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const muted = css(this.el, '--text-muted', '#8f8e85');
    const grid = css(this.el, '--grid', '#34342f');
    const neg = css(this.el, '--div-pos', '#e66767'), pos = css(this.el, '--div-neg', '#3987e5'); // losses red, profits blue
    const left = 46, right = 10, top = 8, bottom = 20;
    const pw = W - left - right, ph = H - top - bottom;
    const n = this.items.length;
    g.font = '11px system-ui, sans-serif';
    if (!n) { g.fillStyle = muted; g.fillText('No companies yet.', left, top + ph / 2); return; }
    let lo = Math.min(0, ...this.items.map((x) => x.value)), hi = Math.max(0, ...this.items.map((x) => x.value));
    const span = niceCeil(Math.max(Math.abs(lo), Math.abs(hi)));
    lo = lo < 0 ? -span : 0; hi = hi > 0 ? span : 0;
    if (hi - lo < 1e-9) hi = 1;
    const Y = (v: number) => top + ph - ((v - lo) / (hi - lo)) * ph;
    g.strokeStyle = grid; g.lineWidth = 1; g.fillStyle = muted; g.textAlign = 'right'; g.textBaseline = 'middle';
    for (const v of [lo, (lo + hi) / 2, hi, 0]) { const yy = Math.round(Y(v)) + 0.5; g.beginPath(); g.moveTo(left, yy); g.lineTo(left + pw, yy); g.stroke(); g.fillText(this.fmt(v), left - 6, yy); }
    const bw = pw / n;
    const gap = bw > 4 ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const v = this.items[i].value;
      g.fillStyle = v < 0 ? neg : pos;
      if (this.hover >= 0 && this.hover !== i) g.globalAlpha = 0.55;
      const y0 = Y(0), y1 = Y(v);
      g.fillRect(left + i * bw + gap / 2, Math.min(y0, y1), Math.max(1, bw - gap), Math.max(1, Math.abs(y1 - y0)));
      g.globalAlpha = 1;
    }
    g.fillStyle = muted; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText(`${n} companies, biggest loss on the left, biggest profit on the right`, left, H - 5);
    if (this.hover >= 0) {
      const it = this.items[this.hover];
      const head = document.createElement('div'); head.className = 'tip-h'; head.textContent = it.label;
      const row = document.createElement('div'); const b = document.createElement('b'); b.textContent = this.fmt(it.value);
      row.append(document.createTextNode(it.value < 0 ? 'loss' : 'profit'), b);
      this.tip.replaceChildren(head, row);
      this.tip.style.display = 'block';
      const x = left + (this.hover + 0.5) * bw;
      const tx = x + 14 + this.tip.offsetWidth > W ? x - 14 - this.tip.offsetWidth : x + 14;
      this.tip.style.left = `${tx}px`; this.tip.style.top = `${top}px`;
    } else this.tip.style.display = 'none';
  }
}
