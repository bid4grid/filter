'use strict';
// Shared helpers for the headless tests (no browser needed: the calculation core has no DOM dependency)
const fs = require('fs'), path = require('path');
const coreFile = fs.readdirSync(path.join(__dirname, '..', 'assets')).filter(function (n) { return /^mfc-core-.*\.js$/.test(n); })[0];
require('../assets/' + coreFile);
const MFCCore = globalThis.MFCCore;

function defaultState(over) {
  const s = {
    tech: 's', art: 't', schaltIn: 'p', schaltOut: 'p', steep: 'none', sections: 4, autoRa: true,
    re: 50, ra: 50, fg: 1000, fgUnit: 'm', fu: 800, fuUnit: 'm', fo: 1200, foUnit: 'm', fs: 1300, fsUnit: 'm',
    substrate: 'ro4003c', er: 3.55, h: 1.0, zHigh: 120, zLow: 20, endEffects: false
  };
  return Object.assign(s, over || {});
}
function make(over) {
  const state = defaultState(over);
  const core = MFCCore.create(state, { title: 'test' });
  return { state, core, fd: core.calcFilter() };
}

// ---- minimal complex MNA solver: parses the exported SPICE netlist and returns V(out)/V(src) ----
function parseVal(t) { return parseFloat(t); }
function solveNetlist(text, f) {
  const w = 2 * Math.PI * f;
  const nodes = new Map(); const node = n => { if (n === '0') return -1; if (!nodes.has(n)) nodes.set(n, nodes.size); return nodes.get(n); };
  const dev = [];
  for (const raw of text.split('\n')) {
    const l = raw.trim(); if (!l || l[0] === '*' || l[0] === '.') continue;
    const p = l.split(/\s+/); const t = p[0][0].toUpperCase();
    if (t === 'V') { dev.push({ t: 'V', a: node(p[1]), b: node(p[2]) }); }
    else if (t === 'R' || t === 'L' || t === 'C') { dev.push({ t, a: node(p[1]), b: node(p[2]), v: parseVal(p[3]) }); }
    else if (t === 'T') { // lossless line, parameters Z0= TD=
      const z0 = parseVal(l.match(/Z0=([^\s]+)/)[1]), td = parseVal(l.match(/TD=([^\s]+)/)[1]);
      dev.push({ t: 'T', a: node(p[1]), b: node(p[3]), z0, td });
    }
  }
  const nv = nodes.size; const vs = dev.filter(d => d.t === 'V'); const n = nv + vs.length;
  const A = Array.from({ length: n }, () => Array.from({ length: n }, () => [0, 0])); const B = Array.from({ length: n }, () => [0, 0]);
  const add = (i, j, y) => { if (i < 0 || j < 0) return; A[i][j][0] += y[0]; A[i][j][1] += y[1]; };
  const stamp = (a, b, y) => { add(a, a, y); add(b, b, y); add(a, b, [-y[0], -y[1]]); add(b, a, [-y[0], -y[1]]); };
  const inv = y => { const d = y[0] * y[0] + y[1] * y[1]; return [y[0] / d, -y[1] / d]; };
  vs.forEach((d, k) => { const r = nv + k; if (d.a >= 0) { A[d.a][r][0] += 1; A[r][d.a][0] += 1; } if (d.b >= 0) { A[d.b][r][0] -= 1; A[r][d.b][0] -= 1; } B[r][0] = 1; });
  for (const d of dev) {
    if (d.t === 'R') stamp(d.a, d.b, [1 / d.v, 0]);
    if (d.t === 'C') stamp(d.a, d.b, [0, w * d.v]);
    if (d.t === 'L') stamp(d.a, d.b, inv([0, w * d.v]));
    if (d.t === 'T') { // y-parameters of an ideal line between port nodes a/b (grounded)
      const th = w * d.td, s = Math.sin(th), c = Math.cos(th);
      const y11 = [0, -c / (d.z0 * s)], y12 = [0, 1 / (d.z0 * s)];
      add(d.a, d.a, y11); add(d.b, d.b, y11); add(d.a, d.b, y12); add(d.b, d.a, y12);
    }
  }
  // gaussian elimination (complex)
  const cm = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
  const cd = (a, b) => { const q = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / q, (a[1] * b[0] - a[0] * b[1]) / q]; };
  for (let c = 0; c < n; c++) {
    let piv = c; for (let r = c + 1; r < n; r++) if (Math.hypot(...A[r][c]) > Math.hypot(...A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]]; [B[c], B[piv]] = [B[piv], B[c]];
    for (let r = c + 1; r < n; r++) {
      const m = cd(A[r][c], A[c][c]);
      for (let k = c; k < n; k++) { const q = cm(m, A[c][k]); A[r][k][0] -= q[0]; A[r][k][1] -= q[1]; }
      const q = cm(m, B[c]); B[r][0] -= q[0]; B[r][1] -= q[1];
    }
  }
  const x = Array.from({ length: n }, () => [0, 0]);
  for (let r = n - 1; r >= 0; r--) {
    let sum = [B[r][0], B[r][1]];
    for (let k = r + 1; k < n; k++) { const q = cm(A[r][k], x[k]); sum[0] -= q[0]; sum[1] -= q[1]; }
    x[r] = cd(sum, A[r][r]);
  }
  return { out: x[nodes.get('out')], src: x[nodes.get('src')] };
}

module.exports = { make, defaultState, solveNetlist, MFCCore };
