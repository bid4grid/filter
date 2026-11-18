/**
 * Microstrip & Discrete Filter Calculator - Single Page Application Engine
 * Replicates and modernizes the 1990 Turbo Pascal CAD suite by Ralf Offermann.
 * Follows the visual design system of T-Shirt Quilt Tracker.
 */
(function () {
  'use strict';

  var DEFAULT_CFG = {
    theme: { primary: '#1f3a5f', accent: '#e07a3f', default_zo: '50', title: 'Microstrip Filter Calculator' },
    helpUrl: 'help.html',
    embedded: false
  };

  // One independent calculator per container: every instance gets its own state, config and DOM,
  // so several [microstrip_filter_calculator] shortcodes can live on the same page.
  function createApp(CFG, container) {

  // Application State
  var state = {
    tab: 'calc', // 'calc', 'attenuation', 'impedance', 'table', 'help'
    tech: 's',   // 'd' (discrete) or 's' (microstrip)
    art: 't',    // 't' (low-pass), 'h' (high-pass), 'p' (band-pass)
    schaltIn: 'p',  // 'p' (pi) or 't' (T)
    schaltOut: 'p', // 'p' (pi) or 't' (T)
    steep: 'none',  // 'none', 'in', 'out', 'both'
    sections: 4,    // number of half-sections (even for pi-pi / T-T; odd for pi-T / T-pi)
    autoRa: true,   // auto-calculate matched load resistance according to image parameter theory
    re: parseFloat(CFG.theme.default_zo) || 50,
    ra: parseFloat(CFG.theme.default_zo) || 50,
    fg: 1000,
    fgUnit: 'm', // 'h' (Hz), 'k' (kHz), 'm' (MHz), 'g' (GHz)
    fu: 800,
    fuUnit: 'm',
    fo: 1200,
    foUnit: 'm',
    fs: 1300,
    fsUnit: 'm',
    substrate: 'ro4003c', // 'ro4003c', 'duroid5880', 'fr4', 'epoxy', 'alumina', 'hostalen', 'teflon', 'custom'
    er: 3.55,
    h: 1.0, // mm
    dbScale: 40, // 10, 20, 40, 100, 'neper'
    plotMode: 's_param', // 'atten' (raw attenuation a(f)) or 's_param' (S21 transmission & S11 return loss)
    canvasTheme: 'light', // 'light' (modern high-contrast engineering CAD style) or 'dark' (retro night style)
    zHigh: 120,        // impedance of the narrow (inductive) microstrip line, ohm
    zLow: 20,          // impedance of the wide (capacitive) microstrip line, ohm
    endEffects: false, // compensate open-end fringing
    showTline: false,  // overlay the ideal microstrip (T-line) response
    fitView: false, // false allows 1:1 scale with horizontal scrolling; true scales down to fit container
    cursorFreq: null,
    cursorAtten: null
  };

  // Helper DOM Builder
  function h(tag, attrs) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === 'class') el.className = attrs[k];
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
      else if (k === 'checked') el.checked = !!attrs[k];
      else if (k === 'selected') {
        el.selected = !!attrs[k];
        if (attrs[k]) el.setAttribute('selected', 'selected');
      }
      else if (k === 'value') {
        if (tag !== 'select') el.value = attrs[k];
      }
      else el.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child == null || child === false) continue;
      if (Array.isArray(child)) {
        child.forEach(function (c) { if (c != null && c !== false) el.appendChild(c.nodeType ? c : document.createTextNode(String(c))); });
      } else {
        el.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
      }
    }
    // For <select>, apply value and selectedIndex AFTER all <option> children have been appended
    if (tag === 'select' && attrs.value !== undefined) {
      var targetVal = String(attrs.value);
      el.value = targetVal;
      if (el.options && el.options.length) {
        for (var o = 0; o < el.options.length; o++) {
          if (String(el.options[o].value) === targetVal) {
            el.options[o].selected = true;
            el.selectedIndex = o;
          } else {
            el.options[o].selected = false;
          }
        }
      }
    }
    return el;
  }

  // Small "?" help button with a popover. Opens on hover, click/tap or keyboard (Enter/Space), closes on
  // Escape, outside click or when focus leaves. Clicking pins it open (needed on touch screens).
  var helpSeq = 0;
  function helpIcon(title, text) {
    var id = 'mfc-help-' + (++helpSeq) + '-' + Math.floor(Math.random() * 1e6);
    var pop = h('span', { class: 'mfc-help-pop', role: 'tooltip', id: id },
      h('strong', {}, title),
      h('span', {}, text)
    );
    var btn = h('button', { type: 'button', class: 'mfc-help-btn', 'aria-label': 'Help: ' + title, 'aria-expanded': 'false', 'aria-describedby': id }, '?');
    var wrap = h('span', { class: 'mfc-help' }, btn, pop);
    wrap._pinned = false;
    function place() {
      pop.style.left = '';
      var r = pop.getBoundingClientRect();
      var vw = document.documentElement.clientWidth;
      if (r.right > vw - 8) pop.style.left = (-(r.right - (vw - 8)) + 'px');
      r = pop.getBoundingClientRect();
      if (r.left < 8) pop.style.left = (parseFloat(pop.style.left || 0) + (8 - r.left)) + 'px';
    }
    function open() { wrap.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); place(); }
    function close() { wrap._pinned = false; wrap.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
    wrap._close = close;
    btn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (wrap.classList.contains('open') && wrap._pinned) { close(); } else { wrap._pinned = true; open(); }
    });
    wrap.addEventListener('mouseenter', function () { if (!wrap.classList.contains('open')) open(); });
    wrap.addEventListener('mouseleave', function () { if (!wrap._pinned) close(); });
    wrap.addEventListener('keydown', function (e) { if (e.key === 'Escape') { close(); btn.focus(); } });
    wrap.addEventListener('focusout', function (e) { if (!wrap.contains(e.relatedTarget)) close(); });
    return wrap;
  }
  function labelWithHelp(text, title, body) {
    return h('span', { class: 'mfc-label-row' }, h('label', {}, text), helpIcon(title, body));
  }
  document.addEventListener('click', function (e) {
    var open = container.querySelectorAll('.mfc-help.open');
    for (var i = 0; i < open.length; i++) { if (!open[i].contains(e.target) && open[i]._close) open[i]._close(); }
  });

  // --- calculation core (assets/core.js): synthesis, analysis, layout geometry, exports ---
  var core = window.MFCCore.create(state, { title: CFG.theme && CFG.theme.title });
  var validateSections = core.validateSections;
  var UNIT_MULTIPLIERS = core.UNIT_MULTIPLIERS;
  var toHz = core.toHz, fmtFreq = core.fmtFreq, fmtCap = core.fmtCap, fmtInd = core.fmtInd;
  var elemLC = core.elemLC, elemTankKind = core.elemTankKind, elemValueText = core.elemValueText, elemLineZ = core.elemLineZ;
  var calcFilter = core.calcFilter;
  var coupledGeometry = core.coupledGeometry;
  var generateDxfLayout = core.generateDxfLayout;
  var generateSpiceNetlist = core.generateSpiceNetlist;

  // --- EXPORT & SIMULATION HELPERS ---

  function downloadFile(filename, content, mimeType) {
    mimeType = mimeType || 'text/plain;charset=utf-8';
    var blob = new Blob([content], { type: mimeType });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    setTimeout(function () { document.body.removeChild(link); }, 100);
  }

  // --- HTML5 CANVAS DRAWING FUNCTIONS ---

  // Pre-computes sizes/positions for the planar microstrip drawings so that labels
  // always have room (strip lengths are widened to fit their text) and the canvas can
  // be grown to fit instead of letting elements and labels pile on top of each other.
  function planMicrostripLayout(filterData, canvasW) {
    var sc = document.createElement('canvas').getContext('2d');
    var hMm = parseFloat(state.h) || 1;
    var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
    var fin = function (v, fallback) { return isFinite(v) ? v : fallback; };
    var pxW = function (wMm, lo, hi) { return clamp(fin((wMm / hMm) * 5, lo), lo, hi); }; // width in px, h-independent
    var textW = function (txt, font) { sc.font = font; return sc.measureText(txt).width; };
    var feedL = 46;
    var plan = { feedL: feedL };
    plan.feedInW = pxW(filterData.ms_Re.w_mm, 5, 40);
    plan.feedOutW = pxW(filterData.ms_Ra.w_mm, 5, 40);
    var contentW;

    if (state.art === 'p' && filterData.coupledStages && filterData.coupledStages.length) {
      plan.kind = 'coupled';
      var cg2 = coupledGeometry(filterData);
      var sc = 3.2; // px per mm (same scale both directions; gaps get a 2.5 px floor so they stay visible)
      var rowsPx = [0];
      for (var rk = 0; rk < cg2.N; rk++) {
        var stg2 = filterData.coupledStages[rk];
        // widths and gaps are enlarged for legibility (min 9 px strip, 7 px gap); exact values are in the table
        rowsPx[rk + 1] = rowsPx[rk] + Math.max(stg2.w_mm * sc, 9) + Math.max(stg2.s_mm * sc, 7);
      }
      plan.geo = cg2;
      plan.sc = sc;
      plan.rowsPx = rowsPx;
      plan.topY = 104;
      plan.sidePad = 80; // room for the In / Out labels beside the feeds
      var maxHw = 0;
      cg2.rects.forEach(function (r) { maxHw = Math.max(maxHw, Math.max(r.w * sc, 9) / 2); });
      plan.lowestY = plan.topY + rowsPx[cg2.N] + maxHw;
      plan.tableY = plan.lowestY + 36;
      plan.H = plan.tableY + (cg2.N + 1) * 15 + 12 + 40 + 30 + 14 + 18;
      contentW = (cg2.maxX - cg2.minX) * sc;
    } else {
      plan.kind = 'chain';
      var items = [];
      var sumL = 0;
      var maxHalf = Math.max(plan.feedInW, plan.feedOutW) / 2;
      filterData.elements.forEach(function (el) {
        // Inductive = the narrow (high-Z) line, capacitive = the wide (low-Z) line.
        // Decided from the element's actual width, NOT from series/shunt position
        // (in a high-pass filter the series parts are capacitors).
        var isInd = Math.abs(el.w_mm - filterData.ms_L.w_mm) <= Math.abs(el.w_mm - filterData.ms_C.w_mm);
        var wPx = pxW(el.w_mm, 5, 76);
        var labelW = Math.max(
          textW('w=' + el.w_mm.toFixed(2), '10px monospace'),
          textW('l=' + el.l_mm.toFixed(2), '10px monospace'),
          textW(el.name, 'bold 12px monospace')
        ) + 12;
        var lPx = Math.max(labelW, Math.min(110, fin((el.l_mm || 0) * 2.2, 60)));
        items.push({ el: el, isInd: isInd, wPx: wPx, lPx: lPx });
        sumL += lPx;
        maxHalf = Math.max(maxHalf, wPx / 2);
      });
      plan.items = items;
      plan.nameY = 86;
      plan.midY = plan.nameY + 16 + maxHalf;
      plan.dimY = plan.midY + maxHalf + 24;
      contentW = feedL * 2 + sumL;
      plan.H = plan.dimY + 13 + 22 + 40 + 30 + 14;
    }

    var pad = plan.sidePad || 0;
    plan.W = Math.max(canvasW || 0, contentW + 2 * pad + 48, 640);
    plan.originX = (plan.W - contentW) / 2;
    return plan;
  }

  function drawSchematic(canvas, filterData, overrideTech) {
    var currentTech = overrideTech || state.tech;
    var msPlanPre = null;
    if (currentTech === 's') {
      msPlanPre = planMicrostripLayout(filterData, canvas.width);
      // Grow the canvas to fit the content (resizing clears it, which is fine - we paint next)
      if (canvas.width !== msPlanPre.W) canvas.width = msPlanPre.W;
      var wantH = Math.max(360, Math.ceil(msPlanPre.H));
      if (canvas.height !== wantH) canvas.height = wantH;
    }
    if (currentTech === 'd') {
      // always leave 95 px per element so tanks and labels never get squeezed together
      var needDW = 75 + filterData.elements.length * 95 + 100;
      if (canvas.width < needDW) canvas.width = needDW;
    }
    var ctx = canvas.getContext('2d');
    var w = canvas.width;
    var h = canvas.height;
    var isDark = (state.canvasTheme === 'dark' && !overrideTech);

    // Background
    ctx.fillStyle = isDark ? '#0f172a' : '#ffffff';
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
    ctx.lineWidth = 1;
    for (var x = 0; x < w; x += 30) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (var y = 0; y < h; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

    var primaryColor = isDark ? '#60a5fa' : CFG.theme.primary;
    var accentColor = isDark ? '#fb923c' : CFG.theme.accent;
    var inductorColor = isDark ? '#f87171' : '#dc2626';
    var capacitorColor = isDark ? '#38bdf8' : '#0284c7';
    var textColor = isDark ? '#f1f5f9' : '#1e293b';
    var mutedText = isDark ? '#94a3b8' : '#64748b';

    var midY = h * 0.42;
    var groundY = h * 0.76;

    if (currentTech === 's') {
      var msPlan = msPlanPre;
      var ctxFont = getComputedStyle(document.body).fontFamily;

      // Title + subtitle
      ctx.fillStyle = textColor;
      ctx.font = 'bold 14px ' + ctxFont;
      ctx.textAlign = 'left';
      if (msPlan.kind === 'coupled') {
        ctx.fillText('PARALLEL-COUPLED MICROSTRIP BANDPASS FILTER (λ/4 COUPLED SECTIONS)', 24, 28);
        ctx.font = '12px monospace';
        ctx.fillStyle = mutedText;
        var centerF = Math.sqrt(toHz(state.fu, state.fuUnit) * toHz(state.fo, state.foUnit));
        ctx.fillText('Coupled-Line BPF (Fig. 9) | fo = ' + fmtFreq(centerF) + ' | Re = ' + state.re.toFixed(1) + ' Ω, Ra = ' + state.ra.toFixed(1) + ' Ω', 24, 46);
      } else {
        ctx.fillText('MICROSTRIP TRANSMISSION LINE LAYOUT', 24, 28);
        ctx.font = '12px monospace';
        ctx.fillStyle = mutedText;
        var symLabel = (state.schaltIn === state.schaltOut) ? ('Symmetric (' + (state.schaltIn === 'p' ? 'π-π' : 'T-T') + ')') : ('Asymmetric (' + (state.schaltIn === 'p' ? 'π-T' : 'T-π') + ')');
        ctx.fillText('Topology: ' + symLabel + ' | Re = ' + state.re.toFixed(1) + ' Ω, Ra = ' + state.ra.toFixed(1) + ' Ω | Zo = ' + filterData.zo.toFixed(1) + ' Ω', 24, 46);
      }

      var borderCol = isDark ? '#ffffff' : '#0f172a';
      var leaderCol = isDark ? 'rgba(148,163,184,0.6)' : 'rgba(100,116,139,0.55)';

      // Draws a dotted leader line between a strip edge and its label
      var leader = function (x, y1, y2) {
        ctx.save();
        ctx.strokeStyle = leaderCol;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(x, y1);
        ctx.lineTo(x, y2);
        ctx.stroke();
        ctx.restore();
      };

      var portLabel = function (txt, cx, y) {
        ctx.fillStyle = textColor;
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(txt, cx, y);
      };

      var feedInColor = primaryColor;
      var circuitBottom;

      if (msPlan.kind === 'coupled') {
        // --- PARALLEL-COUPLED LINE BANDPASS: true edge-coupled staircase (same geometry as the DXF) ---
        var cp = msPlan, g = cp.geo, sc = cp.sc;
        var px = function (mm) { return cp.originX + mm * sc; };
        var py = function (row) { return cp.topY + cp.rowsPx[row]; };

        g.rects.forEach(function (r) {
          ctx.fillStyle = (r.role === 'feed') ? primaryColor : '#b45309';
          var rhh = Math.max(r.w * sc, 9);
          var rx = px(r.x1), ry = py(r.row) - rhh / 2, rw = (r.x2 - r.x1) * sc, rh = rhh;
          ctx.fillRect(rx, ry, rw, rh);
          ctx.strokeStyle = borderCol; ctx.lineWidth = 1;
          ctx.strokeRect(rx, ry, rw, rh);
        });

        var rname = function (j) { return j === 0 ? 'In' : (j === g.N ? 'Out' : 'R' + j); };

        // Resonator names sit just left of each resonator's own row (no other strip lives in that row)
        ctx.font = 'bold 10px monospace';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'right';
        ctx.fillStyle = textColor;
        for (var rj = 1; rj < g.N; rj++) ctx.fillText('R' + rj, px(g.X[rj - 1]) - 6, py(rj));

        ctx.font = 'bold 11px sans-serif';
        ctx.fillText('In: ' + state.re.toFixed(1) + ' Ω', px(0) - 8, py(0));
        ctx.textAlign = 'left';
        ctx.fillText('Out: ' + state.ra.toFixed(1) + ' Ω', px(g.maxX) + 8, py(g.N));
        ctx.textBaseline = 'alphabetic';

        // Section table: one row per coupled section (all numbers in one place, nothing to collide)
        var cols = [24, 84, 170, 256, 352, 432, 512];
        var ty = cp.tableY;
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'left';
        ctx.fillStyle = textColor;
        ['Section', 'Width w (mm)', 'Gap s (mm)', 'Length l (mm)', 'Z0e (Ω)', 'Z0o (Ω)', 'Couples'].forEach(function (t, i) { ctx.fillText(t, cols[i], ty); });
        ctx.strokeStyle = leaderCol; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(24, ty + 4); ctx.lineTo(cols[6] + 110, ty + 4); ctx.stroke();
        ctx.font = '10px monospace';
        ctx.fillStyle = mutedText;
        filterData.coupledStages.forEach(function (stg, i) {
          var yy = ty + 19 + i * 15;
          var vals = ['C' + (i + 1), stg.w_mm.toFixed(2), stg.s_mm.toFixed(2), stg.l_mm.toFixed(2), stg.zoe.toFixed(1), stg.zoo.toFixed(1), rname(i) + ' ↔ ' + rname(i + 1)];
          vals.forEach(function (t, c) { ctx.fillText(t, cols[c], yy); });
        });
        circuitBottom = ty + 19 + (filterData.coupledStages.length - 1) * 15;

        ctx.fillStyle = mutedText;
        ctx.font = '10px sans-serif';
        ctx.fillText('w = strip width, s = gap between the coupled strips, l = coupled length. Z0e / Z0o = even- / odd-mode impedance of the coupled pair.', 24, circuitBottom + 22);
        ctx.fillText('Lengths drawn to scale; strip widths and gaps are enlarged for legibility (exact values in the table). Resonators R1…R' + (g.N - 1) + ' are λ/2 long, offset by λ/4 steps.', 24, circuitBottom + 38);
        circuitBottom += 20;

      } else {
        // --- LOW-PASS / HIGH-PASS STEPPED-IMPEDANCE LAYOUT ---
        var lp = msPlan;
        var chainMidY = lp.midY;
        var chX = lp.originX;

        // Input feed
        ctx.fillStyle = feedInColor;
        ctx.fillRect(chX, chainMidY - lp.feedInW / 2, lp.feedL, lp.feedInW);
        ctx.strokeStyle = borderCol; ctx.lineWidth = 1;
        ctx.strokeRect(chX, chainMidY - lp.feedInW / 2, lp.feedL, lp.feedInW);
        portLabel('In: ' + state.re.toFixed(1) + ' Ω', chX + lp.feedL / 2, lp.nameY - 18);
        leader(chX + lp.feedL / 2, lp.nameY - 14, chainMidY - lp.feedInW / 2 - 1);
        chX += lp.feedL;

        lp.items.forEach(function (it) {
          ctx.fillStyle = it.isInd ? inductorColor : capacitorColor;
          ctx.fillRect(chX, chainMidY - it.wPx / 2, it.lPx, it.wPx);
          ctx.strokeStyle = borderCol; ctx.lineWidth = 1;
          ctx.strokeRect(chX, chainMidY - it.wPx / 2, it.lPx, it.wPx);

          var mid = chX + it.lPx / 2;

          // Name above the whole row (same baseline for every element)
          leader(mid, lp.nameY + 3, chainMidY - it.wPx / 2 - 1);
          ctx.fillStyle = it.isInd ? inductorColor : capacitorColor;
          ctx.font = 'bold 12px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(it.el.name, mid, lp.nameY);

          // Dimensions below the whole row (same baseline for every element)
          leader(mid, chainMidY + it.wPx / 2 + 1, lp.dimY - 11);
          ctx.fillStyle = mutedText;
          ctx.font = '10px monospace';
          ctx.fillText('w=' + it.el.w_mm.toFixed(2), mid, lp.dimY);
          ctx.fillText('l=' + it.el.l_mm.toFixed(2), mid, lp.dimY + 13);

          chX += it.lPx;
        });

        // Output feed
        ctx.fillStyle = primaryColor;
        ctx.fillRect(chX, chainMidY - lp.feedOutW / 2, lp.feedL, lp.feedOutW);
        ctx.strokeStyle = borderCol; ctx.lineWidth = 1;
        ctx.strokeRect(chX, chainMidY - lp.feedOutW / 2, lp.feedL, lp.feedOutW);
        portLabel('Out: ' + state.ra.toFixed(1) + ' Ω', chX + lp.feedL / 2, lp.nameY - 18);
        leader(chX + lp.feedL / 2, lp.nameY - 14, chainMidY - lp.feedOutW / 2 - 1);

        circuitBottom = lp.dimY + 13;

        // Legend
        var legY = circuitBottom + 22;
        var legX = 24;
        var swatch = function (col, label) {
          ctx.fillStyle = col;
          ctx.fillRect(legX, legY - 9, 12, 10);
          ctx.strokeStyle = borderCol; ctx.lineWidth = 1;
          ctx.strokeRect(legX, legY - 9, 12, 10);
          ctx.fillStyle = textColor;
          ctx.font = '11px sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(label, legX + 18, legY);
          legX += 18 + ctx.measureText(label).width + 22;
        };
        swatch(inductorColor, 'High-Z line (inductive)');
        swatch(capacitorColor, 'Low-Z line (capacitive)');
        swatch(primaryColor, 'Feed line');
        ctx.fillStyle = mutedText;
        ctx.font = '10px sans-serif';
        ctx.fillText('Dimensions in mm. Widths to scale; lengths scaled for readability.', legX, legY);
        circuitBottom = legY;
      }

      // Substrate cross-section: sits at the bottom, spans the circuit, labels live INSIDE the bars
      var subX = 24;
      var subW = w - 48;
      var subY = Math.max(circuitBottom + 40, h - 58);
      ctx.fillStyle = isDark ? '#1e293b' : '#e2e8f0';
      ctx.fillRect(subX, subY, subW, 24);
      ctx.fillStyle = isDark ? '#475569' : '#94a3b8';
      ctx.fillRect(subX, subY + 24, subW, 6);
      ctx.fillStyle = textColor;
      ctx.font = '11px sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText('Dielectric Substrate (εr = ' + state.er + ', h = ' + state.h + ' mm)', subX + 10, subY + 12);
      ctx.textAlign = 'right';
      ctx.fillStyle = mutedText;
      ctx.fillText('Ground plane (GND) ▾', subX + subW - 10, subY + 12);
      ctx.textBaseline = 'alphabetic';

    } else {
      // --- DISCRETE LC SCHEMATIC DRAWING ---
      ctx.fillStyle = textColor;
      ctx.font = 'bold 14px ' + getComputedStyle(document.body).fontFamily;
      ctx.textAlign = 'left';
      ctx.fillText('DISCRETE LC FILTER SCHEMATIC', 24, 28);
      ctx.font = '12px monospace';
      ctx.fillStyle = mutedText;
      var symLabelD = (state.schaltIn === state.schaltOut) ? ('Symmetric (' + (state.schaltIn === 'p' ? 'π-π' : 'T-T') + ')') : ('Asymmetric (' + (state.schaltIn === 'p' ? 'π-T' : 'T-π') + ')');
      ctx.fillText('Topology: ' + symLabelD + ' | Re = ' + state.re.toFixed(1) + ' Ω, Ra = ' + state.ra.toFixed(1) + ' Ω | Zo = ' + filterData.zo.toFixed(1) + ' Ω', 24, 46);

      var startXc = 75;
      var curXc = startXc;
      var items = filterData.elements;
      var stepX = Math.min(95, (w - 190) / Math.max(1, items.length));

      // Input port
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(curXc, midY, 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(curXc, groundY, 4, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = textColor;
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('IN', curXc - 16, midY - 6);
      ctx.font = '10px monospace';
      ctx.fillStyle = mutedText;
      ctx.fillText(state.re.toFixed(1) + 'Ω', curXc - 16, midY + 12);
      ctx.fillStyle = textColor;
      ctx.fillText('GND', curXc - 18, groundY + 4);

      // Bus line ground
      ctx.strokeStyle = isDark ? '#64748b' : '#94a3b8';
      ctx.beginPath();
      ctx.moveTo(curXc + 4, groundY);
      ctx.lineTo(w - 70, groundY);
      ctx.stroke();

      curXc += 25;

      items.forEach(function (el, index) {
        ctx.strokeStyle = primaryColor;
        ctx.lineWidth = 2;

        if (el.isSeries) {
          // Series element on top rail
          var midElemX = curXc + stepX / 2;

          if (el.val2 && elemTankKind(el) === 'parallel') {
            // Parallel LC tank in series branch
            ctx.beginPath();
            ctx.moveTo(curXc, midY);
            ctx.lineTo(midElemX - 22, midY);
            ctx.lineTo(midElemX - 16, midY - 14);
            ctx.lineTo(midElemX - 4, midY - 14);
            ctx.moveTo(midElemX - 22, midY);
            ctx.lineTo(midElemX - 16, midY + 14);
            ctx.lineTo(midElemX - 12, midY + 14);
            ctx.stroke();

            // Top capacitor
            ctx.strokeStyle = capacitorColor;
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(midElemX - 4, midY - 22);
            ctx.lineTo(midElemX - 4, midY - 6);
            ctx.moveTo(midElemX + 4, midY - 22);
            ctx.lineTo(midElemX + 4, midY - 6);
            ctx.stroke();

            // Bottom inductor
            ctx.strokeStyle = inductorColor;
            ctx.lineWidth = 2.2;
            for (var bi = 0; bi < 2; bi++) {
              ctx.beginPath();
              ctx.arc(midElemX - 6 + bi * 12, midY + 14, 5, Math.PI, 0, false);
              ctx.stroke();
            }

            // Recombine
            ctx.strokeStyle = primaryColor;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(midElemX + 4, midY - 14);
            ctx.lineTo(midElemX + 16, midY - 14);
            ctx.lineTo(midElemX + 22, midY);
            ctx.moveTo(midElemX + 12, midY + 14);
            ctx.lineTo(midElemX + 16, midY + 14);
            ctx.lineTo(midElemX + 22, midY);
            ctx.lineTo(curXc + stepX, midY);
            ctx.stroke();

            ctx.fillStyle = textColor;
            ctx.font = '10px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(el.name, midElemX, midY - 26);
            ctx.fillStyle = capacitorColor;
            ctx.fillText(fmtCap(elemLC(el).C), midElemX, midY - 38);
            ctx.fillStyle = inductorColor;
            ctx.fillText(fmtInd(elemLC(el).L), midElemX, midY + 32);

          } else if (el.val2) {
            // Series LC resonator in the series arm (band-pass): C and L in line
            var lcS = elemLC(el);
            var capX = midElemX - 26;
            ctx.strokeStyle = primaryColor;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(curXc, midY);
            ctx.lineTo(capX - 4, midY);
            ctx.moveTo(capX + 4, midY);
            ctx.lineTo(midElemX - 12, midY);
            ctx.moveTo(midElemX + 24, midY);
            ctx.lineTo(curXc + stepX, midY);
            ctx.stroke();

            ctx.strokeStyle = capacitorColor;
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(capX - 4, midY - 13);
            ctx.lineTo(capX - 4, midY + 13);
            ctx.moveTo(capX + 4, midY - 13);
            ctx.lineTo(capX + 4, midY + 13);
            ctx.stroke();

            ctx.strokeStyle = inductorColor;
            ctx.lineWidth = 2.4;
            for (var sj = 0; sj < 3; sj++) {
              ctx.beginPath();
              ctx.arc(midElemX - 6 + sj * 12, midY, 6, Math.PI, 0, false);
              ctx.stroke();
            }

            ctx.textAlign = 'center';
            ctx.font = 'bold 10px monospace';
            ctx.fillStyle = textColor;
            ctx.fillText(el.name, midElemX, midY - 48);
            ctx.font = '10px monospace';
            ctx.fillStyle = capacitorColor;
            ctx.fillText(fmtCap(lcS.C), midElemX, midY - 36);
            ctx.fillStyle = inductorColor;
            ctx.fillText(fmtInd(lcS.L), midElemX, midY - 24);
          } else {
            // Standard Single Series element
            ctx.beginPath();
            ctx.moveTo(curXc, midY);
            ctx.lineTo(midElemX - 18, midY);
            ctx.stroke();

            if (el.name.indexOf('L') !== -1) {
              // Series Inductor (inductor coils)
              ctx.strokeStyle = inductorColor;
              ctx.lineWidth = 2.5;
              for (var cIdx = 0; cIdx < 3; cIdx++) {
                ctx.beginPath();
                ctx.arc(midElemX - 12 + cIdx * 12, midY, 6, Math.PI, 0, false);
                ctx.stroke();
              }
              ctx.fillStyle = inductorColor;
              ctx.font = '11px monospace';
              ctx.textAlign = 'center';
              ctx.fillText(el.name, midElemX, midY - 14);
              ctx.fillText(fmtInd(el.val), midElemX, midY - 26);
            } else {
              // Series Capacitor (two parallel plates)
              ctx.strokeStyle = capacitorColor;
              ctx.lineWidth = 2.5;
              ctx.beginPath();
              ctx.moveTo(midElemX - 4, midY - 14);
              ctx.lineTo(midElemX - 4, midY + 14);
              ctx.moveTo(midElemX + 4, midY - 14);
              ctx.lineTo(midElemX + 4, midY + 14);
              ctx.stroke();
              ctx.fillStyle = capacitorColor;
              ctx.font = '11px monospace';
              ctx.textAlign = 'center';
              ctx.fillText(el.name, midElemX, midY - 20);
              ctx.fillText(fmtCap(el.val), midElemX, midY - 32);
            }

            ctx.strokeStyle = primaryColor;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(midElemX + 18, midY);
            ctx.lineTo(curXc + stepX, midY);
            ctx.stroke();
          }
        } else {
          // Shunt element from top rail to ground
          var shuntX = curXc + stepX / 2;
          ctx.beginPath();
          ctx.moveTo(curXc, midY);
          ctx.lineTo(curXc + stepX, midY);
          ctx.stroke();

          // Connection dot
          ctx.fillStyle = primaryColor;
          ctx.beginPath();
          ctx.arc(shuntX, midY, 3, 0, Math.PI * 2);
          ctx.fill();

          ctx.beginPath();
          ctx.moveTo(shuntX, midY);
          ctx.lineTo(shuntX, midY + 18);
          ctx.stroke();

          var elemCenterY = midY + 45;

          if (el.val2 && elemTankKind(el) === 'parallel') {
            // Parallel LC resonator in the shunt arm (band-pass): C and L side by side to ground
            var lcP = elemLC(el);
            var topJ = midY + 20, botJ = midY + 74, midJ = (topJ + botJ) / 2;
            ctx.strokeStyle = primaryColor;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(shuntX, midY + 18);
            ctx.lineTo(shuntX, topJ);
            ctx.moveTo(shuntX - 14, topJ);
            ctx.lineTo(shuntX + 14, topJ);
            ctx.moveTo(shuntX - 14, topJ);
            ctx.lineTo(shuntX - 14, midJ - 4);
            ctx.moveTo(shuntX - 14, midJ + 4);
            ctx.lineTo(shuntX - 14, botJ);
            ctx.moveTo(shuntX + 14, topJ);
            ctx.lineTo(shuntX + 14, midJ - 18);
            ctx.moveTo(shuntX + 14, midJ + 18);
            ctx.lineTo(shuntX + 14, botJ);
            ctx.moveTo(shuntX - 14, botJ);
            ctx.lineTo(shuntX + 14, botJ);
            ctx.moveTo(shuntX, botJ);
            ctx.lineTo(shuntX, groundY);
            ctx.stroke();

            ctx.strokeStyle = capacitorColor;
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(shuntX - 24, midJ - 4);
            ctx.lineTo(shuntX - 4, midJ - 4);
            ctx.moveTo(shuntX - 24, midJ + 4);
            ctx.lineTo(shuntX - 4, midJ + 4);
            ctx.stroke();

            ctx.strokeStyle = inductorColor;
            ctx.lineWidth = 2.4;
            for (var pj = 0; pj < 3; pj++) {
              ctx.beginPath();
              ctx.arc(shuntX + 14, midJ - 12 + pj * 12, 6, -Math.PI / 2, Math.PI / 2, false);
              ctx.stroke();
            }

            ctx.textAlign = 'left';
            ctx.font = 'bold 10px monospace';
            ctx.fillStyle = textColor;
            ctx.fillText(el.name, shuntX + 26, midJ - 12);
            ctx.font = '10px monospace';
            ctx.fillStyle = capacitorColor;
            ctx.fillText(fmtCap(lcP.C), shuntX + 26, midJ + 1);
            ctx.fillStyle = inductorColor;
            ctx.fillText(fmtInd(lcP.L), shuntX + 26, midJ + 14);

          } else if (el.val2) {
            // Series LC tank in shunt branch
            // Top capacitor
            ctx.strokeStyle = capacitorColor;
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(shuntX - 12, elemCenterY - 16);
            ctx.lineTo(shuntX + 12, elemCenterY - 16);
            ctx.moveTo(shuntX - 12, elemCenterY - 8);
            ctx.lineTo(shuntX + 12, elemCenterY - 8);
            ctx.stroke();

            // Link wire
            ctx.strokeStyle = primaryColor;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(shuntX, elemCenterY - 8);
            ctx.lineTo(shuntX, elemCenterY + 4);
            ctx.stroke();

            // Bottom inductor coils
            ctx.strokeStyle = inductorColor;
            ctx.lineWidth = 2.2;
            for (var indJ = 0; indJ < 2; indJ++) {
              ctx.beginPath();
              ctx.arc(shuntX, elemCenterY + 10 + indJ * 10, 5, -Math.PI / 2, Math.PI / 2, false);
              ctx.stroke();
            }

            ctx.fillStyle = textColor;
            ctx.font = '10px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(el.name, shuntX + 16, elemCenterY - 6);
            ctx.fillStyle = capacitorColor;
            ctx.fillText(fmtCap(elemLC(el).C), shuntX + 16, elemCenterY - 18);
            ctx.fillStyle = inductorColor;
            ctx.fillText(fmtInd(elemLC(el).L), shuntX + 16, elemCenterY + 16);

            ctx.strokeStyle = primaryColor;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(shuntX, elemCenterY + 28);
            ctx.lineTo(shuntX, groundY);
            ctx.stroke();

          } else {
            // Standard Single Shunt element
            if (el.name.indexOf('C') !== -1) {
              // Shunt Capacitor
              ctx.strokeStyle = capacitorColor;
              ctx.lineWidth = 2.5;
              ctx.beginPath();
              ctx.moveTo(shuntX - 14, elemCenterY - 4);
              ctx.lineTo(shuntX + 14, elemCenterY - 4);
              ctx.moveTo(shuntX - 14, elemCenterY + 4);
              ctx.lineTo(shuntX + 14, elemCenterY + 4);
              ctx.stroke();
              ctx.fillStyle = capacitorColor;
              ctx.font = '11px monospace';
              ctx.textAlign = 'left';
              ctx.fillText(el.name + ': ' + fmtCap(el.val), shuntX + 18, elemCenterY);
            } else {
              // Shunt Inductor
              ctx.strokeStyle = inductorColor;
              ctx.lineWidth = 2.5;
              for (var indI = 0; indI < 3; indI++) {
                ctx.beginPath();
                ctx.arc(shuntX, elemCenterY - 12 + indI * 12, 6, -Math.PI / 2, Math.PI / 2, false);
                ctx.stroke();
              }
              ctx.fillStyle = inductorColor;
              ctx.font = '11px monospace';
              ctx.textAlign = 'left';
              ctx.fillText(el.name + ': ' + fmtInd(el.val), shuntX + 18, elemCenterY);
            }

            ctx.strokeStyle = primaryColor;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(shuntX, elemCenterY + 15);
            ctx.lineTo(shuntX, groundY);
            ctx.stroke();
          }

          ctx.fillStyle = primaryColor;
          ctx.beginPath();
          ctx.arc(shuntX, groundY, 3, 0, Math.PI * 2);
          ctx.fill();
        }

        curXc += stepX;
      });

      // Output wire connection to port
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(curXc, midY);
      ctx.lineTo(curXc + 11, midY);
      ctx.stroke();

      // Output port
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(curXc + 15, midY, 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(curXc + 15, groundY, 4, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = textColor;
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('OUT', curXc + 24, midY - 6);
      ctx.font = '10px monospace';
      ctx.fillStyle = mutedText;
      ctx.fillText(state.ra.toFixed(1) + 'Ω', curXc + 24, midY + 12);
    }
  }

  // --- ATTENUATION & S-PARAMETER PLOT DRAWING ---

  // Frequency axis range of the response plots
  function plotMaxFreq(fd) {
    return state.art === 'p' ? fd.f0 * 2.2 : fd.cutoff * 2.8;
  }

  // Plain-text description of the current circuit (used as alternative text for the canvases)
  function circuitDescription(fd) {
    var kind = state.art === 't' ? 'Low-pass' : (state.art === 'h' ? 'High-pass' : 'Band-pass');
    var tech = state.tech === 's' ? 'microstrip' : 'discrete LC';
    var parts;
    if (state.tech === 's' && state.art === 'p' && fd.coupledStages) {
      parts = fd.coupledStages.map(function (c, i) {
        return 'coupled section ' + (i + 1) + ': w ' + c.w_mm.toFixed(2) + ' mm, gap ' + c.s_mm.toFixed(2) + ' mm, length ' + c.l_mm.toFixed(1) + ' mm';
      });
    } else if (state.tech === 's') {
      parts = fd.elements.map(function (el) {
        return el.name + ': width ' + el.w_mm.toFixed(2) + ' mm, length ' + el.l_mm.toFixed(2) + ' mm';
      });
    } else {
      parts = fd.elements.map(function (el) {
        return el.name + (el.isSeries ? ' (series arm): ' : ' (shunt arm): ') + elemValueText(el);
      });
    }
    return kind + ' ' + tech + ' filter. Source ' + state.re.toFixed(1) + ' ohm, load ' + state.ra.toFixed(1) + ' ohm. ' + parts.join('; ') + '.';
  }

  // Warnings / input-check banner
  function renderWarnings(fd) {
    var list = fd.warnings || [];
    if (!list.length) return null;
    var icon = { error: '⛔', warn: '⚠️', info: 'ℹ️' };
    return h('div', { class: 'mfc-warnings', role: 'status', 'aria-live': 'polite' },
      h('ul', {}, list.map(function (w) {
        return h('li', { class: 'mfc-w-' + w.level }, h('span', { 'aria-hidden': 'true' }, icon[w.level] + ' '), h('span', { class: 'mfc-sr-only' }, w.level + ': '), w.text);
      }))
    );
  }

  // ---- save / load / share ----
  var SAVE_KEYS = ['tech', 'art', 'schaltIn', 'schaltOut', 'steep', 'sections', 'autoRa', 're', 'ra', 'fg', 'fgUnit', 'fu', 'fuUnit',
    'fo', 'foUnit', 'fs', 'fsUnit', 'substrate', 'er', 'h', 'zHigh', 'zLow', 'endEffects', 'dbScale', 'plotMode', 'showTline'];
  var ALLOWED = {
    tech: ['d', 's'], art: ['t', 'h', 'p'], schaltIn: ['p', 't'], schaltOut: ['p', 't'], steep: ['none', 'in', 'out', 'both'],
    fgUnit: ['h', 'k', 'm', 'g'], fuUnit: ['h', 'k', 'm', 'g'], foUnit: ['h', 'k', 'm', 'g'], fsUnit: ['h', 'k', 'm', 'g'],
    substrate: ['ro4003c', 'duroid5880', 'fr4', 'epoxy', 'alumina', 'hostalen', 'teflon', 'custom'],
    plotMode: ['atten', 's_param'], dbScale: [10, 20, 40, 60, 100, 'neper']
  };
  function exportDesign() {
    var o = { mfcDesign: 1 };
    SAVE_KEYS.forEach(function (k) { o[k] = state[k]; });
    return o;
  }
  function importDesign(o) {
    if (!o || typeof o !== 'object') return false;
    var n = 0;
    SAVE_KEYS.forEach(function (k) {
      var v = o[k];
      if (v === undefined || v === null) return;
      if (ALLOWED[k]) { if (ALLOWED[k].indexOf(v) < 0) return; }
      else if (typeof state[k] === 'boolean') { if (typeof v !== 'boolean') return; }
      else if (k === 'fg' || k === 'fu' || k === 'fo' || k === 'fs' || typeof state[k] === 'number') { if (!isFinite(parseFloat(v))) return; }
      state[k] = v;
      n++;
    });
    state.sections = validateSections(state.sections, state.schaltIn, state.schaltOut);
    return n > 0;
  }
  function designToHash() {
    var json = JSON.stringify(exportDesign());
    return '#mfc=' + btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function designFromHash(hash) {
    try {
      var b = hash.replace(/^#mfc=/, '').replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      return JSON.parse(decodeURIComponent(escape(atob(b))));
    } catch (e) { return null; }
  }

  function drawAttenuation(canvas, filterData) {
    var ctx = canvas.getContext('2d');
    var w = canvas.width;
    var h = canvas.height;
    var isDark = (state.canvasTheme === 'dark');

    // Background
    ctx.fillStyle = isDark ? '#0f172a' : '#ffffff';
    ctx.fillRect(0, 0, w, h);

    var margin = { top: 46, right: 40, bottom: 60, left: 65 };
    var plotW = w - margin.left - margin.right;
    var plotH = h - margin.top - margin.bottom;

    var maxDb = typeof state.dbScale === 'number' ? state.dbScale : 40;
    var isNeper = (state.dbScale === 'neper');
    var maxY = isNeper ? 10 : maxDb;

    var cutoffHz = filterData.cutoff;
    var maxFreqHz = plotMaxFreq(filterData);

    // Grid lines & labels styling
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 1;
    ctx.fillStyle = isDark ? '#94a3b8' : '#64748b';
    ctx.font = '11px monospace';

    var isSParam = (state.plotMode === 's_param');

    // Horizontal grid lines (dB / Neper)
    var dbSteps = 5;
    for (var s = 0; s <= dbSteps; s++) {
      var valY = (maxY / dbSteps) * s;
      var yPos = margin.top + (plotH / dbSteps) * s;
      ctx.beginPath();
      ctx.moveTo(margin.left, yPos);
      ctx.lineTo(margin.left + plotW, yPos);
      ctx.stroke();
      ctx.textAlign = 'right';
      if (isSParam) {
        var sVal = -valY;
        ctx.fillText(sVal.toFixed(0) + ' dB', margin.left - 8, yPos + 4);
      } else {
        ctx.fillText((maxY - valY).toFixed(0) + (isNeper ? ' N' : ' dB'), margin.left - 8, yPos + 4);
      }
    }

    // Vertical grid lines (Frequency)
    var fSteps = 6;
    for (var f = 0; f <= fSteps; f++) {
      var freqAtStep = (maxFreqHz / fSteps) * f;
      var xPos = margin.left + (plotW / fSteps) * f;
      ctx.beginPath();
      ctx.moveTo(xPos, margin.top);
      ctx.lineTo(xPos, margin.top + plotH);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillText(f === 0 ? '0' : fmtFreq(freqAtStep), xPos, margin.top + plotH + 20);
    }

    // Passband indicator background
    var fuPlot = toHz(state.fu, state.fuUnit), foPlot = toHz(state.fo, state.foUnit);
    ctx.fillStyle = isDark ? 'rgba(34, 197, 94, 0.08)' : 'rgba(34, 197, 94, 0.06)';
    if (state.art === 't') {
      var cutoffX = margin.left + (cutoffHz / maxFreqHz) * plotW;
      ctx.fillRect(margin.left, margin.top, cutoffX - margin.left, plotH);
    } else if (state.art === 'h') {
      var cutoffX_h = margin.left + (cutoffHz / maxFreqHz) * plotW;
      ctx.fillRect(cutoffX_h, margin.top, margin.left + plotW - cutoffX_h, plotH);
    } else if (foPlot > fuPlot) {
      var bx1 = margin.left + (fuPlot / maxFreqHz) * plotW, bx2 = margin.left + (foPlot / maxFreqHz) * plotW;
      ctx.fillRect(bx1, margin.top, bx2 - bx1, plotH);
    }

    // Band-edge / cutoff markers
    var edges = (state.art === 'p') ? [['fu', fuPlot], ['fo', foPlot]] : [['fc', cutoffHz]];
    edges.forEach(function (ed) {
      var ex = margin.left + (ed[1] / maxFreqHz) * plotW;
      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(ex, margin.top);
      ctx.lineTo(ex, margin.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#0284c7';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(ed[0] + ' = ' + fmtFreq(ed[1]), ex, margin.top - 8);
    });

    // Exact response from the synthesized circuit (ABCD cascade, source Re, load Ra)
    var useT = !!state.showTline && core.hasTlineModel(filterData);
    var s21Pts = [], s11Pts = [], tS21Pts = [], tS11Pts = [];
    var yFor = function (vAbs) { return margin.top + Math.min(1, Math.max(0, vAbs / maxY)) * plotH; };
    var addPts = function (r, p21, p11, x) {
      if (isSParam) {
        p21.push({ x: x, y: yFor(Math.abs(r.s21dB)) });
        p11.push({ x: x, y: yFor(Math.abs(r.s11dB)) });
      } else {
        var aVal = isNeper ? r.aNep : r.aDb;
        p21.push({ x: x, y: margin.top + plotH - Math.min(1, Math.max(0, aVal / maxY)) * plotH });
      }
    };
    for (var px = 0; px <= plotW; px += 2) {
      var currentF = (px / plotW) * maxFreqHz;
      if (currentF <= 0) continue;
      addPts(core.responseAt(filterData, currentF, 'lumped'), s21Pts, s11Pts, margin.left + px);
      if (useT) addPts(core.responseAt(filterData, currentF, 'tline'), tS21Pts, tS11Pts, margin.left + px);
    }

    // Draw S21 Curve (or Attenuation)
    ctx.strokeStyle = '#0284c7'; // Vibrant Blue
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    s21Pts.forEach(function (pt, idx) {
      if (idx === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();

    // Draw S11 Curve (if S-parameter mode)
    if (isSParam && s11Pts.length) {
      ctx.strokeStyle = '#e07a3f'; // Warm Orange
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      s11Pts.forEach(function (pt, idx) {
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();
    }

    // Ideal microstrip (transmission-line) overlay
    if (useT) {
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#16a34a';
      ctx.lineWidth = 2.2;
      [tS21Pts].concat(isSParam ? [tS11Pts] : []).forEach(function (arr, k) {
        ctx.strokeStyle = k === 0 ? '#16a34a' : '#a16207';
        ctx.beginPath();
        arr.forEach(function (pt, idx) { if (idx === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
        ctx.stroke();
      });
      ctx.restore();
    }

    // Chart Title
    ctx.fillStyle = isDark ? '#ffffff' : CFG.theme.primary;
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'left';
    var titleText = isSParam
      ? 'S-Parameters: Insertion Loss S21(f) & Return Loss S11(f)'
      : 'Attenuation a(f) of the synthesized circuit';
    ctx.fillText(titleText, margin.left, 17);

    // Legend
    ctx.font = '11px sans-serif';
    var legX = margin.left + plotW - (isSParam ? 290 : 170);
    ctx.fillStyle = '#0284c7';
    ctx.fillRect(legX, 14, 16, 4);
    ctx.fillStyle = isDark ? '#cbd5e1' : '#334155';
    ctx.fillText(isSParam ? 'S21 (Transmission)' : 'Attenuation a(f)', legX + 22, 20);

    if (isSParam) {
      ctx.fillStyle = '#e07a3f';
      ctx.fillRect(legX + 130, 14, 16, 4);
      ctx.fillStyle = isDark ? '#cbd5e1' : '#334155';
      ctx.fillText('S11 (Return Loss)', legX + 152, 20);
    }
    if (useT) {
      ctx.fillStyle = '#16a34a';
      ctx.fillRect(legX, 28, 16, 4);
      ctx.fillStyle = isDark ? '#cbd5e1' : '#334155';
      ctx.fillText('dashed: ideal microstrip lines', legX + 22, 34);
    }

    // Interactive VNA Cursor Marker
    if (state.cursorFreq && state.cursorFreq > 0 && state.cursorFreq <= maxFreqHz) {
      var curPixelX = margin.left + (state.cursorFreq / maxFreqHz) * plotW;
      ctx.strokeStyle = '#ef4444'; // Red crosshair
      ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(curPixelX, margin.top);
      ctx.lineTo(curPixelX, margin.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      // Readout badge text
      var markerText = 'Marker: ' + fmtFreq(state.cursorFreq);
      if (state.cursorS21 != null) markerText += ' | S21: ' + state.cursorS21.toFixed(2) + ' dB';
      if (state.cursorS11 != null && isSParam) markerText += ' | S11: ' + state.cursorS11.toFixed(2) + ' dB';
      if (useT && state.cursorT21 != null) markerText += ' | T-line S21: ' + state.cursorT21.toFixed(2) + ' dB';

      ctx.fillStyle = isDark ? '#f87171' : '#dc2626';
      ctx.font = 'bold 11px monospace';
      var textW = ctx.measureText(markerText).width;
      var textX = (curPixelX + 10 + textW > margin.left + plotW) ? (curPixelX - 10 - textW) : (curPixelX + 10);
      ctx.fillText(markerText, textX, margin.top + 26);
    }
  }

  // --- WAVE IMPEDANCE PLOT DRAWING (WELLENW.UNI) ---

  function drawImpedance(canvas, filterData) {
    var ctx = canvas.getContext('2d');
    var w = canvas.width;
    var h = canvas.height;
    var isDark = (state.canvasTheme === 'dark');

    ctx.fillStyle = isDark ? '#0f172a' : '#ffffff';
    ctx.fillRect(0, 0, w, h);

    var margin = { top: 56, right: 40, bottom: 60, left: 65 };
    var plotW = w - margin.left - margin.right;
    var plotH = h - margin.top - margin.bottom;

    var isBP = (state.art === 'p');
    var cutoffHz = filterData.cutoff;
    var f0 = filterData.f0 || cutoffHz;
    var bw = filterData.b || 0.1;
    var fuHz = toHz(state.fu, state.fuUnit), foHz = toHz(state.fo, state.foUnit);
    var maxFreqHz = plotMaxFreq(filterData);
    var zo = filterData.zo;
    var maxZ = Math.ceil((zo * 2) / 20) * 20;
    var mMatch = 0.6;
    var txt = isDark ? '#94a3b8' : '#64748b';

    // Real part of the image impedance of the three section types versus f.
    // x is the normalized low-pass frequency (x < 1: passband; x >= 1: purely imaginary -> Re = 0).
    function normX(f) {
      if (state.art === 't') return f / cutoffHz;
      if (state.art === 'h') return f > 0 ? cutoffHz / f : Infinity;
      return f > 0 ? Math.abs(f / f0 - f0 / f) / bw : Infinity;
    }
    var curves = {
      T:  function (x) { return x < 1 ? zo * Math.sqrt(1 - x * x) : 0; },
      Pi: function (x) { return x < 1 ? zo / Math.sqrt(1 - x * x) : 0; },
      M:  function (x) { return x < 1 ? zo * (1 - (1 - mMatch * mMatch) * x * x) / Math.sqrt(1 - x * x) : 0; }
    };

    function xOf(f) { return margin.left + (f / maxFreqHz) * plotW; }
    function yOf(z) { return margin.top + plotH - (Math.min(maxZ * 1.2, Math.max(0, z)) / maxZ) * plotH; }

    // Grid lines
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 1;
    ctx.fillStyle = txt;
    ctx.font = '11px monospace';

    for (var i = 0; i <= 4; i++) {
      var zVal = (maxZ / 4) * i;
      var yPos = margin.top + plotH - (plotH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(margin.left, yPos);
      ctx.lineTo(margin.left + plotW, yPos);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(zVal.toFixed(0) + ' Ω', margin.left - 8, yPos + 4);
    }
    for (var f = 0; f <= 5; f++) {
      var fr = (maxFreqHz / 5) * f;
      var xPos = margin.left + (plotW / 5) * f;
      ctx.beginPath();
      ctx.moveTo(xPos, margin.top);
      ctx.lineTo(xPos, margin.top + plotH);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillText(f === 0 ? '0' : fmtFreq(fr), xPos, margin.top + plotH + 20);
    }

    // Passband shading
    ctx.fillStyle = isDark ? 'rgba(34, 197, 94, 0.08)' : 'rgba(34, 197, 94, 0.06)';
    if (state.art === 't') {
      ctx.fillRect(margin.left, margin.top, xOf(cutoffHz) - margin.left, plotH);
    } else if (state.art === 'h') {
      ctx.fillRect(xOf(cutoffHz), margin.top, margin.left + plotW - xOf(cutoffHz), plotH);
    } else if (foHz > fuHz) {
      ctx.fillRect(xOf(fuHz), margin.top, xOf(foHz) - xOf(fuHz), plotH);
    }

    // Nominal Zo line
    var zoY = yOf(zo);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(margin.left, zoY);
    ctx.lineTo(margin.left + plotW, zoY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = txt;
    ctx.textAlign = 'right';
    ctx.fillText('Zo = ' + zo.toFixed(1) + ' Ω', margin.left + plotW - 6, zoY - 6);

    // Cutoff / band-edge markers (labels sit inside the plot, clear of the title)
    var edges = isBP ? [['fu', fuHz], ['fo', foHz]] : [['fc', cutoffHz]];
    edges.forEach(function (ed, k) {
      var ex = xOf(ed[1]);
      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(ex, margin.top);
      ctx.lineTo(ex, margin.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#0284c7';
      ctx.textAlign = (state.art === 'h' || (isBP && k === 1)) ? 'left' : 'right';
      ctx.fillText(ed[0] + ' = ' + fmtFreq(ed[1]), ex + (ctx.textAlign === 'left' ? 6 : -6), margin.top + 14);
    });

    // Curves
    function plotCurve(fn, color, width, dash) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash || []);
      ctx.beginPath();
      var pen = false, lastZ = 0;
      for (var px = 0; px <= plotW; px += 1) {
        var curF = (px / plotW) * maxFreqHz;
        if (curF <= 0) continue;
        var z = fn(normX(curF));
        if (!isFinite(z)) z = maxZ * 1.2;
        var py = yOf(z);
        if (z <= 0 && !pen) { continue; }          // stopband before the passband: nothing to draw
        if (z <= 0 && pen) {                       // passband ended: drop to 0 and stop this segment
          ctx.lineTo(margin.left + px, yOf(0));
          pen = false;
          continue;
        }
        if (!pen) { ctx.moveTo(margin.left + px, z > 0 && lastZ <= 0 && state.art !== 't' ? yOf(0) : py); pen = true; }
        ctx.lineTo(margin.left + px, py);
        lastZ = z;
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(margin.left, margin.top, plotW, plotH);
    ctx.clip();
    plotCurve(curves.Pi, '#94a3b8', 1.8, [6, 3]);
    plotCurve(curves.T, '#e07a3f', 2.2);
    plotCurve(curves.M, '#0284c7', 2.8);
    ctx.restore();

    // Legend (bottom-left inside the plot)
    var lx = margin.left + 12, ly = margin.top + plotH - 52;
    var legend = [
      ['#0284c7', [], 'm-derived match (m = ' + mMatch + ')'],
      ['#e07a3f', [], 'Constant-k T:  Zo·√(1−x²)'],
      ['#94a3b8', [6, 3], 'Constant-k π:  Zo/√(1−x²)']
    ];
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    legend.forEach(function (it, k) {
      var yy = ly + k * 16;
      ctx.strokeStyle = it[0];
      ctx.lineWidth = 2.4;
      ctx.setLineDash(it[1]);
      ctx.beginPath();
      ctx.moveTo(lx, yy);
      ctx.lineTo(lx + 24, yy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = isDark ? '#cbd5e1' : '#334155';
      ctx.fillText(it[2], lx + 32, yy + 4);
    });

    // Axis labels + title
    ctx.fillStyle = txt;
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Frequency', margin.left + plotW / 2, h - 8);
    ctx.save();
    ctx.translate(14, margin.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Re{Z_I} (Ω)', 0, 0);
    ctx.restore();

    ctx.fillStyle = isDark ? '#ffffff' : CFG.theme.primary;
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Image Wave Impedance ZL(f) vs Frequency', margin.left, 24);
  }

  // --- SPA VIEW RENDERER ---

  function render() {
    // keep keyboard focus and scroll position across the full re-render (typing in a field must not lose focus)
    var focusIdx = -1, selS = null, selE = null, keepY = window.pageYOffset;
    var ae = document.activeElement;
    if (ae && container.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) {
      focusIdx = Array.prototype.indexOf.call(container.querySelectorAll('input,select,textarea'), ae);
      try { selS = ae.selectionStart; selE = ae.selectionEnd; } catch (e1) { selS = null; }
    }
    renderInner();
    if (focusIdx >= 0) {
      var all = container.querySelectorAll('input,select,textarea');
      var fe = all[focusIdx];
      if (fe) {
        fe.focus();
        try { if (selS !== null) fe.setSelectionRange(selS, selE); } catch (e2) { /* number inputs have no selection API */ }
      }
    }
    window.scrollTo(window.pageXOffset, keepY);
  }

  function renderInner() {
    container.innerHTML = '';
    var filterData = calcFilter();

    // App Wrapper
    var root = h('div', { class: 'mfc-app-container' });

    // Header (matching tshirt-quilt-tracker)
    if (!CFG.embedded) {
      var header = h('header', { class: 'mfc-header' },
        h('div', { class: 'mfc-brand' },
          h('div', {},
            h('h1', {}, CFG.theme.title || 'Microstrip Filter Calculator'),
            h('span', { class: 'mfc-subtitle' }, 'Image-parameter filter design')
          )
        ),
        h('div', { class: 'mfc-user-meta' },
          CFG.user ? h('span', {}, 'User: ', h('strong', {}, CFG.user)) : null,
          CFG.homeUrl ? h('a', { href: CFG.homeUrl }, 'Home') : null,
          CFG.logout ? h('a', { href: CFG.logout }, 'Log out') : null,
          h('button', {
            class: 'btn sm outline mfc-print-header',
            style: 'margin-left:10px;',
            title: 'Print formatted engineering lab report or export to PDF',
            onclick: function () { window.print(); }
          }, '📄 Print Lab Report')
        )
      );
      root.appendChild(header);
    }

    // Top Navigation Tabs & Mobile Responsive Selector
    var navWrap = h('div', { class: 'mfc-nav-container' },
      // Tab bar: full labels on desktop, icon-over-label segmented bar on phones
      // Touch Tab Pills (Compact labels on mobile, full labels on desktop)
      h('nav', { class: 'mfc-nav', role: 'tablist' },
        h('button', {
          class: state.tab === 'calc' ? 'on' : '',
          onclick: function () { state.tab = 'calc'; render(); }
        },
          h('span', { class: 'mfc-tab-icon' }, '⚡'),
          h('span', { class: 'mfc-tab-full' }, ' Synthesis & Schematics'),
          h('span', { class: 'mfc-tab-short' }, ' Synthesis')
        ),
        h('button', {
          class: state.tab === 'attenuation' ? 'on' : '',
          onclick: function () { state.tab = 'attenuation'; render(); }
        },
          h('span', { class: 'mfc-tab-icon' }, '📈'),
          h('span', { class: 'mfc-tab-full' }, ' Frequency Response S(f)'),
          h('span', { class: 'mfc-tab-short' }, ' Response')
        ),
        h('button', {
          class: state.tab === 'impedance' ? 'on' : '',
          onclick: function () { state.tab = 'impedance'; render(); }
        },
          h('span', { class: 'mfc-tab-icon' }, '🌊'),
          h('span', { class: 'mfc-tab-full' }, ' Wave Impedance ZL(f)'),
          h('span', { class: 'mfc-tab-short' }, ' Impedance')
        ),
        h('button', {
          class: state.tab === 'table' ? 'on' : '',
          onclick: function () { state.tab = 'table'; render(); }
        },
          h('span', { class: 'mfc-tab-icon' }, '📋'),
          h('span', { class: 'mfc-tab-full' }, ' Element Geometries & Table'),
          h('span', { class: 'mfc-tab-short' }, ' Table')
        ),
        h('button', {
          class: state.tab === 'help' ? 'on' : '',
          onclick: function () { state.tab = 'help'; render(); }
        },
          h('span', { class: 'mfc-tab-icon' }, '📖'),
          h('span', { class: 'mfc-tab-full' }, ' Technical Theory & Formulas'),
          h('span', { class: 'mfc-tab-short' }, ' Theory')
        )
      )
    );
    root.appendChild(navWrap);

    // Main Content Container
    var main = h('main', { class: 'mfc-main' });

    // --- Summary Metrics Tiles (Signature Look) ---
    var isSym = (state.schaltIn === state.schaltOut);
    var topoStr = (state.schaltIn === 'p' ? 'π' : 'T') + ' → ' + (state.schaltOut === 'p' ? 'π' : 'T');
    var tiles = h('div', { class: 'mfc-tiles' },
      h('div', { class: 'mfc-tile hot' },
        h('b', {}, filterData.zo.toFixed(1) + ' Ω'),
        h('span', {}, 'Nominal Zo')
      ),
      h('div', { class: 'mfc-tile' },
        h('b', {}, filterData.m.toFixed(3)),
        h('span', {}, 'm Parameter')
      ),
      h('div', { class: 'mfc-tile' },
        h('b', {}, fmtFreq(filterData.cutoff)),
        h('span', {}, 'Cutoff fc')
      ),
      h('div', { class: 'mfc-tile' },
        h('b', {}, topoStr),
        h('span', {}, isSym ? 'Symmetric Topology' : 'Asymmetric Topology')
      ),
      h('div', { class: 'mfc-tile green' },
        h('b', {}, state.re.toFixed(0) + ' → ' + state.ra.toFixed(1) + ' Ω'),
        h('span', {}, 'Re → Matched Ra')
      ),
      h('div', { class: 'mfc-tile' },
        h('b', {}, filterData.elements.length + ' (' + filterData.anz + ' Half)'),
        h('span', {}, 'Components')
      )
    );
    main.appendChild(tiles);

    // VIEW: Calculator & Schematics Tab
    if (state.tab === 'calc') {
      var designRow = h('div', { class: 'mfc-design-row' },
        h('button', {
          class: 'btn sm outline', title: 'Save all settings of this design to a .json file',
          onclick: function () { downloadFile('filter_design.json', JSON.stringify(exportDesign(), null, 2), 'application/json'); }
        }, '💾 Save design'),
        h('button', {
          class: 'btn sm outline', title: 'Load a design saved earlier',
          onclick: function () { var inp = designRow.querySelector('input[type=file]'); if (inp) inp.click(); }
        }, '📂 Load design'),
        h('button', {
          class: 'btn sm outline', title: 'Copy a link that re-opens this exact design',
          onclick: function () {
            var link = location.href.split('#')[0] + designToHash();
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(function () { window.alert('Link copied.'); }, function () { window.prompt('Copy this link:', link); });
            else window.prompt('Copy this link:', link);
          }
        }, '🔗 Copy link'),
        h('button', {
          class: 'btn sm outline mfc-print-mobile',
          title: 'Print formatted engineering lab report or export to PDF',
          onclick: function () { window.print(); }
        }, '📄 Print Lab Report'),
        h('input', {
          type: 'file', accept: '.json,application/json', style: 'display:none', 'aria-label': 'Load design file',
          onchange: function (e) {
            var f = e.target.files && e.target.files[0];
            if (!f) return;
            var rd = new FileReader();
            rd.onload = function () {
              var ok = false;
              try { ok = importDesign(JSON.parse(rd.result)); } catch (err) { ok = false; }
              if (ok) render(); else window.alert('This file does not look like a saved filter design.');
            };
            rd.readAsText(f);
          }
        })
      );
      main.appendChild(designRow);
      var warnBox = renderWarnings(filterData);
      if (warnBox) main.appendChild(warnBox);
      var grid = h('div', { class: 'grid-2' });

      // Left Column: Parameters & Controls Card
      var formCard = h('div', { class: 'card' },
        h('h2', {}, 'Filter Synthesis Parameters'),

        // Technology Selector
        h('div', { class: 'field' },
          labelWithHelp('Realization Technology:', 'Realization technology', 'Discrete builds the filter from lumped inductors and capacitors. Microstrip builds it from transmission-line sections on a substrate: stepped-impedance lines for low-pass and high-pass, coupled lines for band-pass.'),
          h('div', { class: 'btn-group' },
            h('button', {
              class: state.tech === 's' ? 'active' : '',
              onclick: function () { state.tech = 's'; render(); }
            }, '📐 Planar Microstrip Transmission Lines'),
            h('button', {
              class: state.tech === 'd' ? 'active' : '',
              onclick: function () { state.tech = 'd'; render(); }
            }, '⚡ Discrete Lumped LC Components')
          )
        ),

        // Filter Type Selector
        h('div', { class: 'field' },
          labelWithHelp('Filter Response Type:', 'Response type', 'Low-pass passes frequencies below the cutoff, high-pass passes frequencies above it, band-pass passes the band between fu and fo.'),
          h('div', { class: 'btn-group' },
            h('button', {
              class: state.art === 't' ? 'active' : '',
              onclick: function () { state.art = 't'; render(); }
            }, 'Low-Pass (LPF)'),
            h('button', {
              class: state.art === 'h' ? 'active' : '',
              onclick: function () { state.art = 'h'; render(); }
            }, 'High-Pass (HPF)'),
            h('button', {
              class: state.art === 'p' ? 'active' : '',
              onclick: function () { state.art = 'p'; render(); }
            }, 'Band-Pass (BPF: Coupled Lines)')
          )
        ),

        // Topology Configuration (Half-Sections, Pi, T)
        h('div', { class: 'grid-2' },
          h('div', { class: 'field' },
            h('div', { style: 'display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;' },
              h('label', { style: 'margin:0;' }, 'Input Topology (Port 1):'),
              h('span', { class: 'badge ' + (state.schaltIn === 'p' ? 'accent' : 'primary') }, state.schaltIn === 'p' ? 'π - Shunt' : 'T - Series')
            ),
            h('div', { class: 'btn-group', style: 'margin-bottom:6px;' },
              h('button', {
                type: 'button',
                class: state.schaltIn === 'p' ? 'active' : '',
                onclick: function () {
                  state.schaltIn = 'p';
                  state.sections = validateSections(state.sections, state.schaltIn, state.schaltOut);
                  render();
                }
              }, 'π - Section (Shunt)'),
              h('button', {
                type: 'button',
                class: state.schaltIn === 't' ? 'active' : '',
                onclick: function () {
                  state.schaltIn = 't';
                  state.sections = validateSections(state.sections, state.schaltIn, state.schaltOut);
                  render();
                }
              }, 'T - Section (Series)')
            ),
            (function () {
              var sel = document.createElement('select');
              sel.id = 'mfc-select-schaltIn';
              var optP = document.createElement('option');
              optP.value = 'p';
              optP.textContent = 'π - Section (Shunt Branch)';
              var optT = document.createElement('option');
              optT.value = 't';
              optT.textContent = 'T - Section (Series Branch)';
              sel.appendChild(optP);
              sel.appendChild(optT);
              if (state.schaltIn === 't') {
                optT.selected = true;
                sel.selectedIndex = 1;
                sel.value = 't';
              } else {
                optP.selected = true;
                sel.selectedIndex = 0;
                sel.value = 'p';
              }
              sel.onchange = function (e) {
                state.schaltIn = e.target.value;
                state.sections = validateSections(state.sections, state.schaltIn, state.schaltOut);
                render();
              };
              return sel;
            })()
          ),
          h('div', { class: 'field' },
            h('div', { style: 'display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;' },
              h('label', { style: 'margin:0;' }, 'Output Topology (Port 2):'),
              h('span', { class: 'badge ' + (state.schaltOut === 'p' ? 'accent' : 'primary') }, state.schaltOut === 'p' ? 'π - Shunt' : 'T - Series')
            ),
            h('div', { class: 'btn-group', style: 'margin-bottom:6px;' },
              h('button', {
                type: 'button',
                class: state.schaltOut === 'p' ? 'active' : '',
                onclick: function () {
                  state.schaltOut = 'p';
                  state.sections = validateSections(state.sections, state.schaltIn, state.schaltOut);
                  render();
                }
              }, 'π - Section (Shunt)'),
              h('button', {
                type: 'button',
                class: state.schaltOut === 't' ? 'active' : '',
                onclick: function () {
                  state.schaltOut = 't';
                  state.sections = validateSections(state.sections, state.schaltIn, state.schaltOut);
                  render();
                }
              }, 'T - Section (Series)')
            ),
            (function () {
              var sel = document.createElement('select');
              sel.id = 'mfc-select-schaltOut';
              var optP = document.createElement('option');
              optP.value = 'p';
              optP.textContent = 'π - Section (Shunt Branch)';
              var optT = document.createElement('option');
              optT.value = 't';
              optT.textContent = 'T - Section (Series Branch)';
              sel.appendChild(optP);
              sel.appendChild(optT);
              if (state.schaltOut === 't') {
                optT.selected = true;
                sel.selectedIndex = 1;
                sel.value = 't';
              } else {
                optP.selected = true;
                sel.selectedIndex = 0;
                sel.value = 'p';
              }
              sel.onchange = function (e) {
                state.schaltOut = e.target.value;
                state.sections = validateSections(state.sections, state.schaltIn, state.schaltOut);
                render();
              };
              return sel;
            })()
          )
        ),

        // Steepening (Versteilerung / m-derived)
        h('div', { class: 'field' },
          labelWithHelp('m-Derived Steepening:', 'm-derived steepening', 'Adds m-derived end sections that create a transmission zero (attenuation pole) at fs, just outside the cutoff, so the roll-off is steeper. None is the plain constant-k prototype. Applies to low-pass and high-pass only.'),
          h('select', {
            value: state.steep,
            onchange: function (e) { state.steep = e.target.value; render(); }
          },
            h('option', { value: 'none' }, 'None (Constant-k Prototype)'),
            h('option', { value: 'in' }, 'Input Steepened (m-Derived at Input)'),
            h('option', { value: 'out' }, 'Output Steepened (m-Derived at Output)'),
            h('option', { value: 'both' }, 'Both Ports Steepened (Input & Output)')
          )
        ),

        // Order / Number of Half-sections (Halbglieder)
        (function () {
          var isSymSections = (state.schaltIn === state.schaltOut);
          var validSectionOptions = isSymSections
            ? [
                { val: 2, label: '2 Half-Sections (1 Full Section, 3 Elements)' },
                { val: 4, label: '4 Half-Sections (2 Full Sections, 5 Elements)' },
                { val: 6, label: '6 Half-Sections (3 Full Sections, 7 Elements)' },
                { val: 8, label: '8 Half-Sections (4 Full Sections, 9 Elements)' },
                { val: 10, label: '10 Half-Sections (5 Full Sections, 11 Elements)' }
              ]
            : [
                { val: 1, label: '1 Half-Section (0.5 Section, 2 Elements)' },
                { val: 3, label: '3 Half-Sections (1.5 Sections, 4 Elements)' },
                { val: 5, label: '5 Half-Sections (2.5 Sections, 6 Elements)' },
                { val: 7, label: '7 Half-Sections (3.5 Sections, 8 Elements)' },
                { val: 9, label: '9 Half-Sections (4.5 Sections, 10 Elements)' }
              ];

          return h('div', { class: 'field' },
            labelWithHelp('Filter Order (Half-Sections):', 'Filter order', 'Number of half-sections. More sections give a steeper roll-off but a longer, lossier filter. Symmetric topologies (π→π or T→T) need an even number; mixed π/T ends need an odd number.'),
            h('select', {
              value: state.sections,
              onchange: function (e) {
                state.sections = parseInt(e.target.value, 10);
                render();
              }
            },
              validSectionOptions.map(function (opt) {
                return h('option', { value: opt.val }, opt.label);
              })
            ),
            h('span', { class: 'description', style: 'font-size:11px; color:var(--muted); margin-top:2px; display:block;' },
              isSymSections
                ? 'Symmetric (' + (state.schaltIn === 'p' ? 'π→π' : 'T→T') + '): Requires an EVEN number of half-sections (2..10)'
                : 'Asymmetric (' + (state.schaltIn === 'p' ? 'π→T' : 'T→π') + '): Requires an ODD number of half-sections (1..9)'
            )
          );
        })(),

        // Terminating Impedance Fields
        h('div', { class: 'grid-2' },
          h('div', { class: 'field' },
            labelWithHelp('Input Impedance Re (Ω):', 'Input impedance Re', 'Source resistance at the filter input, usually 50 Ω.'),
            h('input', {
              type: 'number',
              step: '0.5',
              min: '1',
              max: '500',
              value: state.re,
              oninput: function (e) {
                state.re = parseFloat(e.target.value) || 50;
                render();
              }
            })
          ),
          h('div', { class: 'field' },
            h('div', { style: 'display:flex; justify-content:space-between; align-items:center;' },
              h('span', { style: 'display:inline-flex; align-items:center; gap:6px;' },
                h('label', {}, 'Output Impedance Ra (Ω):'),
                helpIcon('Output impedance Ra', 'Load resistance connected to the filter output. With Auto-match on, the plugin sets the value that matches the filter: Ra = Re for a symmetric topology (π→π or T→T), a different ratio for an asymmetric one.')
              ),
              h('span', { style: 'display:inline-flex; align-items:center; gap:6px;' },
                h('label', { style: 'font-size:11px; display:inline-flex; align-items:center; gap:4px; cursor:pointer; color:var(--muted);' },
                  h('input', {
                    type: 'checkbox',
                    checked: state.autoRa,
                    onchange: function (e) {
                      state.autoRa = e.target.checked;
                      render();
                    }
                  }),
                  'Auto-match'
                ),
                helpIcon('Auto-match', 'On: Ra is calculated automatically for a proper match (field locked). Off: enter any load to see how a mismatch changes S11 and S21.')
              )
            ),
            h('input', {
              type: 'number',
              step: '0.5',
              min: '1',
              max: '500',
              disabled: state.autoRa,
              value: state.autoRa ? filterData.matchedRa.toFixed(1) : state.ra,
              oninput: function (e) {
                state.ra = parseFloat(e.target.value) || 50;
                render();
              }
            }),
            h('span', { class: 'description', style: 'font-size:11px; color:var(--muted); margin-top:2px; display:block;' },
              state.schaltIn === state.schaltOut
                ? 'Symmetric topology: Ra = Re (' + state.re.toFixed(1) + ' Ω)'
                : 'Asymmetric (π vs T): Matched Ra = ' + filterData.matchedRa.toFixed(1) + ' Ω (Impedance ratio ' + (filterData.matchedRa / state.re).toFixed(2) + 'x)'
            )
          )
        ),

        // Frequencies
        state.art === 'p' ?
          h('div', { class: 'grid-2' },
            h('div', { class: 'field' },
              labelWithHelp('Lower Cutoff fu:', 'Lower cutoff fu', 'Lower edge of the band-pass passband.'),
              h('div', { class: 'input-group' },
                h('input', {
                  type: 'number',
                  value: state.fu,
                  oninput: function (e) { state.fu = e.target.value; render(); }
                }),
                h('select', {
                  value: state.fuUnit,
                  onchange: function (e) { state.fuUnit = e.target.value; render(); }
                },
                  h('option', { value: 'm' }, 'MHz'),
                  h('option', { value: 'g' }, 'GHz'),
                  h('option', { value: 'k' }, 'kHz'),
                  h('option', { value: 'h' }, 'Hz')
                )
              )
            ),
            h('div', { class: 'field' },
              labelWithHelp('Upper Cutoff fo:', 'Upper cutoff fo', 'Upper edge of the band-pass passband. The band between fu and fo is passed.'),
              h('div', { class: 'input-group' },
                h('input', {
                  type: 'number',
                  value: state.fo,
                  oninput: function (e) { state.fo = e.target.value; render(); }
                }),
                h('select', {
                  value: state.foUnit,
                  onchange: function (e) { state.foUnit = e.target.value; render(); }
                },
                  h('option', { value: 'm' }, 'MHz'),
                  h('option', { value: 'g' }, 'GHz'),
                  h('option', { value: 'k' }, 'kHz'),
                  h('option', { value: 'h' }, 'Hz')
                )
              )
            )
          ) :
          h('div', { class: 'field' },
            labelWithHelp('Cutoff Frequency fc:', 'Cutoff frequency fc', 'Edge of the passband (the 3 dB point). Low-pass passes below it, high-pass above it.'),
            h('div', { class: 'input-group' },
              h('input', {
                type: 'number',
                value: state.fg,
                oninput: function (e) { state.fg = e.target.value; render(); }
              }),
              h('select', {
                value: state.fgUnit,
                onchange: function (e) { state.fgUnit = e.target.value; render(); }
              },
                h('option', { value: 'm' }, 'MHz'),
                h('option', { value: 'g' }, 'GHz'),
                h('option', { value: 'k' }, 'kHz'),
                h('option', { value: 'h' }, 'Hz')
              )
            )
          ),

        // Attenuation pole if steepened
        state.steep !== 'none' && (state.art === 't' || state.art === 'h') ?
          h('div', { class: 'field' },
            labelWithHelp('Attenuation Pole Frequency fs (Transmission Zero):', 'Attenuation pole fs', 'Frequency where the m-derived sections place a transmission zero. It must lie beyond the cutoff: the closer to fc, the steeper the roll-off and the smaller the m parameter.'),
            h('div', { class: 'input-group' },
              h('input', {
                type: 'number',
                value: state.fs,
                oninput: function (e) { state.fs = e.target.value; render(); }
              }),
              h('select', {
                value: state.fsUnit,
                onchange: function (e) { state.fsUnit = e.target.value; render(); }
              },
                h('option', { value: 'm' }, 'MHz'),
                h('option', { value: 'g' }, 'GHz'),
                h('option', { value: 'k' }, 'kHz')
              )
            )
          ) : null,

        // Substrate Parameters (if microstrip)
        state.tech === 's' ?
          h('div', { class: 'field' },
            labelWithHelp('Substrate Material Presets:', 'Substrate material', 'Choose a board material to fill in its relative permittivity εr. A higher εr gives narrower, shorter lines. Pick Custom to enter your own value.'),
            h('div', { class: 'grid-2' },
              h('select', {
                value: state.substrate,
                onchange: function (e) {
                  var val = e.target.value;
                  state.substrate = val;
                  if (val === 'ro4003c') state.er = 3.55;
                  if (val === 'duroid5880') state.er = 2.20;
                  if (val === 'fr4') state.er = 4.40;
                  if (val === 'epoxy') state.er = 5.0;
                  if (val === 'alumina') state.er = 9.8;
                  if (val === 'hostalen') state.er = 2.7;
                  if (val === 'teflon') state.er = 2.0;
                  render();
                }
              },
                h('option', { value: 'ro4003c' }, 'Rogers RO4003C (εr = 3.55)'),
                h('option', { value: 'duroid5880' }, 'Rogers RT/duroid 5880 (εr = 2.20)'),
                h('option', { value: 'fr4' }, 'FR-4 Glass Epoxy (εr = 4.40)'),
                h('option', { value: 'epoxy' }, 'Historical Epoxy (εr = 5.00)'),
                h('option', { value: 'alumina' }, 'Alumina Al2O3 (εr = 9.80)'),
                h('option', { value: 'hostalen' }, 'Hostalen Polyethylene (εr = 2.70)'),
                h('option', { value: 'teflon' }, 'Teflon PTFE (εr = 2.00)'),
                h('option', { value: 'custom' }, 'Custom Dielectric Material')
              ),
              h('input', {
                type: 'number',
                step: '0.05',
                min: '1.01',
                max: '12.00',
                placeholder: 'Permittivity εr',
                value: state.er,
                oninput: function (e) { state.er = parseFloat(e.target.value) || 3.55; state.substrate = 'custom'; render(); }
              })
            ),
            h('div', { style: 'margin-top:8px' }, labelWithHelp('Substrate Height h (mm):', 'Substrate height', 'Thickness of the dielectric between the strip and the ground plane. Together with εr it sets the line width needed for a given impedance.')),
            h('input', {
              type: 'number',
              step: '0.1',
              min: '0.1',
              max: '5.0',
              value: state.h,
              oninput: function (e) { state.h = parseFloat(e.target.value) || 1.0; render(); }
            })
          ) : null,

        state.tech === 's' && state.art !== 'p' ?
          h('div', { class: 'field' },
            labelWithHelp('Line impedances: narrow (high-Z) / wide (low-Z) [Ω]:', 'Line impedances', 'Impedance of the narrow high-Z lines (they act as inductors) and the wide low-Z lines (they act as capacitors). A larger ratio approximates the lumped filter better, but the lines get harder to make. Defaults: 120 Ω and 20 Ω.'),
            h('div', { class: 'grid-2' },
              h('input', {
                type: 'number', step: '5', min: '60', max: '200', value: state.zHigh, 'aria-label': 'Impedance of the narrow inductive line in ohm',
                oninput: function (e) { state.zHigh = parseFloat(e.target.value) || 120; render(); }
              }),
              h('input', {
                type: 'number', step: '1', min: '8', max: '40', value: state.zLow, 'aria-label': 'Impedance of the wide capacitive line in ohm',
                oninput: function (e) { state.zLow = parseFloat(e.target.value) || 20; render(); }
              })
            )
          ) : null,

        state.tech === 's' ?
          h('div', { class: 'field', style: 'display:flex; align-items:center; gap:6px;' },
            h('label', { style: 'display:flex; align-items:center; gap:8px; cursor:pointer; margin-bottom:0;' },
              h('input', {
                type: 'checkbox', checked: state.endEffects,
                onchange: function (e) { state.endEffects = e.target.checked; render(); }
              }),
              'Compensate open-end fringing (first order)'
            ),
            helpIcon('Open-end fringing', 'The electric field fringes beyond the open end of each wide (capacitive) line, so it acts electrically longer than it is. When checked, each wide line is shortened by the Hammerstad open-end extension. Narrow lines are unchanged. Affects the layout lengths only.')
          ) : null
      );
      grid.appendChild(formCard);

      // Right Column: Interactive Canvas Diagram Card
      var canvasCard = h('div', { class: 'canvas-card' },
        h('div', { class: 'canvas-toolbar' },
          h('div', { class: 'canvas-toolbar-group' },
            h('strong', { style: 'color:var(--primary);' }, 'Circuit Schematic / Layout'),
            h('span', { class: 'badge primary' }, state.tech === 's' ? 'Microstrip' : 'Discrete'),
            state.fitView
              ? h('span', { class: 'badge primary', style: 'font-size:11px;' }, '🔍 Fitted')
              : h('span', { class: 'badge', style: 'color:var(--muted); font-size:11px;' }, '↔️ Scroll View')
          ),
          h('div', { class: 'canvas-toolbar-group' },
            h('button', {
              class: 'btn sm ' + (state.fitView ? 'primary' : 'outline'),
              title: state.fitView ? 'Currently scaled to fit screen without scrolling. Click to switch to 1:1 scrollable CAD view.' : 'Currently scrollable 1:1. Click to scale and fit entire filter to screen.',
              onclick: function () {
                state.fitView = !state.fitView;
                render();
              }
            }, state.fitView ? '↔️ 1:1 Scroll View' : '🔍 Fit to Screen'),
            h('button', {
              class: 'btn sm outline',
              title: 'Export AutoCAD DXF layout in physical mm for milling or ECAD import (KiCad / Altium)',
              onclick: function () {
                downloadFile('filter_layout.dxf', generateDxfLayout(filterData), 'application/dxf');
              }
            }, '📐 Export DXF'),
            h('button', {
              class: 'btn sm outline',
              title: 'SPICE netlist (.cir) of the lumped LC filter for ngspice / LTspice / Qucs-S',
              onclick: function () { downloadFile('filter_netlist.cir', generateSpiceNetlist(filterData), 'text/plain;charset=utf-8'); }
            }, '🔌 SPICE'),
            core.hasTlineModel(filterData) ? h('button', {
              class: 'btn sm outline',
              title: 'SPICE netlist of the physical stepped-impedance layout using ideal transmission lines',
              onclick: function () { downloadFile('filter_microstrip_tlines.cir', core.generateSpiceTline(filterData), 'text/plain;charset=utf-8'); }
            }, '🔌 SPICE (T-lines)') : null,
            h('button', {
              class: 'btn sm outline',
              title: 'Touchstone S2P file (50 ohm reference) of the ideal lumped filter',
              onclick: function () { downloadFile('filter.s2p', core.generateTouchstone(filterData), 'text/plain;charset=utf-8'); }
            }, '📡 S2P'),
            state.tech === 's' ? h('button', {
              class: 'btn sm outline',
              title: 'KiCad footprint (.kicad_mod) with the copper layout',
              onclick: function () { downloadFile('MFC_Filter.kicad_mod', core.generateKicadFootprint(filterData), 'text/plain;charset=utf-8'); }
            }, '🧩 KiCad') : null,
            h('button', {
              class: 'btn sm green',
              title: 'Export high-resolution PNG image',
              onclick: function () {
                var c = canvasCard.querySelector('canvas');
                if (c) {
                  var link = document.createElement('a');
                  link.download = 'filter-circuit.png';
                  link.href = c.toDataURL();
                  link.click();
                }
              }
            }, '📷 Export PNG')
          )
        ),
        h('div', { class: 'canvas-container ' + (state.canvasTheme === 'light' ? 'light-theme ' : '') + (state.fitView ? 'fit-view' : 'scroll-view') },
          (function () {
            var neededW = 820;
            if (!state.fitView) {
              if (state.tech === 's') {
                if (state.art === 'p' && filterData.coupledStages) {
                  neededW = Math.max(880, 60 + 45 + filterData.coupledStages.length * 115 + 45 + 60);
                } else {
                  neededW = Math.max(880, 60 + 45 + filterData.elements.length * 85 + 45 + 60);
                }
              } else {
                neededW = Math.max(820, 75 + filterData.elements.length * 95 + 75);
              }
            } else {
              neededW = 820;
            }
            var canvas = h('canvas', { class: 'mfc-canvas', width: String(neededW), height: '360', role: 'img', 'aria-label': circuitDescription(filterData) });
            setTimeout(function () { drawSchematic(canvas, filterData); }, 10);
            return canvas;
          })()
        ),
        state.tech === 's' ?
          (function () {
            // Real physical length: the same 10 mm launch lines the DXF export uses + the actual element lengths
            var launchL = 10;
            var elemL = 0;
            if (state.art === 'p' && filterData.coupledStages && filterData.coupledStages.length) {
              var cgSum = coupledGeometry(filterData);
              elemL = cgSum.maxX - cgSum.minX - 2 * launchL;
            } else {
              filterData.elements.forEach(function (el) { elemL += el.l_mm || 0; });
            }
            var totalL = elemL + 2 * launchL;
            return h('div', { style: 'display:flex; flex-wrap:wrap; gap:14px; margin-top:8px; padding:10px 14px; background:var(--surface); border:1px solid var(--border); border-radius:8px; font-size:12px;' },
              h('span', {}, h('strong', {}, 'Total Length: '), totalL.toFixed(1) + ' mm', h('span', { style: 'opacity:.7' }, ' (' + elemL.toFixed(1) + ' mm filter + 2 × ' + launchL + ' mm launch lines)')),
              h('span', {}, h('strong', {}, 'Narrow Line wL (' + filterData.zHigh + 'Ω): '), filterData.ms_L.w_mm.toFixed(2) + ' mm'),
              h('span', {}, h('strong', {}, 'Wide Stub wC (' + filterData.zLow + 'Ω): '), filterData.ms_C.w_mm.toFixed(2) + ' mm'),
              h('span', {}, h('strong', {}, 'Input Launch (Re): '), filterData.ms_Re.w_mm.toFixed(2) + ' mm'),
              h('span', {}, h('strong', {}, 'Output Launch (Ra): '), filterData.ms_Ra.w_mm.toFixed(2) + ' mm')
            );
          })() : null,
        h('div', { class: 'note' },
          h('strong', {}, 'CAD Layout Synthesized: '),
          state.tech === 's'
            ? 'Physical microstrip strip widths w and lengths l synthesized via Wheeler / Hammerstad conformal mapping.'
            : 'Discrete LC ladder values synthesized according to Image Parameter Filter theory.'
        )
      );
      grid.appendChild(canvasCard);

      main.appendChild(grid);
    }

    // VIEW: Attenuation & S-Parameter Curve Tab
    if (state.tab === 'attenuation') {
      var attenCard = h('div', { class: 'canvas-card' },
        h('div', { class: 'canvas-toolbar' },
          h('div', { class: 'canvas-toolbar-group' },
            h('strong', { style: 'color:var(--primary); font-size:16px;' }, 'Frequency Response: Transmission & Return Loss'),
            h('button', {
              class: 'btn sm ' + (state.plotMode === 's_param' ? 'primary' : 'outline'),
              style: 'margin-left:8px;',
              title: 'Click to switch between S-parameters (S21 transmission, S11 return loss) and stopband attenuation a(f)',
              onclick: function () {
                state.plotMode = (state.plotMode === 's_param') ? 'atten' : 's_param';
                render();
              }
            }, state.plotMode === 's_param' ? '📈 S-Parameters (S21 & S11)' : '📉 Stopband Attenuation a(f)'),
            core.hasTlineModel(filterData) ? h('button', {
              class: 'btn sm ' + (state.showTline ? 'primary' : 'outline'),
              style: 'margin-left:8px;',
              title: 'Overlay (dashed) the response of the real stepped-impedance microstrip layout, modeled as ideal lines, on the lumped-prototype response',
              onclick: function () { state.showTline = !state.showTline; render(); }
            }, '🌊 Microstrip overlay') : null
          ),
          h('div', { class: 'canvas-toolbar-group' },
            h('span', { style: 'font-size:13px; color:var(--muted);' }, 'Y-Scale:'),
            h('select', {
              value: state.dbScale,
              style: 'width:120px; padding:6px 10px;',
              onchange: function (e) { state.dbScale = isNaN(e.target.value) ? e.target.value : parseFloat(e.target.value); render(); }
            },
              h('option', { value: 20 }, '0 - 20 dB'),
              h('option', { value: 40 }, '0 - 40 dB'),
              h('option', { value: 60 }, '0 - 60 dB'),
              h('option', { value: 100 }, '0 - 100 dB'),
              h('option', { value: 10 }, '0 - 10 dB'),
              h('option', { value: 'neper' }, '0 - 10 Neper')
            )
          )
        ),
        h('div', { class: 'canvas-container ' + (state.canvasTheme === 'light' ? 'light-theme' : '') },
          (function () {
            var canvas = h('canvas', { class: 'mfc-canvas', width: '900', height: '420', style: 'cursor:crosshair;', role: 'img', 'aria-label': 'Frequency response plot (S21 transmission and S11 return loss, or attenuation) of the synthesized filter. ' + circuitDescription(filterData) });
            canvas.addEventListener('mousemove', function (e) {
              var rect = canvas.getBoundingClientRect();
              var mouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
              var marginL = 65;
              var plotW = canvas.width - marginL - 40;
              if (mouseX >= marginL && mouseX <= marginL + plotW) {
                var maxF = plotMaxFreq(filterData);
                var freq = ((mouseX - marginL) / plotW) * maxF;
                state.cursorFreq = freq;
                if (freq > 0) {
                  var rr = core.responseAt(filterData, freq, 'lumped');
                  state.cursorS21 = rr.s21dB;
                  state.cursorS11 = rr.s11dB;
                  state.cursorT21 = (state.showTline && core.hasTlineModel(filterData)) ? core.responseAt(filterData, freq, 'tline').s21dB : null;
                }
                drawAttenuation(canvas, filterData);
              }
            });
            canvas.addEventListener('mouseleave', function () {
              state.cursorFreq = null;
              drawAttenuation(canvas, filterData);
            });
            setTimeout(function () { drawAttenuation(canvas, filterData); }, 10);
            return canvas;
          })()
        ),
        h('div', { class: 'tip' },
          h('strong', {}, 'Frequency Response Interpretation: '),
          (state.plotMode === 's_param' ?
            'S21 (blue) is transmission: 0 dB means everything passes, so it should stay near 0 dB in the passband and fall off in the stopband. S11 (orange) is return loss, the part of the signal reflected back at the input: lower is better (−20 dB means about 1% of the power is reflected). In the stopband S11 rises to 0 dB because the filter reflects what it blocks.' :
            'a(f) is the insertion loss of the filter in dB: near 0 dB in the passband, rising in the stopband (higher means more rejection).') +
          (state.showTline && core.hasTlineModel(filterData) ?
            ' Dashed curves show the real stepped-impedance microstrip layout built from ideal lossless lines. Compared with the lumped prototype, expect an earlier roll-off and a repeated passband at higher frequency, where the lines approach half a wavelength.' : '') +
          ((state.steep !== 'none' && (state.art === 't' || state.art === 'h')) ?
            ' Transmission zeros (poles) are engineered by the m-derived sections at frequency fs.' : '')
        )
      );
      main.appendChild(attenCard);
    }

    // VIEW: Characteristic Wave Impedance Tab
    if (state.tab === 'impedance') {
      var impCard = h('div', { class: 'canvas-card' },
        h('div', { class: 'canvas-toolbar' },
          h('strong', { style: 'color:var(--primary); font-size:16px;' }, 'Characteristic Wave Impedance ZL(f) vs Frequency')
        ),
        h('div', { class: 'canvas-container ' + (state.canvasTheme === 'light' ? 'light-theme' : '') },
          (function () {
            var canvas = h('canvas', { class: 'mfc-canvas', width: '900', height: '400', role: 'img', 'aria-label': 'Wave impedance versus frequency plot. ' + circuitDescription(filterData) });
            setTimeout(function () { drawImpedance(canvas, filterData); }, 10);
            return canvas;
          })()
        ),
        h('div', { class: 'note' },
          h('strong', {}, 'Wave Impedance Matching: '),
          'Constant-k sections present varying input impedance near cutoff. Image matching m-derived half-sections (m ≈ 0.6) flatten the curve, keeping the real image impedance within about 2% of Zo up to roughly 85% of the cutoff. Above cutoff the image impedance is purely imaginary, so the plotted real part drops to zero.'
        )
      );
      main.appendChild(impCard);
    }

    // VIEW: Component Table Tab
    if (state.tab === 'table') {
      var tableCard = h('div', { class: 'card' },
        h('div', { style: 'display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;' },
          h('h2', { style: 'margin:0;' }, 'Component Values & Microstrip Geometries'),
          h('button', {
            class: 'btn sm green',
            title: 'Export table of synthesized element values and physical dimensions as CSV',
            onclick: function () {
              var rows = [['Index', 'Name', 'Topology Role', 'Discrete Value', 'Width w (mm)', 'Length l (mm)', 'Impedance ZL']];
              filterData.elements.forEach(function (el) {
                var dVal = elemValueText(el);
                var wVal = (el.w_mm ? el.w_mm.toFixed(2) : (el.isSeries ? filterData.ms_L.w_mm.toFixed(2) : filterData.ms_C.w_mm.toFixed(2)));
                var lVal = (el.l_mm ? el.l_mm.toFixed(2) : (el.isSeries ? filterData.ll_mm.toFixed(2) : filterData.lc_mm.toFixed(2)));
                var zVal = elemLineZ(el, filterData);
                rows.push([el.index, el.name, el.type, dVal, wVal, lVal, zVal]);
              });
              var csvQuote = function (v) { var s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
              var csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + rows.map(function (e) { return e.map(csvQuote).join(','); }).join('\n');
              var encodedUri = encodeURI(csvContent);
                var link = document.createElement('a');
                link.setAttribute('href', encodedUri);
                link.setAttribute('download', 'filter_elements.csv');
                link.click();
              }
            }, '📥 Export CSV')
        ),
        h('div', { class: 'tablewrap' },
          h('table', { class: 'mfc-table' },
            h('thead', {},
              h('tr', {},
                h('th', {}, '#'),
                h('th', {}, 'Name'),
                h('th', {}, 'Topology Role'),
                h('th', {}, 'Lumped Value'),
                h('th', {}, 'Microstrip Width (w)'),
                h('th', {}, 'Physical Length (l)'),
                h('th', {}, 'Impedance ZL')
              )
            ),
            h('tbody', {},
              filterData.elements.map(function (el) {
                var isSeries = el.isSeries;
                var discStr = elemValueText(el);
                var wMm = (el.w_mm ? el.w_mm.toFixed(2) : (isSeries ? filterData.ms_L.w_mm.toFixed(2) : filterData.ms_C.w_mm.toFixed(2))) + ' mm';
                var lMm = (el.l_mm ? el.l_mm.toFixed(2) : (isSeries ? filterData.ll_mm.toFixed(2) : filterData.lc_mm.toFixed(2))) + ' mm';
                var zLine = elemLineZ(el, filterData);

                return h('tr', {},
                  h('td', {}, el.index),
                  h('td', {}, h('strong', { style: 'color:var(--primary);' }, el.name)),
                  h('td', {}, el.type),
                  h('td', {}, discStr),
                  h('td', {}, wMm),
                  h('td', {}, lMm),
                  h('td', {}, zLine)
                );
              })
            )
          )
        )
      );
      main.appendChild(tableCard);
    }

    // VIEW: Technical Theory & Documentation Tab
    if (state.tab === 'help') {
      var helpCard = h('div', { class: 'card' },
        h('h2', {}, 'Filter Theory & Documentation'),
        h('iframe', {
          src: CFG.helpUrl || 'help.html',
          style: 'width:100%; height:700px; border:0; border-radius:10px; background:#faf8f5;'
        })
      );
      main.appendChild(helpCard);
    }

    root.appendChild(main);

    // --- PRINTABLE ENGINEERING LAB REPORT (Contains both Microstrip & Discrete diagrams) ---
    var printReport = h('div', { class: 'mfc-print-report' },
      h('div', { class: 'mfc-print-header' },
        h('h1', { style: 'margin:0 0 4px; font-size:20px; color:#0f2744;' }, 'Microstrip Filter Calculator – Engineering Lab Report'),
        h('div', { style: 'font-size:12px; color:#475569; margin-bottom:12px;' },
          'Image-parameter filter design with Wheeler and Hammerstad-Jensen microstrip synthesis. Based on Ralf Offermann’s 1990 TH Köln diploma thesis (advisor: Prof. Scheidt).'
        )
      ),

      // Summary Parameters Box
      h('div', { style: 'border:1px solid #cbd5e1; border-radius:6px; padding:10px 12px; margin-bottom:12px; background:#f8fafc;' },
        h('div', { style: 'display:grid; grid-template-columns:repeat(4, 1fr); gap:6px; font-size:11.5px;' },
          h('div', {}, h('strong', {}, 'Filter Type: '), (state.art === 't' ? 'Low-Pass (LPF)' : (state.art === 'h' ? 'High-Pass (HPF)' : 'Band-Pass (BPF)'))),
          h('div', {}, h('strong', {}, 'Cutoff / Center: '), (state.art === 'p' ? ('fu=' + state.fu + state.fuUnit + ', fo=' + state.fo + state.foUnit) : ('fc = ' + state.fg + ' ' + state.fgUnit.toUpperCase() + 'Hz'))),
          h('div', {}, h('strong', {}, 'Topology: '), (state.schaltIn === 'p' ? 'π' : 'T') + ' → ' + (state.schaltOut === 'p' ? 'π' : 'T') + ' (' + (state.schaltIn === state.schaltOut ? 'Symmetric' : 'Asymmetric') + ')'),
          h('div', {}, h('strong', {}, 'Sections: '), filterData.anz + ' Half-Sections (' + filterData.elements.length + ' Components)'),
          h('div', {}, h('strong', {}, 'Port 1 Re: '), state.re.toFixed(1) + ' Ω'),
          h('div', {}, h('strong', {}, 'Matched Ra: '), state.ra.toFixed(1) + ' Ω'),
          h('div', {}, h('strong', {}, 'Nominal Zo: '), filterData.zo.toFixed(1) + ' Ω'),
          h('div', {}, h('strong', {}, 'Substrate: '), state.substrate + ' (εr = ' + state.er + ', h = ' + state.h + ' mm)')
        )
      ),

      // Figure 1: Planar Microstrip Transmission Line Layout
      h('div', { style: 'margin-bottom:14px; border:1px solid #cbd5e1; border-radius:6px; padding:10px; background:#ffffff;' },
        h('h3', { style: 'margin:0 0 6px; font-size:13px; color:#1f3a5f;' }, 'Figure 1: Planar Microstrip Transmission Line Layout'),
        (function () {
          var neededW = 820;
          if (state.art === 'p' && filterData.coupledStages) {
            neededW = Math.max(820, 60 + 45 + filterData.coupledStages.length * 115 + 45 + 60);
          } else {
            neededW = Math.max(820, 60 + 45 + filterData.elements.length * 85 + 45 + 60);
          }
          var pCanvasMs = h('canvas', { width: String(neededW), height: '330', style: 'width:100%; height:auto; display:block;' });
          setTimeout(function () { drawSchematic(pCanvasMs, filterData, 's'); }, 20);
          return pCanvasMs;
        })()
      ),

      // Figure 2: Discrete Lumped LC Schematic Diagram
      h('div', { style: 'margin-bottom:14px; border:1px solid #cbd5e1; border-radius:6px; padding:10px; background:#ffffff; page-break-before:auto;' },
        h('h3', { style: 'margin:0 0 6px; font-size:13px; color:#1f3a5f;' }, 'Figure 2: Discrete Lumped LC Ladder Schematic Diagram'),
        (function () {
          var neededW = Math.max(800, 75 + filterData.elements.length * 95 + 75);
          var pCanvasDisc = h('canvas', { width: String(neededW), height: '310', style: 'width:100%; height:auto; display:block;' });
          setTimeout(function () { drawSchematic(pCanvasDisc, filterData, 'd'); }, 20);
          return pCanvasDisc;
        })()
      ),

      // Table 1: Component Values and Geometries Table
      h('div', { style: 'border:1px solid #cbd5e1; border-radius:6px; padding:10px; background:#ffffff;' },
        h('h3', { style: 'margin:0 0 6px; font-size:13px; color:#1f3a5f;' }, 'Table 1: Synthesized Component Values & Physical Dimensions'),
        h('table', { style: 'width:100%; border-collapse:collapse; font-size:10.5px;' },
          h('thead', {},
            h('tr', { style: 'background:#f1f5f9; border-bottom:1px solid #cbd5e1;' },
              h('th', { style: 'padding:4px 6px; text-align:left;' }, '#'),
              h('th', { style: 'padding:4px 6px; text-align:left;' }, 'Name'),
              h('th', { style: 'padding:4px 6px; text-align:left;' }, 'Topology Role'),
              h('th', { style: 'padding:4px 6px; text-align:left;' }, 'Lumped Value'),
              h('th', { style: 'padding:4px 6px; text-align:left;' }, 'Width w (mm)'),
              h('th', { style: 'padding:4px 6px; text-align:left;' }, 'Length l (mm)'),
              h('th', { style: 'padding:4px 6px; text-align:left;' }, 'Impedance ZL')
            )
          ),
          h('tbody', {},
            filterData.elements.map(function (el) {
              var isSer = el.isSeries;
              var dVal = elemValueText(el);
              var wVal = (el.w_mm ? el.w_mm.toFixed(2) : (isSer ? filterData.ms_L.w_mm.toFixed(2) : filterData.ms_C.w_mm.toFixed(2))) + ' mm';
              var lVal = (el.l_mm ? el.l_mm.toFixed(2) : (isSer ? filterData.ll_mm.toFixed(2) : filterData.lc_mm.toFixed(2))) + ' mm';
              var zVal = elemLineZ(el, filterData);
              return h('tr', { style: 'border-bottom:1px solid #e2e8f0;' },
                h('td', { style: 'padding:3px 6px;' }, el.index),
                h('td', { style: 'padding:3px 6px; font-weight:bold;' }, el.name),
                h('td', { style: 'padding:3px 6px;' }, el.type),
                h('td', { style: 'padding:3px 6px;' }, dVal),
                h('td', { style: 'padding:3px 6px;' }, wVal),
                h('td', { style: 'padding:3px 6px;' }, lVal),
                h('td', { style: 'padding:3px 6px;' }, zVal)
              );
            })
          )
        )
      )
    );
    root.appendChild(printReport);
    container.appendChild(root);

    // Accessibility pass: tab semantics and accessible names for form controls
    Array.prototype.forEach.call(container.querySelectorAll('.mfc-nav button'), function (b) {
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', b.classList.contains('on') ? 'true' : 'false');
    });
    Array.prototype.forEach.call(container.querySelectorAll('.field'), function (f) {
      var lab = f.querySelector('label');
      if (!lab) return;
      var text = lab.textContent.replace(/\s+/g, ' ').trim().replace(/:$/, '');
      var hasInput = !!f.querySelector('input');
      Array.prototype.forEach.call(f.querySelectorAll('input:not([aria-label]), select:not([aria-label])'), function (c) {
        if (c.type === 'checkbox') return;
        c.setAttribute('aria-label', text + (c.tagName === 'SELECT' && hasInput ? ' (unit)' : ''));
      });
    });

    // Explicit post-render synchronization to guarantee dropdown values stick across all browsers
    setTimeout(function () {
      var inSel = container.querySelector('[id="mfc-select-schaltIn"]');
      if (inSel) {
        inSel.value = state.schaltIn;
        inSel.selectedIndex = (state.schaltIn === 't' ? 1 : 0);
      }
      var outSel = container.querySelector('[id="mfc-select-schaltOut"]');
      if (outSel) {
        outSel.value = state.schaltOut;
        outSel.selectedIndex = (state.schaltOut === 't' ? 1 : 0);
      }
    }, 0);
  }

  // Initial execution (a shared #mfc= link configures the first calculator on the page)
  if (CFG.__first && /^#mfc=/.test(location.hash)) importDesign(designFromHash(location.hash));
  render();
  }

  // --- BOOTSTRAP -------------------------------------------------------------------------------
  var mountCount = 0;
  function mount(cfg) {
    cfg = cfg || {};
    var merged = {};
    Object.keys(DEFAULT_CFG).forEach(function (k) { merged[k] = DEFAULT_CFG[k]; });
    Object.keys(cfg).forEach(function (k) { merged[k] = cfg[k]; });
    var el = merged.container ? document.getElementById(merged.container) : document.getElementById('app');
    if (!el || el.getAttribute('data-mfc-mounted')) return;
    el.setAttribute('data-mfc-mounted', '1');
    merged.__first = (mountCount === 0);
    mountCount++;
    createApp(merged, el);
  }

  // Standalone page / legacy single-instance config
  if (window.MFC_CONFIG) mount(window.MFC_CONFIG);

  // Shortcode instances: each shortcode pushes its own config; later pushes mount immediately
  var queue = window.MFC_INSTANCES = window.MFC_INSTANCES || [];
  queue.forEach(mount);
  queue.push = function () {
    for (var i = 0; i < arguments.length; i++) mount(arguments[i]);
    return Array.prototype.push.apply(this, arguments);
  };
})();
