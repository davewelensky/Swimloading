// @ts-check
/**
 * The report's pictures, drawn as inline SVG from the swim's own numbers (the same pictures the Aquasharks Lab page uses to explain
 * a stroke). Pure functions: numbers in, SVG string out. Colours come from CSS classes so the report's theme controls them.
 * Nothing here is an illustration of a "typical" swimmer: every shape is this swimmer's data.
 */
const f1 = (n) => (Math.round(n * 10) / 10).toString();
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 100 squares, 20 across and 5 down: how many of every 100 units of force move the swimmer forward. */
export function squaresSVG(forwardPct) {
  const n = Math.max(0, Math.min(100, Math.round(forwardPct)));
  const rects = Array.from({ length: 100 }, (_, i) => `<rect class="${i < n ? 'vq-f' : 'vq-o'}" x="${(i % 20) * 20}" y="${Math.floor(i / 20) * 20}" width="15" height="15" rx="3"/>`).join('');
  return `<svg class="rv-squares" viewBox="0 0 395 95" role="img" aria-label="${n} of every 100 units of force move you forward">${rects}</svg>`;
}

/**
 * Where each hand sent its force: a fan per hand from the EO force-field angles (0 = up, clockwise, force in the head-on plane).
 * Drawn the way the Lab page draws it: the left hand fans out to the left, the right hand to the right, one common scale.
 * @param {number[]|null} left @param {number[]|null} right 360 values each, newtons per degree
 */
export function fansSVG(left, right) {
  if (!left || !right || left.length !== 360 || right.length !== 360) return '';
  const BIN = 6, W = 400, H = 250, cx = 200, cy = 235, R = 205;
  const bins = (a) => Array.from({ length: 360 / BIN }, (_, b) => { let s = 0; for (let k = 0; k < BIN; k++) s += a[b * BIN + k] || 0; return s / BIN; });
  const smooth = (v) => v.map((_, i) => (v[(i + v.length - 1) % v.length] + 2 * v[i] + v[(i + 1) % v.length]) / 4);
  const bl = smooth(bins(left)), br = smooth(bins(right)), vmax = Math.max(...bl, ...br, 1e-9);
  const wedge = (b, cls) => {
    const pts = b.map((v, i) => { const th = (((i + 0.5) * BIN + 180) % 360) * Math.PI / 180, r = R * Math.pow(v / vmax, 0.9); return `${f1(cx + r * Math.sin(th))},${f1(cy - r * Math.cos(th))}`; });
    return `<path class="${cls}" d="M${cx},${cy} L${pts.join(' L')} Z"/>`;
  };
  const arcs = [0.33, 0.66, 1].map((k) => `<path class="vf-grid" d="M${f1(cx - R * k)},${cy} A${f1(R * k)},${f1(R * k)} 0 0 1 ${f1(cx + R * k)},${cy}"/>`).join('');
  return `<svg class="rv-fans" viewBox="0 0 ${W} ${H}" role="img" aria-label="Where each hand sent the water">${arcs}<line class="vf-centre" x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - R}"/>${wedge(bl, 'vf-left')}${wedge(br, 'vf-right')}<text class="vf-lbl vf-lbl-l" x="14" y="24">LEFT HAND</text><text class="vf-lbl vf-lbl-r" x="386" y="24" text-anchor="end">RIGHT HAND</text></svg>`;
}

/**
 * The path of each hand under the water, from real strokes: from above (left to right across the body, swimming up the page) and from the side.
 * @param {{lateral:number[], fwd:number[], depth:number[]}[]|null} left @param {{lateral:number[], fwd:number[], depth:number[]}[]|null} right  cm
 */
export function handPathSVG(left, right) {
  if (!left || !right || !left.length || !right.length) return '';
  const S = 1.05;                                    // px per cm, both views
  const ox = 100, oy = 112;                          // overhead origin: centre line x, forward 0 at y
  const sx = 305, sy = 44;                           // side origin: forward 0 at x, surface at y
  const over = (p) => p.lateral.map((x, i) => `${f1(ox + x * S)},${f1(oy - p.fwd[i] * S)}`).join(' ');
  const side = (p) => p.fwd.map((x, i) => `${f1(sx + x * S)},${f1(sy - p.depth[i] * S)}`).join(' ');
  const lines = (arr, cls, fn) => arr.map((p) => `<polyline class="${cls}" points="${fn(p)}"/>`).join('');
  return `<svg class="rv-path" viewBox="0 0 440 215" role="img" aria-label="The path of each hand, from above and from the side">
    <text class="vp-title" x="100" y="14" text-anchor="middle">FROM ABOVE</text><text class="vp-title" x="305" y="14" text-anchor="middle">FROM THE SIDE</text>
    <line class="vp-centre" x1="${ox}" y1="24" x2="${ox}" y2="205"/><text class="vp-note" x="${ox + 4}" y="209">CENTRE LINE</text>
    ${lines(left, 'vp-left', over)}${lines(right, 'vp-right', over)}
    <line class="vp-surface" x1="${sx - 80}" y1="${sy}" x2="${sx + 80}" y2="${sy}"/><text class="vp-note" x="${sx - 80}" y="${sy - 5}">SURFACE</text>
    <line class="vp-grid" x1="${sx - 80}" y1="${f1(sy + 50 * S)}" x2="${sx + 80}" y2="${f1(sy + 50 * S)}"/><text class="vp-note" x="${sx + 84}" y="${f1(sy + 50 * S + 3)}">50 cm</text>
    ${lines(left, 'vp-left', side)}${lines(right, 'vp-right', side)}
  </svg>`;
}

/**
 * Forward share and downward share across sessions, oldest first.
 * @param {{label: string, forward: number|null, down: number|null}[]} pts
 */
export function progressSVG(pts) {
  const p = /** @type {{label: string, forward: number, down: number}[]} */ (pts.filter((x) => x.forward != null && x.down != null));
  if (p.length < 2) return '';
  const W = 400, H = 210, L = 38, Rm = 26, T = 22, B = 34, top = Math.max(60, Math.ceil(Math.max(...p.flatMap((x) => [x.forward, x.down])) / 10) * 10);
  const X = (i) => L + ((W - L - Rm) * i) / (p.length - 1), Y = (v) => T + (H - T - B) * (1 - v / top);
  const grid = [0, 20, 40, 60].filter((g) => g <= top).map((g) => `<line class="vg-grid" x1="${L}" y1="${f1(Y(g))}" x2="${W - Rm}" y2="${f1(Y(g))}"/><text class="vg-ax" x="${L - 6}" y="${f1(Y(g) + 3)}" text-anchor="end">${g}%</text>`).join('');
  const line = (key, cls) => `<polyline class="${cls}" points="${p.map((x, i) => `${f1(X(i))},${f1(Y(x[key]))}`).join(' ')}"/>${p.map((x, i) => `<circle class="${cls}-dot" cx="${f1(X(i))}" cy="${f1(Y(x[key]))}" r="4"/>`).join('')}`;
  const last = p[p.length - 1], first = p[0], fwdAbove = last.forward >= last.down;
  const lab = (x, i, key, above) => `<text class="vg-val vg-val-${key}" x="${f1(X(i))}" y="${f1(Y(x[key]) + (above ? -9 : 17))}" text-anchor="${i === 0 ? 'start' : 'end'}">${f1(x[key])}</text>`;
  const xs = p.map((x, i) => `<text class="vg-ax" x="${f1(X(i))}" y="${H - 12}" text-anchor="${i === 0 ? 'start' : i === p.length - 1 ? 'end' : 'middle'}">${esc(x.label)}</text>`).join('');
  return `<svg class="rv-progress-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Forward and downward share of force, session by session">${grid}${line('down', 'vg-down')}${line('forward', 'vg-fwd')}${lab(first, 0, 'forward', first.forward >= first.down)}${lab(first, 0, 'down', first.down > first.forward)}${lab(last, p.length - 1, 'forward', fwdAbove)}${lab(last, p.length - 1, 'down', !fwdAbove)}${xs}</svg>`;
}

/** A ruler for distance per stroke: last time, now, and the coach's goal, on a 0 to 4 m scale. */
export function rulerSVG({ then, now, goal }) {
  const max = Math.max(3.5, Math.ceil(Math.max(then || 0, now || 0, goal || 0) + 0.25)), W = 400, L = 6, X = (v) => L + ((W - L - 6) * v) / max;
  const bar = (v, y, cls, label) => (v == null ? '' : `<rect class="${cls}" x="${L}" y="${y}" width="${f1(X(v) - L)}" height="16" rx="8"/><text class="vr-val" x="${f1(X(v) - 10)}" y="${y + 12}" text-anchor="end">${label} ${v.toFixed(2)} m</text>`);
  const ticks = Array.from({ length: Math.floor(max) + 1 }, (_, m) => `<line class="vr-tick" x1="${f1(X(m))}" y1="2" x2="${f1(X(m))}" y2="${then != null && goal != null ? 96 : 70}"/><text class="vr-ax" x="${f1(X(m))}" y="${then != null && goal != null ? 108 : 82}" text-anchor="${m === 0 ? 'start' : 'middle'}">${m} m</text>`).join('');
  const goalMark = goal != null ? `<line class="vr-goal" x1="${f1(X(goal))}" y1="0" x2="${f1(X(goal))}" y2="${then != null ? 74 : 48}"/>` : '';
  return `<svg class="rv-ruler" viewBox="0 0 ${W} ${then != null && goal != null ? 114 : 88}" role="img" aria-label="Distance per stroke">${ticks}${bar(then, 6, 'vr-then', 'Last time')}${bar(now, then != null ? 30 : 6, 'vr-now', 'Now')}${goalMark}</svg>`;
}
