// Minimal canvas line chart: one y-axis, thin 2px lines, recessive grid,
// crosshair + tooltip on hover, legend for 2+ series.

export interface SeriesDef {
  name: string;
  color: string; // CSS color (token value)
}

export interface ChartData {
  x: number[]; // ticks (game minutes)
  ys: number[][]; // one array per series, same length as x
}

export class LineChart {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private tip: HTMLDivElement;
  private data: ChartData = { x: [], ys: [] };
  private hover = -1;

  constructor(
    title: string,
    private series: SeriesDef[],
    private fmt: (v: number) => string,
    private fmtX: (t: number) => string,
    /** Treat 0 as "no data" (e.g. a price before the first trade). */
    private zeroIsMissing = false,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'chart';
    const legend = series.length > 1
      ? `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('')}</div>`
      : '';
    this.el.innerHTML = `<div class="chart-title">${title}</div>${legend}<div class="chart-plot"><canvas></canvas><div class="tip"></div></div>`;
    this.canvas = this.el.querySelector('canvas')!;
    this.tip = this.el.querySelector('.tip')!;
    const plot = this.el.querySelector('.chart-plot') as HTMLDivElement;
    plot.addEventListener('mousemove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      const n = this.data.x.length;
      if (n < 2) return;
      const { left, right } = this.pad();
      const f = (e.clientX - r.left - left) / (r.width - left - right);
      this.hover = Math.max(0, Math.min(n - 1, Math.round(f * (n - 1))));
      this.draw();
    });
    plot.addEventListener('mouseleave', () => { this.hover = -1; this.draw(); });
  }

  private pad() {
    return { left: 44, right: 8, top: 6, bottom: 18 };
  }

  setData(d: ChartData): void {
    this.data = d;
    this.draw();
  }

  draw(): void {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const css = getComputedStyle(this.el);
    const muted = css.getPropertyValue('--text-muted').trim() || '#8a897f';
    const grid = css.getPropertyValue('--grid').trim() || '#33332f';
    const { x, ys } = this.data;
    const n = x.length;
    const { left, right, top, bottom } = this.pad();
    const pw = W - left - right, ph = H - top - bottom;
    g.font = '11px system-ui, sans-serif';
    if (n < 2) {
      g.fillStyle = muted;
      g.fillText('collecting data…', left, top + ph / 2);
      this.tip.style.display = 'none';
      return;
    }
    let lo = Infinity, hi = -Infinity;
    for (const s of ys) for (const v of s) { if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    lo = Math.min(0, lo);
    if (hi - lo < 1e-9) hi = lo + 1;
    hi = niceCeil(hi);
    const X = (i: number) => left + (i / (n - 1)) * pw;
    const Y = (v: number) => top + ph - ((v - lo) / (hi - lo)) * ph;
    // grid + y labels (3 lines)
    g.strokeStyle = grid;
    g.lineWidth = 1;
    g.fillStyle = muted;
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    for (let k = 0; k <= 3; k++) {
      const v = lo + ((hi - lo) * k) / 3;
      const yy = Math.round(Y(v)) + 0.5;
      g.beginPath(); g.moveTo(left, yy); g.lineTo(W - right, yy); g.stroke();
      g.fillText(this.fmt(v), left - 6, yy);
    }
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillText(this.fmtX(x[0]), left, H - 4);
    g.textAlign = 'right';
    g.fillText(this.fmtX(x[n - 1]), W - right, H - 4);
    // lines
    g.lineWidth = 2;
    g.lineJoin = 'round';
    ys.forEach((s, si) => {
      g.strokeStyle = this.series[si].color;
      g.beginPath();
      let started = false;
      for (let i = 0; i < n; i++) {
        const v = s[i];
        if (!Number.isFinite(v) || (this.zeroIsMissing && v <= 0)) { started = false; continue; }
        if (!started) { g.moveTo(X(i), Y(v)); started = true; } else g.lineTo(X(i), Y(v));
      }
      g.stroke();
    });
    // hover
    if (this.hover >= 0) {
      const i = this.hover;
      g.strokeStyle = muted;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(Math.round(X(i)) + 0.5, top); g.lineTo(Math.round(X(i)) + 0.5, top + ph); g.stroke();
      ys.forEach((s, si) => {
        if (!Number.isFinite(s[i]) || (this.zeroIsMissing && s[i] <= 0)) return;
        g.fillStyle = this.series[si].color;
        g.beginPath(); g.arc(X(i), Y(s[i]), 4, 0, Math.PI * 2); g.fill();
      });
      const rows = ys.map((s, si) => `<div><i style="background:${this.series[si].color}"></i>${this.series[si].name}<b>${Number.isFinite(s[i]) ? this.fmt(s[i]) : '—'}</b></div>`).join('');
      this.tip.innerHTML = `<div class="tip-h">${this.fmtX(x[i])}</div>${rows}`;
      this.tip.style.display = 'block';
      const tx = X(i) + 12 + 150 > W ? X(i) - 12 - this.tip.offsetWidth : X(i) + 12;
      this.tip.style.left = `${tx}px`;
      this.tip.style.top = `${top}px`;
    } else this.tip.style.display = 'none';
  }
}

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}
