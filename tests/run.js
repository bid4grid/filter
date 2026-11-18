'use strict';
/**
 * Headless tests for the calculation core (no browser, no dependencies): node tests/run.js
 *
 *  - element values and units for every filter type
 *  - frequency response sanity (low-pass, high-pass, band-pass)
 *  - the exported SPICE netlists are solved with an independent circuit solver and compared with the ABCD analysis
 *  - layout geometry (no overlapping copper), DXF, KiCad and Touchstone output
 *  - input checks / warnings
 *  - a sweep over all topology / technology / order combinations looking for NaN or crashes
 */
const assert = require('assert');
const { make, solveNetlist } = require('./helpers.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message ? e.message : e)); }
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' expected ' + b + ' +/- ' + tol + ', got ' + a);

console.log('Element values & units');
test('low-pass pi-pi: Z0 = 0.8 Re, C = 1/(wc Z0), L = 2 l', () => {
  const { fd } = make({ art: 't', tech: 'd', sections: 4 });
  near(fd.zo, 40, 1e-9);
  const c = 1 / (2 * Math.PI * 1e9 * 40), l = 40 / (2 * Math.PI * 1e9);
  const e = fd.elements;
  assert.strictEqual(e.length, 5);
  near(e[0].val / c, 1, 1e-9); near(e[1].val / (2 * l), 1, 1e-9); near(e[2].val / (2 * c), 1, 1e-9);
  assert.deepStrictEqual(e.map(x => x.name), ['C1', 'L1', 'C2', 'L2', 'C3']);
  assert.deepStrictEqual(e.map(x => x.isSeries), [false, true, false, true, false]);
});
test('high-pass: inductors in nH, capacitors in pF (regression: values were swapped)', () => {
  const { core, fd } = make({ art: 'h', tech: 'd', schaltIn: 't', schaltOut: 't', sections: 4 });
  fd.elements.forEach(el => {
    const t = core.elemValueText(el);
    if (el.name[0] === 'L') assert.ok(/ nH$/.test(t), el.name + ' -> ' + t); else assert.ok(/ pF$/.test(t), el.name + ' -> ' + t);
  });
});
test('m-derived: m from norm, tank values', () => {
  const { fd } = make({ art: 't', tech: 'd', steep: 'both', fs: 1300 });
  near(fd.m, Math.sqrt(1 - 1 / 1.3 / 1.3), 1e-9);
  const c = 1 / (2 * Math.PI * 1e9 * fd.zo), l = fd.zo / (2 * Math.PI * 1e9);
  near(fd.elements[0].val / (c * fd.m), 1, 1e-9, 'Cqm');
  near(fd.elements[0].val2 / (l * (1 - fd.m * fd.m) / fd.m), 1, 1e-9, 'Lqm');
});
test('m-derived default termination factor matches norm=1.25 and m=0.6', () => {
  const plain = make({ art: 't', tech: 'd', steep: 'none' }).fd;
  near(plain.norm, 1.25, 1e-12);
  near(plain.m, 0.6, 1e-12);
  const steep = make({ art: 't', tech: 'd', steep: 'in', schaltIn: 'p', fs: 1250 });
  const tm = 1 - (0.6 / 1.25) ** 2;
  near(steep.fd.m, 0.6, 1e-12);
  near(steep.fd.zo, steep.state.re / (1.25 * tm), 1e-9);
});
test('band-pass resonators resonate at f0', () => {
  const { core, fd } = make({ art: 'p', tech: 'd' });
  fd.lumped.forEach(el => {
    const lc = core.elemLC(el);
    near(1 / (2 * Math.PI * Math.sqrt(lc.L * lc.C)) / fd.f0, 1, 1e-9, el.name);
  });
});

console.log('Microstrip synthesis');
test('width synthesis inverts the Hammerstad/Jensen forward model', () => {
  const fwd = (u, er) => {
    const f = u < 1 ? 1 / Math.sqrt(1 + 12 / u) + 0.04 * (1 - u) ** 2 : 1 / Math.sqrt(1 + 12 / u);
    const ee = (er + 1) / 2 + (er - 1) / 2 * f;
    const z0 = u < 1 ? 60 * Math.log(8 / u + u / 4) : 120 * Math.PI / (u + 1.393 + 0.667 * Math.log(u + 1.444));
    return z0 / Math.sqrt(ee);
  };
  [2.2, 3.55, 4.4, 9.8].forEach(er => [1, 0.5, 1.6].forEach(h => [25, 40, 50, 75, 100].forEach(z => {
    const { fd } = make({ art: 't', tech: 's', er, h, re: z, autoRa: false, ra: z });
    near(fwd(fd.ms_Re.wh, er), z, 0.01, 'er=' + er + ' z=' + z);
    near(fd.ms_Re.w_mm, fd.ms_Re.wh * h, 1e-9);
  })));
});
test('clipped impedances are flagged', () => {
  const { fd } = make({ art: 't', tech: 's', zHigh: 200, h: 1 });
  assert.ok(fd.warnings.some(w => /w\/h/.test(w.text)) || fd.ms_L.clipped === null);
});
test('Z-high / Z-low are used', () => {
  const a = make({ art: 't', tech: 's', zHigh: 100, zLow: 25 }).fd;
  near(a.ms_L.z, 100, 1e-9); near(a.ms_C.z, 25, 1e-9);
});
test('coupled-line gap decreases as even/odd impedance ratio increases', () => {
  const weak = make({ art: 'p', tech: 's', fu: 990, fo: 1010 }).fd.coupledStages;
  const strong = make({ art: 'p', tech: 's', fu: 800, fo: 1200 }).fd.coupledStages;
  weak.forEach((stage, i) => {
    const weakRho = stage.zoe / stage.zoo, strongRho = strong[i].zoe / strong[i].zoo;
    assert.ok(strongRho > weakRho, 'stage ' + i + ' should have a higher ratio for tighter coupling');
    assert.ok(strong[i].s_mm < stage.s_mm, 'stage ' + i + ' gap should shrink as coupling increases');
  });
  assert.ok(weak.every(stage => stage.s_mm <= 2), 'gap estimate must respect the documented upper bound');
});
test('coupled-line element data includes the estimated physical gap', () => {
  const { fd } = make({ art: 'p', tech: 's' });
  assert.ok(fd.elements.length > 0);
  fd.elements.forEach((stage, i) => {
    assert.ok(Number.isFinite(stage.s_mm) && stage.s_mm > 0, 'stage ' + i + ' needs a positive gap');
    near(stage.s_mm, fd.coupledStages[i].s_mm, 0);
  });
});
test('open-end compensation shortens only the wide lines', () => {
  const off = make({ art: 't', tech: 's', endEffects: false }).fd, on = make({ art: 't', tech: 's', endEffects: true }).fd;
  off.elements.forEach((e, i) => {
    const wide = Math.abs(e.w_mm - off.ms_C.w_mm) < Math.abs(e.w_mm - off.ms_L.w_mm);
    if (wide) assert.ok(on.elements[i].l_mm < e.l_mm, e.name); else near(on.elements[i].l_mm, e.l_mm, 1e-12, e.name);
  });
});

console.log('Frequency response');
test('low-pass: passband, rejection, monotone', () => {
  const { core, fd } = make({ art: 't', tech: 'd', sections: 6 });
  assert.ok(core.responseAt(fd, 0.2e9).s21dB > -1);
  assert.ok(core.responseAt(fd, 3e9).s21dB < -30);
});
test('high-pass: mirror image', () => {
  const { core, fd } = make({ art: 'h', tech: 'd', sections: 6 });
  assert.ok(core.responseAt(fd, 4e9).s21dB > -1.5);
  assert.ok(core.responseAt(fd, 0.2e9).s21dB < -30);
});
test('band-pass: centred, rejects far away', () => {
  const { core, fd } = make({ art: 'p', tech: 'd', fu: 900, fo: 1100 });
  assert.ok(core.responseAt(fd, fd.f0).s21dB > -1.5);
  assert.ok(core.responseAt(fd, fd.f0 / 3).s21dB < -40);
  assert.ok(core.responseAt(fd, fd.f0 * 3).s21dB < -40);
});
test('lossless two-port: |S11|^2 + |S21|^2 = 1 (50 ohm reference)', () => {
  [{ art: 't' }, { art: 'h' }, { art: 'p' }].forEach(o => {
    const { core, fd } = make(Object.assign({ tech: 'd' }, o));
    [0.3, 0.9, 1.1, 2].forEach(k => {
      const s = core.sParams(fd, fd.f0 * k, 50);
      const p = (s.s11[0] ** 2 + s.s11[1] ** 2) + (s.s21[0] ** 2 + s.s21[1] ** 2);
      near(p, 1, 1e-9, JSON.stringify(o) + ' k=' + k);
    });
  });
});

console.log('Exports');
const configs = [
  { art: 't', tech: 'd', steep: 'both' }, { art: 'h', tech: 'd', schaltIn: 't', schaltOut: 't' }, { art: 't', tech: 'd', schaltIn: 'p', schaltOut: 't', sections: 5, steep: 'in' },
  { art: 'p', tech: 'd' }, { art: 'p', tech: 's' }, { art: 'h', tech: 'd', steep: 'out', fs: 700 }
];
test('SPICE netlist reproduces the ABCD response (independent circuit solver)', () => {
  configs.forEach(o => {
    const { core, fd, state } = make(o);
    const net = core.generateSpiceNetlist(fd);
    [0.3, 0.7, 0.95, 1, 1.05, 1.5, 3].forEach(k => {
      const f = fd.f0 * k, r = core.responseAt(fd, f), v = solveNetlist(net, f);
      if (r.s21dB < -100) return; // exact transmission zero (notch): below the numerical noise floor
      const mag = Math.hypot(...v.out) / Math.hypot(...v.src);
      const db = 20 * Math.log10(2 * Math.sqrt(state.re / state.ra) * mag);
      near(db, r.s21dB, 0.01, JSON.stringify(o) + ' k=' + k);
    });
  });
});
test('transmission-line SPICE netlist reproduces the T-line model', () => {
  const { core, fd } = make({ art: 't', tech: 's', sections: 6 });
  const net = core.generateSpiceTline(fd);
  assert.ok(net && /Z0=/.test(net));
  [0.2, 0.6, 1, 1.4, 2].forEach(k => {
    const f = fd.f0 * k, r = core.responseAt(fd, f, 'tline'), v = solveNetlist(net, f);
    const db = 20 * Math.log10(2 * Math.sqrt(50 / fd.matchedRa || 1) * Math.hypot(...v.out) / Math.hypot(...v.src));
    const st = make({ art: 't', tech: 's', sections: 6 }).state;
    const db2 = 20 * Math.log10(2 * Math.sqrt(st.re / st.ra) * Math.hypot(...v.out) / Math.hypot(...v.src));
    near(db2, r.s21dB, 0.01, 'k=' + k);
  });
  assert.strictEqual(make({ art: 'h', tech: 's' }).core.generateSpiceTline(make({ art: 'h', tech: 's' }).fd), null);
});
test('Touchstone file: header, 401 points, 9 columns', () => {
  const { core, fd } = make({ art: 't', tech: 'd' });
  const t = core.generateTouchstone(fd).split('\n').filter(Boolean);
  assert.ok(t.some(l => l.startsWith('# Hz S RI R 50')));
  const data = t.filter(l => !l.startsWith('!') && !l.startsWith('#'));
  assert.strictEqual(data.length, 401);
  data.forEach(l => assert.strictEqual(l.trim().split(/\s+/).length, 9));
});
test('layout geometry: copper rectangles never overlap', () => {
  [{ art: 't' }, { art: 'h' }, { art: 'p' }, { art: 'p', fu: 900, fo: 1000, sections: 10 }, { art: 'p', endEffects: true }].forEach(o => {
    const { core, fd } = make(Object.assign({ tech: 's' }, o));
    const R = core.layoutRects(fd).rects;
    for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
      const a = R[i], b = R[j];
      const ox = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
      const oy = Math.min(a.yc + a.w / 2, b.yc + b.w / 2) - Math.max(a.yc - a.w / 2, b.yc - b.w / 2);
      assert.ok(!(ox > 1e-9 && oy > 1e-9 && !(a.row === b.row)), JSON.stringify(o) + ' rects ' + i + '/' + j + ' overlap');
    }
  });
});
test('DXF: one polyline per rectangle plus the board edge', () => {
  [{ art: 't' }, { art: 'p' }].forEach(o => {
    const { core, fd } = make(Object.assign({ tech: 's' }, o));
    const dxf = core.generateDxfLayout(fd);
    assert.strictEqual(dxf.split('\n').filter(l => l === 'POLYLINE').length, core.layoutRects(fd).rects.length + 1);
    assert.ok(dxf.endsWith('EOF'));
  });
});
test('KiCad footprint is balanced and has two pads', () => {
  const { core, fd } = make({ art: 'p', tech: 's' });
  const k = core.generateKicadFootprint(fd);
  assert.strictEqual((k.match(/\(/g) || []).length, (k.match(/\)/g) || []).length);
  assert.ok(/pad "1"/.test(k) && /pad "2"/.test(k));
});

console.log('Input checks');
test('errors for impossible input', () => {
  assert.ok(make({ art: 't', fg: 0 }).fd.warnings.some(w => w.level === 'error' && /cutoff/i.test(w.text)));
  assert.ok(make({ art: 'p', fu: 1200, fo: 800 }).fd.warnings.some(w => w.level === 'error'));
  assert.ok(make({ art: 't', steep: 'both', fs: 900 }).fd.warnings.some(w => w.level === 'error' && /ABOVE/.test(w.text)));
  assert.ok(make({ art: 'h', steep: 'both', fs: 1500 }).fd.warnings.some(w => w.level === 'error' && /BELOW/.test(w.text)));
  assert.ok(make({ tech: 's', er: 0.5 }).fd.warnings.some(w => w.level === 'error'));
});
test('feasibility warnings fire (lambda/8, narrow line, bandwidth)', () => {
  assert.ok(make({ art: 't', tech: 's' }).fd.warnings.some(w => /λ\/8/.test(w.text)));
  assert.ok(make({ art: 'p', tech: 's', fu: 800, fo: 1200 }).fd.warnings.some(w => /Fractional bandwidth/.test(w.text)));
  assert.ok(make({ art: 't', tech: 's', zHigh: 180, h: 1.6 }).fd.warnings.some(w => /0\.15 mm|w\/h/.test(w.text)));
});

console.log('Robustness sweep');
test('no NaN / crashes for every combination', () => {
  let n = 0;
  for (const art of ['t', 'h', 'p']) for (const tech of ['d', 's']) for (const si of ['p', 't']) for (const so of ['p', 't'])
    for (const steep of ['none', 'in', 'out', 'both']) for (const sec of [1, 2, 3, 4, 5, 6, 9, 10]) {
      const { core, fd } = make({ art, tech, schaltIn: si, schaltOut: so, steep, sections: sec, fs: art === 'h' ? 700 : 1300 });
      fd.elements.forEach(e => { assert.ok(isFinite(e.l_mm) && isFinite(e.w_mm), JSON.stringify({ art, tech, si, so, steep, sec }) + ' ' + e.name); });
      (fd.lumped || []).forEach(e => assert.ok(isFinite(e.val), e.name));
      [0.5, 1, 2].forEach(k => { const r = core.responseAt(fd, fd.f0 * k); assert.ok(isFinite(r.s21dB) && isFinite(r.s11dB)); });
      core.generateSpiceNetlist(fd); core.generateTouchstone(fd); core.layoutRects(fd); core.generateDxfLayout(fd); core.generateKicadFootprint(fd);
      n++;
    }
  assert.strictEqual(n, 3 * 2 * 2 * 2 * 4 * 8);
});
test('degenerate input does not throw', () => {
  [{ fg: 0 }, { fg: -5 }, { fg: 1e-9 }, { re: 0 }, { h: 0 }, { er: 1 }, { art: 'p', fu: 0, fo: 0 }, { art: 'p', fu: 1000, fo: 1000 }].forEach(o => {
    const { core, fd } = make(o);
    assert.ok(Array.isArray(fd.warnings));
    core.generateSpiceNetlist(fd); core.layoutRects(fd);
  });
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
