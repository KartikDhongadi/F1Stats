# Saved data workflow

The app defaults to **Saved files**. In this mode the browser reads JSON from this website and makes no OpenF1 API calls. The optional **OpenF1 online** source retains the previous workflow and its browser cache. Practice is excluded in both modes.

## Download / update

Run in the F1Stats folder in VS Code:

```sh
npm run update-data
```

This downloads the latest weekend with a completed eligible session. It includes qualifying, the Grand Prix, sprint qualifying (including the provider's Sprint Shootout alias), and the sprint race when available. Sessions must have ended; cancelled sessions and practice are excluded. On Saturday, the weekend may contain only sprint/qualifying sessions; championship standings become available after the Grand Prix.

Other options:

```sh
# All completed eligible 2026 sessions (can be a large, lengthy download):
npm run update-data -- --all

# One weekend by OpenF1 meeting_key:
npm run update-data -- --meeting 1298

# Fetch corrections for the selected weekend, replacing saved data:
npm run update-data -- --meeting 1298 --refresh

# Smaller timing/results/context download, without car telemetry:
npm run update-data -- --all --metadata-only
```

Run the same command again to resume. Existing nonempty files are checksum-verified and skipped. Missing/corrupt files and empty provider results are retried. `--refresh` explicitly re-fetches nonempty files to pick up official corrections. After downloading, use **Reload data** in the app. That button only reloads the archive; it does not download from OpenF1 when Saved files is selected.

Press Control+C once to stop after the current request. A lock prevents concurrent updates. After a process crash, verify that no updater is running before removing `public/data/2026/.update.lock`.

## Storage format

```
public/data/2026/
  manifest.json
  11400/
    drivers.json
    laps.json
    session_result.json
    stints.json
    race_control.json
    weather.json
    car_data/
      1.json.gz
      3.json.gz
      ...
```

A session's directory is named by its OpenF1 session key; driver telemetry filenames use driver numbers. Grands Prix and sprints also contain `position.json` and `pit.json`. Grand Prix sessions additionally contain `championship_drivers.json` and `championship_teams.json`.

Metadata is ordinary JSON arrays. Telemetry uses a losslessly gzip-compressed JSON table (`.json.gz`), decoded with the browser’s built-in decompressor:

```json
{"format":"apex-car-v1","columns":["date","speed","throttle","brake","n_gear","rpm","drs"],"rows":[["2026-01-01T00:00:00Z",100,0,100,2,6000,null]]}
```

To inspect a telemetry file on your Mac, run `gzip -dc public/data/2026/11400/car_data/1.json.gz`. The example above is illustrative. Real files retain every returned sample and its precision, including null values; there is no downsampling. Session and driver IDs are encoded in the path rather than repeated thousands of times. `data-store.js` converts rows back into objects before analysis. One driver file is reused when selecting other laps, and up to twelve files are retained in memory.

The manifest records each file's row count, byte size, SHA-256 checksum and download time. Its overall timestamp means the last archive update, not that every saved file was refreshed at that time. Updates save files atomically and checkpoint the manifest. During interrupted downloads, metadata may be available before all drivers' telemetry; missing telemetry is reported explicitly, with no automatic API fallback.

## What is downloaded

Drivers, full-session sampled car data, all available laps and sectors, session classifications, tyre stints, weather, race-control messages, and Grand Prix championship standings. Position updates and pit-lane visits are included for races and sprints. Location, team-radio audio, interval streams, and practice data are excluded. Qualifying and race overviews use the saved timing and context records; weather appears as a compact conditions summary beside the existing statistics.

The updater spaces requests by at least 2.2 seconds, retries temporary failures with backoff, and stops on restricted access. No paid endpoints, API keys, or subscriptions are used. Availability remains subject to OpenF1's free service. Source: https://openf1.org/docs/

For a background full-season run started from Codex, progress is recorded in `data-update.log`. View it with `tail -f data-update.log`; Control+C exits that log viewer without stopping the downloader. Do not start a second updater while that run is active.

## Hosting and GitHub

Cloudflare must receive `public/data/` together with the app. A browser still downloads files from your site, but repeated visitors no longer query OpenF1. Your local archive is not automatically copied online: deploy or commit/push it with the app.

Before adding the **whole season** to Git, inspect the size printed by the updater. Full telemetry can be substantial. Start with selected weekends and review a full-season storage strategy before committing a large archive. The old `apex-cloudflare.zip` predates this change and must not be used for the updated site.

The UI and downloader are fixed to 2026 by default. The updater's `--year` option can create another archive, but changing the displayed season requires updating the app as well.

## Race overview alignment

Positions use a common approximate race-lap clock: the earliest recorded completion or next-lap start for each lap. Only position observations at or before that instant are used. Missing crossings break lines, and retirements end at the last known completed-lap time. These are running positions, not the final classification or an overtaking count.

Lap times and tyre strategy use each driver’s own lap number. For lapped drivers these differ from the leader’s clock. Event markers therefore appear only on the position chart. Events outside the actual recorded racing window are excluded; their race-lap labels are approximate.

Tyre stints include their ending lap. Missing ends are inferred from the next stint or recorded completed-lap count and labelled. Pit diamonds come from pit-lane records, not tyre changes; stationary stop and total pit-lane durations are shown separately. The default 180-second pace ceiling is a display filter only. Select **All lap times** to include long laps and stoppages.

Existing archives can add the race overview records without downloading telemetry again:

```sh
npm run update-data -- --all --metadata-only
```

## Weather alignment

Weather uses the latest observation at or before the selected timestamp, never a future reading. The age is displayed; observations older than 180 seconds are marked stale and not presented as current conditions. Values are not interpolated or filled from other records. Lap inspectors use the driver’s actual lap start; the running-order cursor uses the existing approximate race-lap clock. Season results use the labelled scheduled session start. Wind is converted from provider m/s to km/h; pressure remains mbar. Source field definitions: https://openf1.org/docs/#weather
