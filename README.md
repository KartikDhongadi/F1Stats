# APEX — F1, understood

A desktop-first dashboard for completed **2026** Formula 1 sessions. Real historical data comes from OpenF1. No accounts, API keys, subscriptions, npm packages, or paid services are required to run the app. Internet is required for the updater or the optional online data source. Saved data is read locally by default. See [DATA.md](DATA.md) for the saved-file workflow.

## Run on your MacBook with VS Code

1. Open this **F1Stats** folder in VS Code (`File → Open Folder`).
2. Open `Terminal → New Terminal`.
3. Run:

   ```sh
   npm run dev
   ```

4. Open **http://127.0.0.1:5173** in Safari or Chrome.
5. Keep the terminal running. Press **Control+C** in the terminal when you want to stop.

Node.js is already available on the development Mac. On another computer, use Node.js 20 or newer. You do **not** need to run `npm install`.

Alternative if Python 3 is available:

```sh
python3 -m http.server 5173 --bind 127.0.0.1 --directory public
```

If port 5173 is already in use, an existing preview may be running: open the URL first. Alternatively use port 5174 in the Python command and browser address. Do not open `index.html` by double-clicking it; JavaScript modules need the local web server.

## Saved data

Run `npm run update-data` to save the latest completed weekend. Then select **Saved files** and click **Reload data**. Qualifying, races, sprint qualifying and sprints are included; practice is excluded. Full-season and correction options are documented in [DATA.md](DATA.md).

## Try it

- **Season overview:** select a completed Grand Prix; inspect results, driver standings, and constructor standings. Standings are as of that race, not necessarily the latest race.
- **Race overview:** select a Grand Prix or sprint. Show all drivers or narrow the field; inspect positions with the race-lap slider, click lap-time points, and review tyre stints, pit visits, and race-control events. The lap inspector opens telemetry or pins a lap for comparison. Long laps can be included with **All lap times**.
- **Qualifying overview:** explore every driver’s attempts, Q/SQ phases, sector details and best times, then open a lap or comparison.
- **Driver explorer:** pick a session, driver, and lap, then click **Load telemetry**. The fastest available non-pit-out lap is selected initially.
- **Compare laps:** select two drivers/laps from the same session and load telemetry. A uses a solid lime trace and B uses a dashed blue trace.
- Hover over a chart to inspect a shared distance cursor. Keyboard users can focus a chart and use arrow keys, Home, or End.
- Enable **Advanced view** for estimated acceleration, RPM, gear, and DRS provider codes.
- Try a different race/session and check that the data updates before drawing conclusions.

## Data and calculations

Source and endpoint documentation: https://openf1.org/docs/

Endpoints: `sessions`, `drivers`, `session_result`, `championship_drivers`, `championship_teams`, `laps`, `car_data`, `stints`, `position`, `pit`, `race_control`, and `weather`.

Only sessions with an end time in the past and not marked cancelled are shown. The app is fixed to the approved 2026 season. Future races are excluded. Historical availability is controlled by OpenF1; the app does not invent data when a source is missing. Championship endpoints are beta and may be incomplete.

- Car samples are approximately 3.7 Hz. Braking is on/off, not pressure.
- Lap times are recorded provider values.
- Distance is estimated by trapezoidal integration of speed over time.
- For comparison, each lap's integrated distance is normalized to lap A's integrated length. This is an approximation: different racing lines and sampling can shift features.
- The estimated delta is **B elapsed time minus A elapsed time** at equal normalized distance. Positive means A is ahead. The official lap-time difference is displayed separately and can differ from the plotted endpoint because of missing boundary samples.
- Acceleration is a centered speed derivative using up to five samples, expressed in m/s². It is longitudinal acceleration, not total g-force or direct accelerometer data.
- Traces with fewer than ten samples, boundary gaps over 1.5 seconds, or internal gaps over two seconds are rejected. Small gaps are interpolated. This protects against misleading comparisons but can make some laps unavailable.
- Raw DRS codes are displayed only when supplied; their meaning/applicability can differ by season. Missing channels are shown as unavailable.
- Pit laps, traffic, weather, tyre compounds and fuel loads are not controlled for in comparisons.

## Free limits and privacy

In the optional online source, responses are cached in browser storage for one hour, and requests are spaced out. Telemetry is requested for just the selected lap. **Reload data** clears only this app's cache and reloads the season, so avoid clicking it repeatedly.

If OpenF1 returns a rate limit, wait a minute and retry. If it restricts access or is unavailable, try later. This app does not bypass restricted or paid endpoints. No live data, paid fallback, tracking, sign-in, or external font service is included. Your browser connects directly to OpenF1, which receives ordinary request metadata.

Free third-party services can change availability or policies. Hosting costs can remain zero by using a static free tier within its limits; this project is connected to the user’s GitHub and Cloudflare deployment.

## Checks

```sh
npm test
```

Tests cover distance integration, signed acceleration, delta sign, identical-lap comparison, missing samples, sorting/deduplication, discrete braking interpolation, and lap-time formatting. Tests also cover archive loading, qualifying phases, race position sampling, retirements, event alignment, stint boundaries, and missing/filtered laps. Test inputs are mathematical fixtures, not displayed race data.

## Files and eventual hosting

- `public/` — the complete deployable static website.
- `server.mjs` — local-only development server.
- `tests/` — numerical regression tests.

After local testing and explicit publication approval, the contents of `public/` can be hosted on a free static host (for example Cloudflare Pages). No backend or build step is needed. A free provider subdomain avoids domain registration costs. New changes should be tested locally before the user pushes them to the connected GitHub deployment. Rebuild any upload ZIP after changing app files or the saved archive.
