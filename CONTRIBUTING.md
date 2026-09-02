# Contributing

NeuroProfile Web is intentionally a small, portable browser application. Changes should preserve the clinical figure's readability, deterministic calculations, and client-only data-processing model.

## Before submitting a change

- Do not add external CDNs, analytics, telemetry, remote fonts, or network-based application dependencies.
- Do not add real patient data to examples or tests.
- Preserve keyboard access and visible focus states.
- Check the exported SVG and PNG, not only the browser preview.
- Add a regression test for parser or calculation changes.
- Keep clinical terminology precise. A descriptive 1.5 SD difference should not be described as statistical significance or reliable change.

## Parser changes

When adding support for a new score-table format, add a synthetic example to `examples/NeuroProfile_Text_Parser_Test_Tables.txt` and a corresponding regression test. Include enough variation to demonstrate that the parser is identifying the intended test name, domain, metric, and score.

## Testing

Run the parser tests:

```bash
node tests/test_text_parser.js
```

Run the browser smoke test when Playwright and Chromium are available:

```bash
python tests/browser_smoke.py
```

## Clinical review

A change that affects score conversion, domain aggregation, longitudinal comparison, or normative classification should receive clinical review before being presented as a release candidate.
