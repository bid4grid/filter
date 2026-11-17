/**
 * Microstrip & Discrete Filter Calculator - calculation core
 * Pure logic (no DOM): synthesis, network analysis, layout geometry and export generators.
 * Used by app.js (UI) and by the headless tests in /tests.
 *
 *   var core = MFCCore.create(state, { title: 'My calculator' });
 *   var fd = core.calcFilter();
 */
(function (root) {
  'use strict';

  function create(state, opts) {
    opts = opts || {};

  // Half-sections validation based on image parameter theory & Diplomarbeit rules:
  // Symmetrical topologies (π-π, T-T) require an EVEN number of half-sections (2, 4, 6, 8, 10).
  // Asymmetrical topologies (π-T, T-π) require an ODD number of half-sections (1, 3, 5, 7, 9).
  function validateSections(sections, sIn, sOut) {
    var num = parseInt(sections, 10);
    var isSym = (sIn === sOut);
    if (isSym) {
      if (isNaN(num) || num < 2) num = 2;
      if (num > 10) num = 10;
      if (num % 2 !== 0) {
        num = (num < 10) ? num + 1 : num - 1;
      }
    } else {
      if (isNaN(num) || num < 1) num = 1;
      if (num > 9) num = 9;
      if (num % 2 === 0) {
        num = (num > 1) ? num - 1 : 1;
      }
    }
    return num;
  }

  // Unit conversion helpers
  var UNIT_MULTIPLIERS = { h: 1, k: 1e3, m: 1e6, g: 1e9 };
  function toHz(val, unit) { return (parseFloat(val) || 0) * (UNIT_MULTIPLIERS[unit] || 1); }
  function fmtFreq(hz) {
    if (hz >= 1e9) return (hz / 1e9).toFixed(3) + ' GHz';
    if (hz >= 1e6) return (hz / 1e6).toFixed(3) + ' MHz';
    if (hz >= 1e3) return (hz / 1e3).toFixed(2) + ' kHz';
    return hz.toFixed(1) + ' Hz';
  }
  function fmtCap(f) {
    if (f >= 1e-6) return (f * 1e6).toFixed(2) + ' µF';
    if (f >= 1e-9) return (f * 1e9).toFixed(2) + ' nF';
    return (f * 1e12).toFixed(2) + ' pF';
  }
  function fmtInd(hVal) {
    if (hVal >= 1e-3) return (hVal * 1e3).toFixed(2) + ' mH';
    if (hVal >= 1e-6) return (hVal * 1e6).toFixed(2) + ' µH';
    return (hVal * 1e9).toFixed(2) + ' nH';
  }

  // An element's `isSeries` flag only says WHERE it sits (series arm vs shunt arm). It does NOT say
  // whether the part is an inductor or a capacitor: in a high-pass filter the series parts are capacitors.
  // The element NAME is the reliable indicator (L.. = inductor, C.. = capacitor).
  // For two-part elements (m-derived tanks, band-pass resonators) `val` is the part named by the element
  // and `val2` is the other one; band-pass ('BP-..') elements always store val = C, val2 = L.
  function elemLC(el) {
    var first = (el.name || '').charAt(0);
    if (first === 'L') return { L: el.val, C: el.val2, primary: 'L' };
    return { L: el.val2, C: el.val, primary: 'C' };
  }
  // How the two parts of a two-part element are wired.
  // m-derived tanks: series arm = L || C (parallel tank), shunt arm = L + C in series.
  // band-pass resonators ('BP-..'): series arm = L + C in series, shunt arm = L || C (parallel tank).
  function elemTankKind(el) {
    var bp = (el.name || '').charAt(0) === 'B';
    if (el.isSeries) return bp ? 'series' : 'parallel';
    return bp ? 'parallel' : 'series';
  }
  function elemValueText(el) {
    if (el.zoe !== undefined && el.zoo !== undefined) { // parallel-coupled stage
      return 'Z0e ' + el.zoe.toFixed(1) + ' Ω / Z0o ' + el.zoo.toFixed(1) + ' Ω';
    }
    var lc = elemLC(el);
    var parts = [];
    var addL = function () { if (lc.L != null) parts.push(fmtInd(lc.L)); };
    var addC = function () { if (lc.C != null) parts.push(fmtCap(lc.C)); };
    if (lc.primary === 'L') { addL(); addC(); } else { addC(); addL(); }
    return parts.join(' + ');
  }
  function elemLineZ(el, fd) {
    if (el.zoe !== undefined && el.zoo !== undefined) return Math.sqrt(el.zoe * el.zoo).toFixed(1) + ' Ω';
    // narrow (high-Z) realisation is 120 Ω, wide (low-Z) is 20 Ω - decide from the element's actual width
    var isInd = Math.abs(el.w_mm - fd.ms_L.w_mm) <= Math.abs(el.w_mm - fd.ms_C.w_mm);
    return (isInd ? fd.zHigh : fd.zLow) + ' Ω';
  }

  // --- RF CALCULATION CORE (PORTED FROM PASCAL) ---

  function calcFilter() {
    var res = {};
    var fgHz = toHz(state.fg, state.fgUnit);
    var fuHz = toHz(state.fu, state.fuUnit);
    var foHz = toHz(state.fo, state.foUnit);
    var fsHz = toHz(state.fs, state.fsUnit);

    // Filter frequency params
    if (state.art === 'p') {
      res.f0 = Math.sqrt(fuHz * foHz);
      res.b = (foHz - fuHz) / res.f0;
      res.cutoff = foHz;
    } else {
      res.f0 = fgHz;
      res.b = 0;
      res.cutoff = fgHz;
    }

    // Determine normalized frequency ratio for steepened (m-derived) filter
    var norm = 1.25;
    if (state.art === 'h' && fsHz > 0) norm = fgHz / fsHz;
    if (state.art === 't' && fsHz > 0) norm = fsHz / fgHz;
    res.norm = norm;

    // Determine m parameter
    var isSteep = (state.steep !== 'none') && (state.art === 't' || state.art === 'h');
    var mVal = 0.6;
    if (isSteep && norm > 1) {
      var zw = Math.sqrt(norm * norm - 1) / norm;
      if (zw >= 1) zw = 0.9996;
      mVal = zw;
    }
    res.m = mVal;

    // Parity validation & Half-sections (Halbglieder)
    var anz = validateSections(state.sections, state.schaltIn, state.schaltOut);
    state.sections = anz;
    res.anz = anz;

    // Topology configuration: wahlschalt (from Diplomarbeit AUSWAHL.PAS & PARAM.PAS)
    // First digit d1 represents Input (2: Pi unverst., 3: Pi verst., 4: T unverst., 5: T verst.)
    // Second digit d2 represents Output (2: Pi unverst., 3: Pi verst., 4: T unverst., 5: T verst., 1: single half-section)
    var inSteep = (state.steep === 'in' || state.steep === 'both') && (state.art === 't' || state.art === 'h');
    var outSteep = (state.steep === 'out' || state.steep === 'both') && (state.art === 't' || state.art === 'h');
    var d1 = inSteep ? (state.schaltIn === 'p' ? 3 : 5) : (state.schaltIn === 'p' ? 2 : 4);
    var d2;
    if (anz === 1) {
      d2 = 1;
    } else {
      d2 = outSteep ? (state.schaltOut === 'p' ? 3 : 5) : (state.schaltOut === 'p' ? 2 : 4);
    }
    var wahlschalt = d1 * 10 + d2;
    res.wahlschalt = wahlschalt;

    // Norm factor for steepening
    var normTerm = (isSteep && norm > 1) ? (1 - Math.pow(0.6 / norm, 2)) : 0.64;
    if (normTerm <= 0.001) normTerm = 0.001;

    // Characteristic wave impedance Zo calculation from Re (PARAM.PAS lines 26-66)
    var zo;
    if (d1 === 2) {
      zo = state.re * 0.8;
    } else if (d1 === 4) {
      zo = state.re * 1.25;
    } else if (d1 === 3) {
      zo = state.re / (1.25 * normTerm);
    } else { // d1 === 5
      zo = (state.re * normTerm) / 0.8;
    }
    if (isNaN(zo) || zo <= 0) zo = state.re;
    res.zo = zo;

    // Theoretical matched output impedance Ra (ausgwberech from PARAM.PAS lines 101-155)
    var matchedRa;
    if (wahlschalt === 22 || wahlschalt === 33 || wahlschalt === 44 || wahlschalt === 55) {
      matchedRa = state.re;
    } else if (wahlschalt === 21 || wahlschalt === 24 || wahlschalt === 31 || wahlschalt === 34 || wahlschalt === 54) {
      matchedRa = zo * 0.8;
    } else if (wahlschalt === 23 || wahlschalt === 43 || wahlschalt === 53) {
      matchedRa = (zo / 0.8) * normTerm;
    } else if (wahlschalt === 25 || wahlschalt === 35 || wahlschalt === 45) {
      matchedRa = (zo * 0.8) / normTerm;
    } else if (wahlschalt === 32 || wahlschalt === 41 || wahlschalt === 42 || wahlschalt === 51 || wahlschalt === 52) {
      matchedRa = zo / 0.8;
    } else {
      matchedRa = state.re;
    }
    res.matchedRa = matchedRa;

    // Synchronize Ra if autoRa is enabled
    if (state.autoRa) {
      state.ra = matchedRa;
    }

    // --- Microstrip Synthesis (hochbreit iterative solver from GRASTREI.UNI) ---
    var er = parseFloat(state.er) || 5.0;
    var subH_m = (parseFloat(state.h) || 1.0) * 1e-3; // in meters

    // Hammerstad & Jensen forward model (static, no dispersion): w/h -> effective permittivity and Z
    function msForward(u) {
      var f = (u < 1) ? (1 / Math.sqrt(1 + 12 / u) + 0.04 * (1 - u) * (1 - u)) : (1 / Math.sqrt(1 + 12 / u));
      var ee = ((er + 1) / 2) + (((er - 1) / 2) * f);
      var z0 = (u < 1) ? 60 * Math.log(8 / u + u / 4) : (120 * Math.PI) / (u + 1.393 + 0.667 * Math.log(u + 1.444));
      return { ereff: ee, z: z0 / Math.sqrt(ee) };
    }

    // Synthesis: find w/h for a target impedance by bisection on the forward model (Z falls monotonically with w/h)
    var U_MIN = 0.02, U_MAX = 40;
    function calcMicrostripWh(targetZ) {
      var lo = U_MIN, hi = U_MAX, clipped = null;
      if (!(targetZ > 0) || !isFinite(targetZ)) targetZ = 50;
      if (targetZ >= msForward(lo).z) { hi = lo; clipped = 'narrow'; }
      else if (targetZ <= msForward(hi).z) { lo = hi; clipped = 'wide'; }
      var u = lo;
      if (hi !== lo) {
        for (var it = 0; it < 80; it++) {
          u = 0.5 * (lo + hi);
          if (msForward(u).z > targetZ) lo = u; else hi = u;
        }
        u = 0.5 * (lo + hi);
      }
      var fw = msForward(u);
      return { wh: u, ereff: fw.ereff, w_mm: u * subH_m * 1e3, z: targetZ, clipped: clipped };
    }

    // Open-end fringing extension (Hammerstad): delta_l / h for a line of width ratio u
    function openEndDl_mm(u, ereff) {
      return 0.412 * subH_m * 1e3 * ((ereff + 0.3) / (ereff - 0.258)) * ((u + 0.264) / (u + 0.8));
    }

    // High and Low impedance transmission line sections
    // Impedances of the narrow (inductive) and wide (capacitive) lines; 120 / 20 ohm by default, user-adjustable
    var zHigh = Number(state.zHigh); if (!(zHigh >= 60 && zHigh <= 200)) zHigh = 120;
    var zLow = Number(state.zLow); if (!(zLow >= 8 && zLow <= 40)) zLow = 20;
    res.zHigh = zHigh; res.zLow = zLow;
    res.ms_L = calcMicrostripWh(zHigh); // narrow line for inductance
    res.ms_C = calcMicrostripWh(zLow);  // wide line for capacitance
    res.ms_Zo = calcMicrostripWh(zo);
    res.ms_Re = calcMicrostripWh(state.re);
    res.ms_Ra = calcMicrostripWh(state.ra);

    // Guide wavelengths
    var c_speed = 3e8;
    var lambda_L = (c_speed / fgHz) / Math.sqrt(res.ms_L.ereff);
    var lambda_C = (c_speed / fgHz) / Math.sqrt(res.ms_C.ereff);
    res.lambda_L_mm = lambda_L * 1e3;
    res.lambda_C_mm = lambda_C * 1e3;

    // Physical length factors based on equations in BERECH.PAS
    var faktL = lambda_L / (zHigh * 2 * Math.PI * (1 - Math.pow(zo / zHigh, 2)));
    var faktC = (zLow * lambda_C) / (2 * Math.PI * (1 - Math.pow(zLow / zo, 2)));
    res.faktL = faktL;
    res.faktC = faktC;

    // Calculate Discrete Elements & Physical Dimensions
    var elements = [];
    var numComponents = anz + 1;

    if (state.art === 't') {
      // Tiefpass (Low-Pass)
      var wg = 2 * Math.PI * fgHz;
      var c = 1 / (wg * zo);
      var l = zo / wg;
      var cqm = c * mVal;
      var lqm = (l * (1 - mVal * mVal)) / mVal;
      var clm = (c * (1 - mVal * mVal)) / mVal;
      var llm = l * mVal;
      var cp = 2 * c;
      var lr = 2 * l;
      var cpm = c * (1 + mVal);
      var lrm = l * (1 + mVal);
      var cmm = c * 2 * mVal;
      var lmm = l * 2 * mVal;

      res.discrete = { c: c, l: l, cqm: cqm, lqm: lqm, clm: clm, llm: llm, cp: cp, lr: lr, cpm: cpm, lrm: lrm, cmm: cmm, lmm: lmm };

      for (var i = 0; i < numComponents; i++) {
        var isFirst = (i === 0);
        var isLast = (i === numComponents - 1);
        var isSeries = (state.schaltIn === 'p') ? (i % 2 !== 0) : (i % 2 === 0);

        var name, type, val, val2 = null, w_mm, l_mm;

        if (isSeries) {
          name = 'L' + (Math.floor(i / 2) + 1);
          w_mm = res.ms_L.w_mm;
          if (isFirst && inSteep) {
            type = 'Parallel L-C Tank (Series m-derived, Input)';
            val = llm;
            val2 = clm;
            l_mm = Math.abs(wg * llm * faktL) * 1e3;
          } else if (isLast && outSteep) {
            type = 'Parallel L-C Tank (Series m-derived, Output)';
            val = llm;
            val2 = clm;
            l_mm = Math.abs(wg * llm * faktL) * 1e3;
          } else if (isFirst || isLast) {
            type = isFirst ? 'Inductor (Series, T-Input)' : 'Inductor (Series, T-Output)';
            val = l;
            l_mm = Math.abs(wg * l * faktL) * 1e3;
          } else {
            type = 'Inductor (Series)';
            if (anz === 2 && inSteep && outSteep) val = lmm;
            else if ((i === 1 && inSteep) || (i === numComponents - 2 && outSteep)) val = lrm;
            else val = lr;
            l_mm = Math.abs(wg * val * faktL) * 1e3;
          }
        } else {
          name = 'C' + (Math.floor(i / 2) + 1);
          w_mm = res.ms_C.w_mm;
          if (isFirst && inSteep) {
            type = 'Series L-C Tank (Shunt m-derived, Input)';
            val = cqm;
            val2 = lqm;
            l_mm = Math.abs(wg * cqm * faktC) * 1e3;
          } else if (isLast && outSteep) {
            type = 'Series L-C Tank (Shunt m-derived, Output)';
            val = cqm;
            val2 = lqm;
            l_mm = Math.abs(wg * cqm * faktC) * 1e3;
          } else if (isFirst || isLast) {
            type = isFirst ? 'Capacitor (Shunt, π-Input)' : 'Capacitor (Shunt, π-Output)';
            val = c;
            l_mm = Math.abs(wg * c * faktC) * 1e3;
          } else {
            type = 'Capacitor (Shunt)';
            if (anz === 2 && inSteep && outSteep) val = cmm;
            else if ((i === 1 && inSteep) || (i === numComponents - 2 && outSteep)) val = cpm;
            else val = cp;
            l_mm = Math.abs(wg * val * faktC) * 1e3;
          }
        }

        elements.push({
          index: i + 1,
          name: name,
          type: type,
          val: val,
          val2: val2,
          isSeries: isSeries,
          w_mm: w_mm,
          l_mm: l_mm
        });
      }
    } else if (state.art === 'h') {
      // Hochpass (High-Pass)
      var wgh = 2 * Math.PI * fgHz;
      var ch = 1 / (wgh * zo);
      var lh = zo / wgh;
      var cqmh = (ch * mVal) / (1 - mVal * mVal);
      var lqmh = lh / mVal;
      var clmh = ch / mVal;
      var llmh = (lh * mVal) / (1 - mVal * mVal);
      var cr = ch / 2;
      var lp = lh / 2;
      var crm = ch / (1 + mVal);
      var lpm = lh / (1 + mVal);
      var cmmH = ch / (2 * mVal);
      var lmmH = lh / (2 * mVal);

      res.discrete = { c: ch, l: lh, cqm: cqmh, lqm: lqmh, clm: clmh, llm: llmh, cr: cr, lp: lp, crm: crm, lpm: lpm, cmm: cmmH, lmm: lmmH };

      for (var j = 0; j < numComponents; j++) {
        var isFirstH = (j === 0);
        var isLastH = (j === numComponents - 1);
        var isSeriesH = (state.schaltIn === 'p') ? (j % 2 !== 0) : (j % 2 === 0);

        var nameH, typeH, valH, val2H = null, w_mmH, l_mmH;

        if (isSeriesH) {
          nameH = 'C' + (Math.floor(j / 2) + 1);
          w_mmH = res.ms_C.w_mm;
          if (isFirstH && inSteep) {
            typeH = 'Series L-C Tank (Series m-derived, Input)';
            valH = clmh;
            val2H = llmh;
            l_mmH = Math.abs(wgh * clmh * faktC) * 1e3;
          } else if (isLastH && outSteep) {
            typeH = 'Series L-C Tank (Series m-derived, Output)';
            valH = clmh;
            val2H = llmh;
            l_mmH = Math.abs(wgh * clmh * faktC) * 1e3;
          } else if (isFirstH || isLastH) {
            typeH = isFirstH ? 'Capacitor (Series, T-Input)' : 'Capacitor (Series, T-Output)';
            valH = ch;
            l_mmH = Math.abs(wgh * ch * faktC) * 1e3;
          } else {
            typeH = 'Capacitor (Series)';
            if (anz === 2 && inSteep && outSteep) valH = cmmH;
            else if ((j === 1 && inSteep) || (j === numComponents - 2 && outSteep)) valH = crm;
            else valH = cr;
            l_mmH = Math.abs(wgh * valH * faktC) * 1e3;
          }
        } else {
          nameH = 'L' + (Math.floor(j / 2) + 1);
          w_mmH = res.ms_L.w_mm;
          if (isFirstH && inSteep) {
            typeH = 'Shunt L-C Tank (Shunt m-derived, Input)';
            valH = lqmh;
            val2H = cqmh;
            l_mmH = Math.abs(wgh * lqmh * faktL) * 1e3;
          } else if (isLastH && outSteep) {
            typeH = 'Shunt L-C Tank (Shunt m-derived, Output)';
            valH = lqmh;
            val2H = cqmh;
            l_mmH = Math.abs(wgh * lqmh * faktL) * 1e3;
          } else if (isFirstH || isLastH) {
            typeH = isFirstH ? 'Inductor (Shunt, π-Input)' : 'Inductor (Shunt, π-Output)';
            valH = lh;
            l_mmH = Math.abs(wgh * lh * faktL) * 1e3;
          } else {
            typeH = 'Inductor (Shunt)';
            if (anz === 2 && inSteep && outSteep) valH = lmmH;
            else if ((j === 1 && inSteep) || (j === numComponents - 2 && outSteep)) valH = lpm;
            else valH = lp;
            l_mmH = Math.abs(wgh * valH * faktL) * 1e3;
          }
        }

        elements.push({
          index: j + 1,
          name: nameH,
          type: typeH,
          val: valH,
          val2: val2H,
          isSeries: isSeriesH,
          w_mm: w_mmH,
          l_mm: l_mmH
        });
      }
    } else if (state.art === 'p') {
      // Bandpass (Bandpaß)
      var f0 = Math.sqrt(fuHz * foHz);
      var df = foHz - fuHz;
      var fbw = df / f0;

      if (state.tech === 's') {
        // Parallel-Coupled Line Microstrip Bandpass Filter (Fig. 9 / BERECH.PAS)
        var n_res = Math.max(2, Math.min(6, Math.floor(anz / 2) || 4)); // number of resonators
        var n_stages = n_res + 1; // number of coupled sections
        var g = [];
        g[0] = Math.PI * fbw / 2;
        for (var gi = 1; gi <= n_res; gi++) {
          g[gi] = 2 * Math.sin(((2 * gi - 1) * Math.PI) / (2 * n_res));
        }

        var coupledList = [];
        for (var ci = 1; ci <= n_stages; ci++) {
          var gPrev = (ci === 1) ? g[0] : g[ci - 1];
          var gCur = (ci === n_stages) ? g[0] : g[ci];
          var invFak = (Math.PI * fbw / 2) * Math.sqrt(1 / (gPrev * gCur));
          var zoe = zo * (1 + invFak + invFak * invFak);
          var zoo = zo * (1 - invFak + invFak * invFak);

          // Single-line equivalent impedance for width calculation
          var z_se = Math.sqrt(zoe * zoo);
          var ms_coupl = calcMicrostripWh(z_se);

          // Physical gap spacing s from odd/even mode ratio
          var rho = zoe / zoo;
          var gap_s_mm = Math.max(0.18, Math.min(2.0, (0.15 + (rho - 1) * 0.42) * subH_m * 1e3));

          // Physical length l = lambda_g / 4
          var lambda_g0 = (c_speed / f0) / Math.sqrt(ms_coupl.ereff);
          var len_mm = (lambda_g0 / 4) * 1e3;
          var dl_stage = openEndDl_mm(ms_coupl.wh, ms_coupl.ereff);

          coupledList.push({
            index: ci,
            name: 'Coupler ' + ci,
            type: (ci === 1) ? 'Input Coupled Stage' : (ci === n_stages ? 'Output Coupled Stage' : 'Coupled Resonator ' + (ci - 1)),
            zoe: zoe,
            zoo: zoo,
            w_mm: ms_coupl.w_mm,
            s_mm: gap_s_mm,
            l_mm: len_mm,
            dl_mm: dl_stage,
            ereff: ms_coupl.ereff,
            val: zoe,
            val2: zoo,
            isSeries: true
          });
        }
        res.coupledStages = coupledList;
        elements = coupledList;

      }
      {
        // Discrete LC ladder (lumped prototype). Also kept for the microstrip coupled-line filter so that
        // the frequency response, SPICE and Touchstone exports have a circuit to work with.
        var ladderEls = [];
        var wgu = 2 * Math.PI * fuHz;
        var wgo = 2 * Math.PI * foHz;
        var dw = wgo - wgu;
        var c1 = dw / (wgu * wgo * zo);
        var l1 = zo / dw;
        var c2 = 1 / (zo * dw);
        var l2 = (zo * dw) / (wgo * wgu);
        var c1r = c1 / 2;
        var l1r = 2 * l1;
        var c2p = 2 * c2;
        var l2p = l2 / 2;
        res.discrete = { c1: c1, l1: l1, c2: c2, l2: l2, c1r: c1r, l1r: l1r, c2p: c2p, l2p: l2p };

        for (var k = 0; k < numComponents; k++) {
          var isFirstK = (k === 0);
          var isLastK = (k === numComponents - 1);
          var isSeriesK = (state.schaltIn === 'p') ? (k % 2 !== 0) : (k % 2 === 0);
          var nameK = (isSeriesK ? 'BP-Ser' : 'BP-Shunt') + (Math.floor(k / 2) + 1);
          var typeK, valK, val2K, wK, lK;

          if (isSeriesK) {
            typeK = isFirstK ? 'Series LC Resonator (T-Input)' : (isLastK ? 'Series LC Resonator (T-Output)' : 'Series LC Resonator');
            valK = (isFirstK || isLastK) ? c1 : c1r;
            val2K = (isFirstK || isLastK) ? l1 : l1r;
            wK = res.ms_L.w_mm;
            lK = Math.abs(2 * Math.PI * Math.sqrt(fuHz * foHz) * val2K * faktL) * 1e3;
          } else {
            typeK = isFirstK ? 'Parallel LC Resonator (π-Input)' : (isLastK ? 'Parallel LC Resonator (π-Output)' : 'Parallel LC Resonator');
            valK = (isFirstK || isLastK) ? c2 : c2p;
            val2K = (isFirstK || isLastK) ? l2 : l2p;
            wK = res.ms_C.w_mm;
            lK = Math.abs(2 * Math.PI * Math.sqrt(fuHz * foHz) * valK * faktC) * 1e3;
          }

          ladderEls.push({
            index: k + 1,
            name: nameK,
            type: typeK,
            val: valK,
            val2: val2K,
            isSeries: isSeriesK,
            w_mm: wK,
            l_mm: lK
          });
        }
        res.lumped = ladderEls;
        if (state.tech !== 's') elements = ladderEls;
      }
    }
    // First-order open-end compensation of the wide (capacitive) stepped-impedance lines.
    // Optional (state.endEffects): shortens each wide line by the Hammerstad open-end extension.
    if (state.endEffects && state.tech === 's' && state.art !== 'p') {
      elements.forEach(function (el) {
        var isWide = Math.abs(el.w_mm - res.ms_C.w_mm) < Math.abs(el.w_mm - res.ms_L.w_mm);
        el.l_ideal_mm = el.l_mm;
        if (isWide) {
          el.dl_mm = openEndDl_mm(res.ms_C.wh, res.ms_C.ereff);
          el.l_mm = Math.max(0.25 * el.l_mm, el.l_mm - el.dl_mm);
        }
      });
    }
    res.elements = elements;
    if (!res.lumped) res.lumped = elements;

    // Reference dimensions for tiles
    res.ll_mm = elements.length ? elements[0].l_mm : 12.5;
    res.lc_mm = elements.length > 1 ? elements[1].l_mm : 8.2;

    // --- RF MATCHING TRANSFORMERS & POWER DIVIDERS ---
    // 1. Quarter-wave (λ/4) Microstrip Matching Section (Matches filter Ra to 50 Ohm)
    var zMatch = Math.sqrt(state.ra * 50);
    var ms_Trans = calcMicrostripWh(zMatch);
    var lambda_Trans = (c_speed / fgHz) / Math.sqrt(ms_Trans.ereff);
    res.transformer = {
      zMatch: zMatch,
      w_mm: ms_Trans.w_mm,
      l_mm: (lambda_Trans / 4) * 1e3,
      ereff: ms_Trans.ereff
    };

    // 2. Wilkinson Microstrip Power Divider / Combiner (3 dB split, sqrt(2)*50 = 70.71 Ohm)
    var zWilk = Math.SQRT2 * 50;
    var ms_Wilk = calcMicrostripWh(zWilk);
    var lambda_Wilk = (c_speed / fgHz) / Math.sqrt(ms_Wilk.ereff);
    res.wilkinson = {
      zBranch: zWilk,
      w_mm: ms_Wilk.w_mm,
      l_mm: (lambda_Wilk / 4) * 1e3,
      ereff: ms_Wilk.ereff,
      rIso: 100.0
    };

    res.warnings = buildWarnings(res);
    return res;
  }

  // Physical layout of the parallel-coupled-line band-pass, in mm (y grows downward).
  // Used by BOTH the on-screen drawing and the DXF export, so they can never disagree.
  //
  // Coupled section k (k = 1..N) couples resonator R(k-1) with R(k) over its own length l_k, with
  // strip width w_k and gap s_k. R0 is the input feed and R(N) the output feed. Section k+1 starts
  // where section k ends, so resonator R(k) (k = 1..N-1) runs through sections k and k+1 (= lambda/2)
  // and every resonator is offset sideways from the previous one: the classic edge-coupled staircase.

  function coupledGeometry(fd) {
    var st = fd.coupledStages;
    var N = st.length;
    var feedL = 10;
    var comp = !!state.endEffects; // shorten open ends by the Hammerstad fringing extension
    var X = [], x = feedL, k;
    for (k = 0; k < N; k++) { X[k] = x; x += st[k].l_mm; }
    var endX = x;
    var yc = [0];
    for (k = 0; k < N; k++) yc[k + 1] = yc[k] + st[k].w_mm + st[k].s_mm;

    var rects = [];
    // sec = index of the coupled section the part belongs to; openL / openR = that end is an open circuit
    var add = function (row, x1, x2, w, role, sec, openL, openR) {
      var dl = comp ? (st[sec].dl_mm || 0) : 0;
      if (openL) x1 += dl;
      if (openR) x2 -= dl;
      rects.push({ row: row, x1: x1, x2: x2, yc: yc[row], w: w, role: role });
    };
    // input feed: launch line + first coupled section (its far end is open)
    add(0, 0, X[0], fd.ms_Re.w_mm, 'feed', 0, false, false);
    add(0, X[0], X[0] + st[0].l_mm, st[0].w_mm, 'feed', 0, false, true);
    // resonators R1..R(N-1): part in section j-1 (as R(k+1)) and part in section j (as R(k))
    for (var j = 1; j < N; j++) {
      add(j, X[j - 1], X[j - 1] + st[j - 1].l_mm, st[j - 1].w_mm, 'res', j - 1, true, false);
      add(j, X[j], X[j] + st[j].l_mm, st[j].w_mm, 'res', j, false, true);
    }
    // output feed: last coupled section (its near end is open) + launch line
    add(N, X[N - 1], endX, st[N - 1].w_mm, 'feed', N - 1, true, false);
    add(N, endX, endX + feedL, fd.ms_Ra.w_mm, 'feed', N - 1, false, false);

    var minY = Infinity, maxY = -Infinity;
    rects.forEach(function (r) {
      minY = Math.min(minY, r.yc - r.w / 2);
      maxY = Math.max(maxY, r.yc + r.w / 2);
    });
    return { rects: rects, rows: yc, X: X, N: N, minX: 0, maxX: endX + feedL, minY: minY, maxY: maxY };
  }

  // One list of copper rectangles (mm, y grows downward) for ANY layout: used by the DXF and KiCad exports
  function layoutRects(fd) {
    if (state.art === 'p' && fd.coupledStages && fd.coupledStages.length) {
      var g = coupledGeometry(fd);
      return { rects: g.rects, minX: g.minX, maxX: g.maxX, minY: g.minY, maxY: g.maxY, margin: 6.0,
               inW: fd.ms_Re.w_mm, outW: fd.ms_Ra.w_mm, inY: 0, outY: g.rows[g.N] };
    }
    var feedL = 10, x = 0, rects = [];
    rects.push({ row: 0, x1: 0, x2: feedL, yc: 0, w: fd.ms_Re.w_mm, role: 'feed' });
    x = feedL;
    var maxHalf = fd.ms_Re.w_mm / 2;
    fd.elements.forEach(function (el) {
      var w = el.w_mm || (el.isSeries ? fd.ms_L.w_mm : fd.ms_C.w_mm);
      var l = el.l_mm || (el.isSeries ? fd.ll_mm : fd.lc_mm);
      maxHalf = Math.max(maxHalf, w / 2);
      rects.push({ row: 0, x1: x, x2: x + l, yc: 0, w: w, role: 'line' });
      x += l;
    });
    maxHalf = Math.max(maxHalf, fd.ms_Ra.w_mm / 2);
    rects.push({ row: 0, x1: x, x2: x + feedL, yc: 0, w: fd.ms_Ra.w_mm, role: 'feed' });
    x += feedL;
    return { rects: rects, minX: 0, maxX: x, minY: -maxHalf, maxY: maxHalf, margin: 5.0,
             inW: fd.ms_Re.w_mm, outW: fd.ms_Ra.w_mm, inY: 0, outY: 0 };
  }

  // DXF ASCII R12 Generator for CNC milling and ECAD (KiCad / Altium)

  function generateDxfLayout(filterData) {
    var lines = [
      '0', 'SECTION',
      '2', 'HEADER',
      '9', '$ACADVER', '1', 'AC1009',
      '9', '$INSUNITS', '70', '4', // Millimeters
      '0', 'ENDSEC',
      '0', 'SECTION',
      '2', 'TABLES',
      '0', 'TABLE', '2', 'LAYER', '70', '2',
      '0', 'LAYER', '2', 'TOP_COPPER', '70', '0', '62', '1', '6', 'CONTINUOUS', '0',
      '0', 'LAYER', '2', 'BOARD_EDGE', '70', '0', '62', '3', '6', 'CONTINUOUS', '0',
      '0', 'ENDTAB',
      '0', 'ENDSEC',
      '0', 'SECTION',
      '2', 'ENTITIES'
    ];
    function addRect(layer, x1, y1, x2, y2) {
      lines.push(
        '0', 'POLYLINE', '8', layer, '66', '1', '70', '1',
        '0', 'VERTEX', '8', layer, '10', x1.toFixed(3), '20', y1.toFixed(3), '30', '0.0',
        '0', 'VERTEX', '8', layer, '10', x2.toFixed(3), '20', y1.toFixed(3), '30', '0.0',
        '0', 'VERTEX', '8', layer, '10', x2.toFixed(3), '20', y2.toFixed(3), '30', '0.0',
        '0', 'VERTEX', '8', layer, '10', x1.toFixed(3), '20', y2.toFixed(3), '30', '0.0',
        '0', 'SEQEND'
      );
    }
    var lay = layoutRects(filterData);
    lay.rects.forEach(function (r) {
      // DXF y axis points up, our geometry grows downward
      addRect('TOP_COPPER', r.x1, -(r.yc + r.w / 2), r.x2, -(r.yc - r.w / 2));
    });
    addRect('BOARD_EDGE', lay.minX - 2.0, -(lay.maxY + lay.margin), lay.maxX + 2.0, -(lay.minY - lay.margin));
    lines.push('0', 'ENDSEC', '0', 'EOF');
    return lines.join('\n');
  }

  // KiCad footprint (.kicad_mod, KiCad 7/8 s-expression): copper polygons on F.Cu, two SMD launch pads, courtyard
  function generateKicadFootprint(fd) {
    var lay = layoutRects(fd);
    var f = function (v) { return Number(v).toFixed(4); };
    var out = [];
    out.push('(footprint "MFC_Filter" (version 20221018) (generator "microstrip-filter-calculator")');
    out.push('  (layer "F.Cu")');
    out.push('  (descr "Microstrip filter layout, synthesized by Microstrip Filter Calculator")');
    out.push('  (attr smd)');
    lay.rects.forEach(function (r) {
      var y1 = r.yc - r.w / 2, y2 = r.yc + r.w / 2;
      out.push('  (fp_poly (pts (xy ' + f(r.x1) + ' ' + f(y1) + ') (xy ' + f(r.x2) + ' ' + f(y1) + ') (xy ' + f(r.x2) + ' ' + f(y2) + ') (xy ' + f(r.x1) + ' ' + f(y2) + '))');
      out.push('    (stroke (width 0) (type solid)) (fill solid) (layer "F.Cu"))');
    });
    var padL = 1.0;
    out.push('  (pad "1" smd rect (at ' + f(lay.minX + padL / 2) + ' ' + f(lay.inY) + ') (size ' + f(padL) + ' ' + f(lay.inW) + ') (layers "F.Cu"))');
    out.push('  (pad "2" smd rect (at ' + f(lay.maxX - padL / 2) + ' ' + f(lay.outY) + ') (size ' + f(padL) + ' ' + f(lay.outW) + ') (layers "F.Cu"))');
    var cm = lay.margin;
    out.push('  (fp_rect (start ' + f(lay.minX - 2) + ' ' + f(lay.minY - cm) + ') (end ' + f(lay.maxX + 2) + ' ' + f(lay.maxY + cm) + ')');
    out.push('    (stroke (width 0.05) (type solid)) (fill none) (layer "F.CrtYd"))');
    out.push('  (fp_text reference "REF**" (at ' + f((lay.minX + lay.maxX) / 2) + ' ' + f(lay.minY - cm - 1) + ') (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))');
    out.push(')');
    return out.join('\n') + '\n';
  }

  // SPICE netlist (.cir) of the lumped filter: source + Re, ladder of the synthesized elements, load Ra.
  // Works with ngspice, LTspice, Qucs-S and any other SPICE-3 compatible simulator.
  // For the microstrip coupled-line band-pass this is the equivalent lumped band-pass prototype.
  function generateSpiceNetlist(filterData) {
    var els = filterData.lumped || filterData.elements;
    if (!els || !els.length) return null;

    var num = function (v) { return Math.abs(v).toExponential(5); };
    var clean = function (n) { return String(n).replace(/[^A-Za-z0-9]/g, ''); };
    // SPICE derives the device type from the first letter of its name
    var dev = function (type, el) {
      var c = clean(el.name);
      return (c.charAt(0).toUpperCase() === type) ? c : type + '_' + c;
    };

    var kind = state.art === 't' ? 'Low-pass' : (state.art === 'h' ? 'High-pass' : 'Band-pass');
    var out = [];
    out.push('* ' + (opts.title || 'Microstrip & Discrete Filter Calculator') + ' - SPICE netlist');
    if (state.art === 'p' && state.tech === 's') out.push('* Lumped band-pass prototype of the microstrip coupled-line filter (the coupled-line layout itself is not modelled here).');
    out.push('* ' + kind + ' LC ladder, ' + els.length + ' elements, ' + state.schaltIn.toUpperCase().replace('P', 'Pi') + ' input / ' + state.schaltOut.toUpperCase().replace('P', 'Pi') + ' output');
    out.push('* Re = ' + state.re.toFixed(2) + ' ohm, Ra = ' + state.ra.toFixed(2) + ' ohm, Zo = ' + filterData.zo.toFixed(2) + ' ohm');
    if (state.art === 'p') {
      out.push('* Pass band ' + fmtFreq(toHz(state.fu, state.fuUnit)) + ' ... ' + fmtFreq(toHz(state.fo, state.foUnit)));
    } else {
      out.push('* Cutoff fc = ' + fmtFreq(filterData.cutoff));
    }
    out.push('* All values in SI units (H, F, ohm, Hz).');
    out.push('');
    out.push('VIN src 0 AC 1');
    out.push('RS src n0 ' + num(state.re));

    var cur = 'n0', idx = 0, mid = 0;
    var add = function (name, a, b, val) { out.push(name + ' ' + a + ' ' + b + ' ' + num(val)); };

    els.forEach(function (el) {
      var lc = elemLC(el);
      var twoPart = (el.val2 !== null && el.val2 !== undefined);
      var tk = twoPart ? elemTankKind(el) : null;
      out.push('* ' + el.name + ': ' + el.type);
      if (el.isSeries) {
        var nxt = 'n' + (++idx);
        if (!twoPart) {
          if (lc.primary === 'L') add(dev('L', el), cur, nxt, lc.L); else add(dev('C', el), cur, nxt, lc.C);
        } else if (tk === 'parallel') {
          add(dev('L', el), cur, nxt, lc.L);
          add(dev('C', el), cur, nxt, lc.C);
        } else {
          var m1 = 'm' + (++mid);
          add(dev('C', el), cur, m1, lc.C);
          add(dev('L', el), m1, nxt, lc.L);
        }
        cur = nxt;
      } else {
        if (!twoPart) {
          if (lc.primary === 'L') add(dev('L', el), cur, '0', lc.L); else add(dev('C', el), cur, '0', lc.C);
        } else if (tk === 'parallel') {
          add(dev('L', el), cur, '0', lc.L);
          add(dev('C', el), cur, '0', lc.C);
        } else {
          var m2 = 'm' + (++mid);
          add(dev('C', el), cur, m2, lc.C);
          add(dev('L', el), m2, '0', lc.L);
        }
      }
    });

    out.push('RL ' + cur + ' 0 ' + num(state.ra));
    var text = out.join('\n').replace(new RegExp('\\b' + cur + '\\b', 'g'), 'out');

    var f0 = filterData.f0 || filterData.cutoff || 1e6;
    var fLo = f0 / 100, fHi = f0 * 10;
    var tail = [
      '',
      '* Frequency sweep: 100 points per decade, 1/100 ... 10x of the ' + (state.art === 'p' ? 'center' : 'cutoff') + ' frequency',
      '.AC DEC 100 ' + num(fLo) + ' ' + num(fHi),
      '.PRINT AC VDB(out) VP(out)',
      '* LTspice: plot V(out)/V(src) after the run. ngspice: plot vdb(out)',
      '.END',
      ''
    ];
    return text + '\n' + tail.join('\n');
  }


  // ======================= NETWORK ANALYSIS (ABCD cascade) =======================
  // Complex numbers are [re, im] pairs. The lumped ladder is analysed exactly, element by element,
  // with the source resistance Re and the load resistance Ra, so every plot / export reflects the actual circuit.
  var ONE = [1, 0], ZERO = [0, 0];
  function cadd(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
  function cmul(a, b) { return [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]; }
  function cdiv(a, b) { var d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; }
  function cabs(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1]); }
  function mmul(M, N) {
    return [
      cadd(cmul(M[0], N[0]), cmul(M[1], N[2])), cadd(cmul(M[0], N[1]), cmul(M[1], N[3])),
      cadd(cmul(M[2], N[0]), cmul(M[3], N[2])), cadd(cmul(M[2], N[1]), cmul(M[3], N[3]))
    ];
  }

  // ABCD matrix of one ladder element at angular frequency w
  function elementABCD(el, w) {
    var lc = elemLC(el);
    var zL = lc.L != null ? [0, w * lc.L] : null;
    var zC = lc.C != null ? [0, -1 / (w * lc.C)] : null;
    var yL = lc.L != null ? [0, -1 / (w * lc.L)] : null;
    var yC = lc.C != null ? [0, w * lc.C] : null;
    var Z = null, Y = null;
    if (el.val2 === null || el.val2 === undefined) {          // single L or C
      if (lc.primary === 'L') { Z = zL; Y = yL; } else { Z = zC; Y = yC; }
    } else {                                                  // two-part element (m-derived tank / band-pass resonator)
      var par = elemTankKind(el) === 'parallel';
      if (el.isSeries) Z = par ? cdiv(ONE, cadd(yL, yC)) : cadd(zL, zC);
      else Y = par ? cadd(yL, yC) : cdiv(ONE, cadd(zL, zC));
    }
    return el.isSeries ? [ONE, Z, ZERO, ONE] : [ONE, ZERO, Y, ONE];
  }

  function ladderABCD(els, w) {
    var M = [ONE, ZERO, ZERO, ONE];
    els.forEach(function (el) { M = mmul(M, elementABCD(el, w)); });
    return M;
  }

  // Lossless transmission-line section
  function tlineABCD(Z, theta) {
    var c = Math.cos(theta), s = Math.sin(theta);
    return [[c, 0], [0, Z * s], [0, s / Z], [c, 0]];
  }

  // Is this stepped-impedance element the narrow (high-Z) or the wide (low-Z) line?
  function isNarrowLine(el, fd) {
    return Math.abs(el.w_mm - fd.ms_L.w_mm) <= Math.abs(el.w_mm - fd.ms_C.w_mm);
  }

  // Ideal-line model of the stepped-impedance low-pass layout (every section lies in the signal path)
  function tlineChainABCD(fd, f) {
    var M = [ONE, ZERO, ZERO, ONE];
    fd.elements.forEach(function (el) {
      var narrow = isNarrowLine(el, fd);
      var Z = narrow ? fd.zHigh : fd.zLow;
      var ee = narrow ? fd.ms_L.ereff : fd.ms_C.ereff;
      var theta = 2 * Math.PI * f * Math.sqrt(ee) * (el.l_mm * 1e-3) / 3e8;
      M = mmul(M, tlineABCD(Z, theta));
    });
    return M;
  }

  // Transducer response between source resistance Rs and load resistance RL.
  // |S21|^2 = 4 Rs RL / |A RL + B + C Rs RL + D Rs|^2   (generalised S-parameters, reference Rs / RL)
  function terminated(M, Rs, RL) {
    var den = cadd(cadd(cmul(M[0], [RL, 0]), M[1]), cadd(cmul(M[2], [Rs * RL, 0]), cmul(M[3], [Rs, 0])));
    var s21 = cdiv([2 * Math.sqrt(Rs * RL), 0], den);
    var zin = cdiv(cadd(cmul(M[0], [RL, 0]), M[1]), cadd(cmul(M[2], [RL, 0]), M[3]));
    var gam = cdiv([zin[0] - Rs, zin[1]], [zin[0] + Rs, zin[1]]);
    var db = function (c) { return 20 * Math.log10(Math.max(cabs(c), 1e-10)); };
    var s21dB = db(s21);
    return { s21: s21, s21dB: s21dB, s11dB: db(gam), gam: gam, zin: zin, aDb: -s21dB, aNep: -s21dB / 8.685889638 };
  }

  // model: 'lumped' (default, ideal LC ladder) or 'tline' (ideal microstrip sections, low-pass layouts only)
  function responseAt(fd, fHz, model) {
    var w = 2 * Math.PI * fHz;
    var M = (model === 'tline') ? tlineChainABCD(fd, fHz) : ladderABCD(fd.lumped || fd.elements, w);
    return terminated(M, state.re, state.ra);
  }
  function hasTlineModel(fd) {
    return state.tech === 's' && state.art === 't' && fd.elements && fd.elements.length > 0;
  }

  // Two-port S-parameters of the bare filter with a common reference impedance (default 50 ohm), for Touchstone
  function sParams(fd, fHz, z0) {
    z0 = z0 || 50;
    var M = ladderABCD(fd.lumped || fd.elements, 2 * Math.PI * fHz);
    var A = M[0], B = cdiv(M[1], [z0, 0]), C = cmul(M[2], [z0, 0]), D = M[3];
    var den = cadd(cadd(A, B), cadd(C, D));
    var sub = function (a, b) { return [a[0] - b[0], a[1] - b[1]]; };
    var det = sub(cmul(M[0], M[3]), cmul(M[1], M[2]));
    return {
      s11: cdiv(sub(cadd(A, B), cadd(C, D)), den),
      s21: cdiv([2, 0], den),
      s12: cdiv(cmul([2, 0], det), den),
      s22: cdiv(sub(cadd(sub(D, A), B), C), den)
    };
  }

  function sweepRange(fd) {
    var f0 = fd.f0 || fd.cutoff || 1e6;
    return state.art === 'p' ? [f0 / 3, f0 * 3] : [f0 / 10, f0 * 3];
  }

  // Touchstone 1.0 two-port file, 401 linear points, S-parameters in real/imaginary form, 50 ohm reference
  function generateTouchstone(fd) {
    var r = sweepRange(fd), n = 401;
    var out = [];
    out.push('! ' + (opts.title || 'Microstrip & Discrete Filter Calculator') + ' - Touchstone S2P (ideal lumped LC ladder)');
    out.push('! ' + (state.art === 't' ? 'Low-pass' : (state.art === 'h' ? 'High-pass' : 'Band-pass')) + ', ' + (fd.lumped || fd.elements).length + ' elements, Zo = ' + fd.zo.toFixed(2) + ' ohm');
    out.push('! S-parameters of the filter alone, referenced to 50 ohm');
    out.push('# Hz S RI R 50');
    var fmt = function (c) { return c[0].toExponential(6) + ' ' + c[1].toExponential(6); };
    for (var i = 0; i < n; i++) {
      var f = r[0] + (r[1] - r[0]) * i / (n - 1);
      var sp = sParams(fd, f, 50);
      out.push(f.toFixed(1) + ' ' + fmt(sp.s11) + ' ' + fmt(sp.s21) + ' ' + fmt(sp.s12) + ' ' + fmt(sp.s22));
    }
    return out.join('\n') + '\n';
  }

  // SPICE netlist of the physical stepped-impedance low-pass: ideal lossless T-line per section
  function generateSpiceTline(fd) {
    if (!hasTlineModel(fd)) return null;
    var num = function (v) { return Math.abs(v).toExponential(5); };
    var out = [];
    out.push('* ' + (opts.title || 'Microstrip & Discrete Filter Calculator') + ' - SPICE netlist (ideal microstrip transmission lines)');
    out.push('* Stepped-impedance low-pass, ' + fd.elements.length + ' sections, Re = ' + state.re.toFixed(2) + ' ohm, Ra = ' + state.ra.toFixed(2) + ' ohm');
    out.push('* er = ' + state.er + ', h = ' + state.h + ' mm. Lossless, non-dispersive; no step, open-end or bend discontinuities.');
    out.push('');
    out.push('VIN src 0 AC 1');
    out.push('RS src n0 ' + num(state.re));
    var cur = 'n0';
    fd.elements.forEach(function (el, i) {
      var narrow = isNarrowLine(el, fd);
      var Z = narrow ? fd.zHigh : fd.zLow;
      var ee = narrow ? fd.ms_L.ereff : fd.ms_C.ereff;
      var td = (el.l_mm * 1e-3) * Math.sqrt(ee) / 3e8;
      var nxt = 'n' + (i + 1);
      out.push('* ' + el.name + ': ' + (narrow ? 'narrow' : 'wide') + ' line, w = ' + el.w_mm.toFixed(3) + ' mm, l = ' + el.l_mm.toFixed(3) + ' mm');
      out.push('T' + (i + 1) + ' ' + cur + ' 0 ' + nxt + ' 0 Z0=' + num(Z) + ' TD=' + num(td));
      cur = nxt;
    });
    out.push('RL ' + cur + ' 0 ' + num(state.ra));
    var text = out.join('\n').replace(new RegExp('\\b' + cur + '\\b', 'g'), 'out');
    var f0 = fd.f0 || fd.cutoff || 1e6;
    return text + '\n\n.AC DEC 100 ' + num(f0 / 100) + ' ' + num(f0 * 10) + '\n.PRINT AC VDB(out) VP(out)\n.END\n';
  }

  // ======================= INPUT CHECKS & FEASIBILITY WARNINGS =======================
  // Each entry: { level: 'error' | 'warn' | 'info', text }
  function buildWarnings(res) {
    var W = [];
    var add = function (level, text) { W.push({ level: level, text: text }); };
    var fgHz = toHz(state.fg, state.fgUnit), fuHz = toHz(state.fu, state.fuUnit);
    var foHz = toHz(state.fo, state.foUnit), fsHz = toHz(state.fs, state.fsUnit);
    var micro = state.tech === 's';
    var steep = (state.steep !== 'none') && (state.art === 't' || state.art === 'h');

    if (!(state.re > 0)) add('error', 'Source resistance Re must be greater than 0 Ω.');
    if (!(state.ra > 0)) add('error', 'Load resistance Ra must be greater than 0 Ω.');
    if (state.art === 'p') {
      if (!(fuHz > 0)) add('error', 'Lower band edge fu must be greater than 0.');
      else if (!(foHz > fuHz)) add('error', 'Upper band edge fo must be above the lower band edge fu.');
      else if (micro && (foHz - fuHz) / res.f0 > 0.3) add('warn', 'Fractional bandwidth is ' + (100 * res.b).toFixed(0) + ' %. The parallel-coupled-line design equations are a narrow-band approximation (about 20 % or less); expect noticeable deviation.');
    } else {
      if (!(fgHz > 0)) add('error', 'Cutoff frequency fc must be greater than 0.');
      if (steep) {
        if (!(fsHz > 0)) add('error', 'Attenuation pole frequency fs must be greater than 0.');
        else if (state.art === 't' && fsHz <= fgHz) add('error', 'For a low-pass the attenuation pole fs must be ABOVE the cutoff fc. m was set to a default of 0.6.');
        else if (state.art === 'h' && fsHz >= fgHz) add('error', 'For a high-pass the attenuation pole fs must be BELOW the cutoff fc. m was set to a default of 0.6.');
      }
    }
    if (micro) {
      if (!(parseFloat(state.er) >= 1)) add('error', 'Substrate permittivity εr must be 1 or larger.');
      if (!(parseFloat(state.h) > 0)) add('error', 'Substrate height h must be greater than 0 mm.');
    }

    if (micro && isFinite(fgHz) && (fgHz > 0 || fuHz > 0)) {
      var lamMin = Math.min(res.lambda_L_mm, res.lambda_C_mm);
      [['ms_L', 'High-impedance (' + res.zHigh + ' Ω) line'], ['ms_C', 'Low-impedance (' + res.zLow + ' Ω) line'],
       ['ms_Re', 'Input line (Re)'], ['ms_Ra', 'Output line (Ra)']].forEach(function (p) {
        var m = res[p[0]];
        if (m.clipped === 'narrow') add('warn', p[1] + ' needs w/h < 0.02, beyond the range of the model. Lower the line impedance, or use a thinner substrate.');
        if (m.clipped === 'wide') add('warn', p[1] + ' needs w/h > 40, beyond the range of the model.');
      });
      if (state.art !== 'p') {
        if (res.ms_L.w_mm < 0.15) add('warn', 'The narrow line is only ' + res.ms_L.w_mm.toFixed(2) + ' mm wide. Below about 0.15 mm etching tolerances dominate. Lower Z-high or use a thinner substrate.');
        if (res.ms_C.w_mm > lamMin / 8) add('warn', 'The wide line (' + res.ms_C.w_mm.toFixed(1) + ' mm) is wider than λ/8 (' + (lamMin / 8).toFixed(1) + ' mm). It stops behaving like a lumped capacitor and cross-resonances appear.');
        var tooLong = res.elements.filter(function (el) { return el.l_mm > (isNarrowLine(el, res) ? res.lambda_L_mm : res.lambda_C_mm) / 8; });
        if (tooLong.length) add('warn', 'Section(s) ' + tooLong.map(function (e) { return e.name; }).join(', ') + ' are longer than λ/8 at fc, so the stepped-impedance approximation of lumped L and C is poor there. Use a lower fc, more sections, or a different Z-high / Z-low.');
        var tiny = res.elements.filter(function (el) { return el.l_mm < 0.2; });
        if (tiny.length) add('warn', 'Section(s) ' + tiny.map(function (e) { return e.name; }).join(', ') + ' are shorter than 0.2 mm, below practical fabrication resolution.');
        if (res.zo >= res.zHigh) add('warn', 'Nominal Zo (' + res.zo.toFixed(1) + ' Ω) is not below the high-impedance line (' + res.zHigh + ' Ω); the length formula for the narrow line is invalid. Raise Z-high.');
        if (res.zo <= res.zLow) add('warn', 'Nominal Zo (' + res.zo.toFixed(1) + ' Ω) is not above the low-impedance line (' + res.zLow + ' Ω); the length formula for the wide line is invalid. Lower Z-low.');
      }
      if (parseFloat(state.h) > 0.05 * lamMin) add('warn', 'The substrate is thick compared with the wavelength (h > λ/20). Dispersion and surface waves are not modelled.');
      if (state.art === 'h') add('info', 'A high-pass built from stepped-impedance lines is a rough layout study only. Practical microstrip high-pass filters use series gap or interdigital capacitors with shunt stubs.');
      if (state.art === 'p') add('info', 'The coupling gap s is an empirical estimate from the even/odd-mode impedance ratio, not a field solution. Verify gap and lengths with an EM simulator before fabrication.');
      if (!state.endEffects) add('info', 'Open-end fringing is not compensated. Enable "Compensate open-end fringing" to shorten the lines by the Hammerstad extension.');
    }
    if (!micro) {
      var small = (res.lumped || []).filter(function (el) {
        var lc = elemLC(el);
        return (lc.C != null && lc.C < 0.2e-12) || (lc.L != null && lc.L < 1e-9);
      });
      if (small.length) add('warn', 'Element(s) ' + small.map(function (e) { return e.name; }).join(', ') + ' have values below 0.2 pF or 1 nH. Parasitics of real parts will dominate; consider a different impedance level.');
    }
    return W;
  }

    return {
      validateSections: validateSections,
      UNIT_MULTIPLIERS: UNIT_MULTIPLIERS,
      toHz: toHz, fmtFreq: fmtFreq, fmtCap: fmtCap, fmtInd: fmtInd,
      elemLC: elemLC, elemTankKind: elemTankKind, elemValueText: elemValueText, elemLineZ: elemLineZ,
      calcFilter: calcFilter,
      coupledGeometry: coupledGeometry,
      generateDxfLayout: generateDxfLayout,
      generateSpiceNetlist: generateSpiceNetlist,
      generateSpiceTline: generateSpiceTline,
      generateTouchstone: generateTouchstone,
      generateKicadFootprint: generateKicadFootprint,
      layoutRects: layoutRects,
      responseAt: responseAt,
      hasTlineModel: hasTlineModel,
      sParams: sParams,
      sweepRange: sweepRange,
      isNarrowLine: isNarrowLine,
      ladderABCD: ladderABCD,
      buildWarnings: buildWarnings
    };
  }

  root.MFCCore = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
