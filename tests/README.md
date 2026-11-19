# Tests

Headless tests for the calculation core (`assets/mfc-core-<version>.js`). No browser and no dependencies are needed:

    node tests/run.js        # or: cd tests && npm test

What is covered:

* element values and units for low-pass, high-pass and band-pass (regression for swapped L / C values)
* microstrip width synthesis against an independent copy of the Hammerstad/Jensen formulas
* frequency response sanity and the lossless two-port identity |S11|^2 + |S21|^2 = 1
* the exported SPICE netlists are solved with a small independent circuit solver (`tests/helpers.js`) and must match the ABCD analysis used for the plots
* layout geometry (no overlapping copper), DXF, KiCad and Touchstone output
* input checks and feasibility warnings
* a sweep over all 768 topology / technology / order combinations, plus degenerate input (zero frequency, zero height, ...)

The user interface (`assets/mfc-app-<version>.js`) is not unit-tested; check it in a browser with `index.html`. In particular:

* Enter and edit decimal input values, and check that invalid values show errors.
* Inspect discrete low-pass, high-pass, band-pass and m-derived schematic connections.
* Check narrow band-edge labels on both plots, and switch the response plot between dB and Neper scales in both modes.
