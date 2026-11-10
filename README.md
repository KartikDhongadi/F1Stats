# APEX — F1, understood

A desktop-first dashboard for completed Formula 1 sessions from **2023 onward**, with **2026** selected initially. Real historical data comes from OpenF1. No accounts, API keys, subscriptions, npm packages, or paid services are required to run the app. Internet is required for the updater or the optional online data source. Saved data is read locally by default. See [DATA.md](DATA.md) for the saved-file workflow.

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

Saved archives now use compressed session bundles. The browser reads both the original format and the new format. Metadata is grouped by session; telemetry is grouped into bundles of up to four driver chunks, with a 5 MiB target and 20 MiB compressed ceiling. The charts and weather controls are unchanged.

To convert existing local seasons or rebuild bundles:

```sh
npm run bundle-data
```

Original individual files are retained in the Git-ignored `.archive-source/` directory, outside the deployed `public/` folder. Future `update-data` runs update those originals and publish bundles automatically. A fresh clone can reconstruct originals from the bundles. See [DATA.md](DATA.md) for migration, size limits and rollback details.


Run `npm run update-data` to save the latest completed weekend. Then select **Saved files** and click **Reload data**. Qualifying, races, sprint qualifying and sprints are included; practice is excluded. Full-season and correction options are documented in [DATA.md](DATA.md).

## Try it

- **Choose a race weekend:** the opening selector shows large country/circuit cards, newest first. Each completed Grand Prix has a compact P1/P2/P3 podium from saved classifications when available. Use search or select a card, then use **Choose race** above the stats or the persistent **Choose race / season** button in the left sidebar to reopen the selector. Closing the grid with Close or Escape does not remove these buttons. Card previews always use saved files, even when analysis uses the optional online source; missing podiums are labelled.
- **Session buttons:** switch directly between the available qualifying, race and sprint sessions. Switching from a race overview to qualifying opens its qualifying overview, and vice versa.
- **Searchable driver choices:** click a driver in Explorer, Compare laps or the race lap inspector, then search by name, team, abbreviation or number. Driver A and B stay distinct. Use Tab/Enter to select and Escape to close a picker.

- **Season overview:** select a completed Grand Prix; inspect results, driver standings, and constructor standings. Standings are as of that race, not necessarily the latest race.
- **Race overview:** select a Grand Prix or sprint. Show all drivers or narrow the field; inspect positions with the race-lap slider, click lap-time points, and review tyre stints, pit visits, and race-control events. The lap inspector opens telemetry or pins a lap for comparison. Long laps can be included with **All lap times**.
- **Qualifying overview:** explore every driver’s attempts, Q/SQ phases, sector details and best times, then open a lap or comparison.
- **Driver explorer:** pick a session, driver, and lap, then click **Load telemetry**. The fastest available non-pit-out lap is selected initially.
- **Compare laps:** select two drivers/laps from the same session and load telemetry. A uses a solid lime trace and B uses a dashed blue trace.
- Hover over a chart to inspect a shared distance cursor. Keyboard users can focus a chart and use arrow keys, Home, or End.
- Enable **Advanced view** for estimated acceleration, RPM, gear, and DRS provider codes.
- Try a different race/session and check that the data updates before drawing conclusions.

## Weather at a glance

A compact **Track conditions** summary stays beside the active statistics on desktop. It shows track and air temperature, rain status, wind, humidity and pressure. In smaller windows it sits above the same statistics.

- Race/sprint: follows the running-order lap cursor; selecting a lap, stint or pit marker shows the selected driver’s lap-start conditions.
- Qualifying/sprint qualifying: follows the selected attempt’s start time.
- Explorer/comparison: follows the chosen lap(s), with separate A/B summaries before and after telemetry loads.
- Season results: explicitly shows conditions at the selected session’s scheduled start, not a whole-session average.

Readings are timestamped in UTC with their age relative to the selection. Missing values remain unavailable; readings older than three minutes are marked stale and their values are withheld. The rain indicator does not measure track wetness. Saved mode reads existing files and makes no additional OpenF1 calls.

## Data and calculations

Source and endpoint documentation: https://openf1.org/docs/

Endpoints: `sessions`, `drivers`, `session_result`, `championship_drivers`, `championship_teams`, `laps`, `car_data`, `stints`, `position`, `pit`, `race_control`, and `weather`.

Only sessions with an end time in the past and not marked cancelled are shown. Use the season selector above the stats or inside the race grid to switch years. Future races are excluded. Historical availability is controlled by OpenF1; the app does not invent data when a source is missing. Championship endpoints are beta and may be incomplete.

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

Development preference: leave automated and browser testing to the user unless they explicitly request it. Provide commit/push commands when requested; do not execute them unless explicitly instructed to do so.

## Previous seasons

Choose a year above the stats or inside the race grid. The app loads that year’s archive and clears the previous season’s results, laps and weather. Season labels and race cards follow the selected year. The sidebar **Choose race / season** button remains available even when a season has no saved data.

If the selected season has no saved archive, close the grid and choose **OpenF1 online** under Data source, or download that year locally. For example:

```sh
npm run update-data -- --year 2025 --all
```

For a smaller download of results, laps and context without car telemetry:

```sh
npm run update-data -- --year 2025 --all --metadata-only
```

Then select 2025 and **Saved files**, and use **Reload data**. Run the full command later to add telemetry. Push the year’s data folder together with the app when you want it available on the hosted website. No older archives are downloaded automatically. The updater still defaults to 2026 when `--year` is omitted. Historical endpoint coverage can vary by season; missing records remain unavailable. Race-card podium previews use saved files, including in online mode.
