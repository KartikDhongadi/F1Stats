# Saved data and compact bundles

The app defaults to **Saved files**, reading its own static assets without OpenF1 API requests. Qualifying, races, sprint qualifying and sprints are included; practice and cancelled/future sessions are excluded. The optional **OpenF1 online** mode remains available.

## Download / update

Run from the F1Stats folder:

```sh
# Latest completed eligible weekend in 2026:
npm run update-data

# Entire completed 2026 season:
npm run update-data -- --all

# A previous season:
npm run update-data -- --year 2025 --all

# One weekend, optionally fetching corrections:
npm run update-data -- --year 2026 --meeting 1298 --refresh

# Results, laps and context without downloading car telemetry:
npm run update-data -- --year 2025 --all --metadata-only
```

The updater now saves individual source files in `.archive-source/YEAR/`, then publishes compressed bundles to `public/data/YEAR/` after a successful download run. `--metadata-only` skips telemetry downloads; it does not delete telemetry already saved locally. Existing nonempty source files are checksum-verified and skipped. Missing, corrupt and empty records are retried. `--refresh` fetches corrections. Requests are serial, paced and retried with backoff; restricted access stops the update without a paid fallback.

After updating, select the season in the app and click **Reload data**. This button reloads files; it does not run the downloader. The updater defaults to 2026; use `--year` explicitly for other seasons.

## Convert or rebuild existing archives

```sh
# All locally available seasons:
npm run bundle-data

# One season:
npm run bundle-data -- --year 2025
```

This operation requires no OpenF1 requests. On the first conversion, the original manifest and every referenced original file are copied to `.archive-source/YEAR/` and checked against their recorded checksums. These local originals are ignored by Git and sit outside the deployed `public/` directory. Do not delete them while reviewing the migration.

The converter writes bundles first, atomically switches the public manifest, then removes superseded public source files and obsolete bundles. The local originals remain. A failed conversion before the manifest switch leaves the prior public manifest intact; rerun the command after addressing the error. Do not commit/deploy while conversion is running. If interrupted after the switch, rerunning completes cleanup of obsolete bundles and superseded original files.

An update and a bundle operation share `public/data/YEAR/.update.lock`; do not run both for the same year. After a crash, confirm the process is no longer running before removing a leftover lock. An interrupted download retains source progress but does not publish partial changes; rerun the update to finish and publish.

A fresh Git clone containing only version-2 bundles can reconstruct its local source archive from those bundles, checking checksums and record counts, before continuing normal updates. No full-season re-download is needed for that reconstruction.

## Deployment format

```
public/data/2026/
  manifest.json
  11404/
    bundles/
      metadata-<content-hash>.json.gz
      telemetry-<content-hash>.json.gz
      ...
```

The season manifest has `version: 2` and `format: "apex-archive-v2"`. Logical keys, such as `11404/weather` or `11404/car_data/1`, map to ordered `chunks`. Each chunk identifies its bundle file, dataset member, SHA-256, compressed size, uncompressed size, and optional telemetry time bounds. The data source update timestamp is preserved separately from the bundling timestamp.

Each gzip file contains `{ "format": "apex-bundle-v1", "datasets": { ... } }`. Metadata members retain their original arrays. Car telemetry retains the lossless `apex-car-v1` column table with date, speed, throttle, brake, gear, RPM and DRS. There is no rounding, resampling or discarded channel. Driver/session IDs remain in the logical keys.

- Metadata is grouped by session, normally in one file. Large datasets can split into ordered chunks.
- Telemetry is grouped by session, with at most four driver chunks per bundle. Most drivers occupy a single chunk.
- Target compressed size: **5 MiB**. Hard compressed ceiling: **20 MiB**, below Cloudflare's published 25 MiB asset limit.
- Uncompressed JSON is capped at **32 MiB per bundle** to bound decoding work. Large members split recursively by row count; a single oversized record stops the build with an error.
- Splitting preserves record order. Telemetry time bounds let the browser skip chunks outside the requested lap; the loader returns only the requested driver's samples.
- A bundle is fetched only when a member is requested. Concurrent requests for that bundle share a download. The browser retains up to four decoded files with a 64 MiB uncompressed-size cache budget. JavaScript object overhead and in-flight requests add memory beyond that budget.

Filenames depend on content, so unchanged bundles keep their URLs. Manifests written by the updated bundler also record source checksums: subsequent builds reuse a session’s bundles when all its source assets are unchanged and the published bundle checksums still match. A correction changes its affected bundle; season-specific grouping prevents an update from rebuilding every year's data. Old tabs may need **Reload data** after deployment if they reference a retired bundle. New endpoints can be added as dataset members without changing the charts. The browser supports both version-1 individual files and version-2 bundles during migration.

## Local originals and rollback

`.archive-source/YEAR/manifest.json` remains version 1 and references the original individual JSON/gzip files. Future updates modify this working source archive, so copy it separately before applying corrections if you need an immutable snapshot.

To temporarily return a season to the original format, stop updates, move its bundled `public/data/YEAR/` folder outside `public/`, and copy `.archive-source/YEAR/` into its place. Both formats are readable by the app. Keep the bundles until you have finished reviewing the rollback.

## GitHub and hosting

Only `public/` is deployed. Keep `.archive-source/` outside Git. When committing the migration, include the new bundles, changed manifests, deleted old public files, application loader and updated scripts together. `.gitignore` does not remove previously tracked files from Git history; earlier commits still contain the old archive. History rewriting is not part of this change.

Cloudflare Workers Free currently permits **20,000 assets per version** and **25 MiB per asset**. Direct static-asset requests are free and asset storage has no additional charge; Worker code requests have separate limits. Sources: https://developers.cloudflare.com/workers/platform/limits/ and https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/

Bundling reduces deployed file counts and metadata bytes. Keeping originals locally means your Mac temporarily uses more disk space. Visitors fetch individual needed bundles, not a complete season. The obsolete `apex-cloudflare.zip` must not be used for deployment.

## Timing and weather interpretation

Race positions share an approximate race-lap clock based on earliest observed crossings, carrying only past position observations forward. Retirements end at the last known completed-lap time. Lap times, driver telemetry and tyre strategy use each driver's own laps. Race-event lap labels are approximate; tyre changes are not automatically pit stops. Long laps remain available via the pace ceiling control.

Weather follows the latest observation at or before the selected time. Readings older than 180 seconds are marked stale and withheld. Selected driver laps use their actual start; the race cursor uses the common approximate clock; season results use the labelled scheduled start. Wind is converted to km/h. A rainfall indicator does not establish track wetness.

## Verification preference

The conversion performs required integrity and file-size checks as part of writing archives. Application tests and browser checks are left to the user unless explicitly requested. No commit, push or deployment is performed by the conversion commands.

## Initial conversion result

The 2025 and 2026 archives were converted locally without downloading new data:

| Season | Published files (including manifest) | Published size | Largest bundle |
| --- | ---: | ---: | ---: |
| 2025 | 361 | 184.32 MiB | 1.12 MiB |
| 2026 | 365 | 173.25 MiB | 1.35 MiB |

Combined: 726 archive files (previously 3,217 referenced files), about 77% fewer, and 357.57 MiB including manifests. The originals are retained in `.archive-source/`; ignored macOS metadata files are not part of these counts. Source checksums are indexed for incremental session reuse. These are conversion output statistics, not a claim that application or browser tests have been run.
