# NeuroProfile Web

A browser-based tool for creating standardized cognitive profile figures from neuropsychological test scores.

NeuroProfile Web is designed for clinicians who need a fast, readable way to visualize domain-level cognitive performance, score variability, and longitudinal change. It runs entirely in the browser and does not require Python, a server, an account, or an installation.

## Try it

Open the application directly from the repository:

**[Launch NeuroProfile Web](./index.html)**

![NeuroProfile Web interface](assets/previews/app-preview.png)

![Example cognitive profile](assets/previews/example-output.png)

For a hosted version, enable GitHub Pages for the repository and use the repository root as the Pages source. The application is a static HTML file, so no application server is required.

## What it does

- Creates cognitive domain profiles from standardized neuropsychological scores.
- Displays domain averages and observed score ranges.
- Shows optional individual test-score markers.
- Supports T-scores, z-scores, standard scores, scaled scores, and percentile ranks.
- Allows the X-axis metric and percentile spacing to be selected.
- Uses equal-interval standardized-score spacing when an interval scale is selected.
- Supports one current assessment plus up to five prior assessments.
- Allows the current assessment to be compared descriptively with a selected prior assessment.
- Provides an optional 1.5 SD change indicator.
- Includes a deterministic text-table parser for pasted score tables.
- Allows scores to be edited, added, or deleted after import.
- Provides customizable layout, fonts, colors, and figure text.
- Includes Theater Mode for live patient feedback.
- Includes temporary annotation tools and a laser pointer in Theater Mode.
- Exports SVG and PNG figures and can copy the figure to the clipboard.
- Saves display preferences locally in the browser when the user chooses to save them.

## Clinical calculation rules

NeuroProfile Web uses equal weighting throughout the cognitive profile.

Within each domain, every included test score contributes equally to the domain average after conversion to a common z-score metric.

The Overall Cognitive Profile is the arithmetic mean of the included domain averages. Each domain therefore contributes equally, regardless of how many tests are represented within that domain.

The observed score range represents the lowest and highest included test scores. It is independent of the calculation used for the domain or overall average.

Longitudinal change indicators are descriptive thresholds. A difference of 1.5 SD is not a statistical significance test and is not equivalent to a reliable change calculation. Formal reliable-change interpretation requires additional information such as test reliability, practice effects, and appropriate comparison parameters.

## Data input

Scores can be loaded from:

1. The included Excel template.
2. CSV files.
3. Pasted text tables.
4. Direct editing in the Score data table.

The pasted-table parser accepts common tables copied from Excel, Word, electronic medical records, and reports. It can recognize several common layouts, supported standardized-score metrics, domain headings, and test names. Parsed data should always be reviewed before loading.

The included example workbook contains synthetic demonstration data only.

## Privacy model

The application is designed as a client-side tool. Uploaded files and pasted score tables are processed by JavaScript running in the user's browser. The application contains no analytics, telemetry, application backend, external scripts, or application network requests.

Saved settings use browser storage only when the user chooses to save them. Clinical scores, pasted tables, patient identifiers, uploaded workbooks, and Theater Mode markup are not saved as preferences.

A public static webpage can still produce ordinary web-server or hosting logs such as an IP address and page request. Those logs are separate from the clinical data processed inside the application.

Do not enter identifiable patient information into a deployment unless its use has been reviewed and approved under your organization's privacy, security, and clinical policies. Local browser processing does not by itself make every deployment appropriate for protected health information.

## Clinical use

NeuroProfile Web is a visualization and calculation aid. It is not a diagnostic system, medical device, or substitute for clinical judgment.

Clinicians are responsible for verifying imported scores, test-to-domain assignments, normative metrics, aggregation choices, and the clinical interpretation of the resulting figure. The parser's domain inference is a convenience feature and should be reviewed before use in a clinical report.

## Repository structure

```text
.
├── index.html                         # Canonical standalone application
├── assets/
│   ├── NeuroProfile_Input_Template.xlsx
│   └── NeuroProfile_Example.xlsx
├── examples/
│   └── NeuroProfile_Text_Parser_Test_Tables.txt
├── src/                               # Readable source components and parser
├── tests/                             # Parser and browser regression tests
├── SECURITY.md
├── CONTRIBUTING.md
└── LICENSE.md
```

The application is intentionally distributed as a single HTML file. This makes it portable across approved workstations and allows it to run without a local runtime. The files in `src/` document the major feature layers and provide readable source material for development and testing.

## Development

No build step is required to run the application. Open `index.html` in a current desktop browser.

Parser tests require Node.js:

```bash
node tests/test_text_parser.js
```

The browser regression test requires Python, Playwright, and a compatible Chromium installation:

```bash
python tests/browser_smoke.py
```

The application is intentionally dependency-light. The standalone HTML contains its runtime dependencies so that the application does not need to fetch libraries from a CDN.

## Third-party software

The application bundles JSZip and pako for local spreadsheet archive handling. Their license notices are preserved in the application and documented in `NOTICE.md`.

## Contributing

Bug reports and parser examples are welcome. Do not include real patient information, protected health information, screenshots containing clinical identifiers, or confidential institutional material in GitHub issues or pull requests.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and parser-test guidance.

## License

No open-source license has been selected for this repository yet. See [LICENSE.md](LICENSE.md). Until a license is added, the repository remains subject to applicable copyright law and no reuse rights should be assumed.
