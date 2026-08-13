# Playlist data analysis

This directory is an isolated, reproducible analysis workspace. It does not
change the generated Spotify data or the public landing page.

Run the analysis from the repository root:

```powershell
node data-analysis/analyze-playlist.mjs
```

The script reads the versioned files under `data/` and generates:

- `analysis-results.json`: detailed calculated metrics and quality checks;
- `artifact.json`: canonical Data Analytics report input;
- `report.html`: self-contained visual report generated from `artifact.json`.

To rebuild the HTML with the installed Data Analytics plugin, run its packaged
portable report builder through the local finalizer:

```powershell
node data-analysis/finalize-report.mjs <data-analytics-plugin-root>
```

The finalizer uses the plugin's canonical builder and verifier. It also applies
a narrow width correction for the plugin reader's `100vw` top bar when Windows
uses a non-overlay vertical scrollbar. The report is a snapshot and does not
call Spotify or any external service.
