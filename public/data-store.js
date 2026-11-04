export const SESSION_NAMES = new Set(['Qualifying', 'Race', 'Sprint Qualifying', 'Sprint Shootout', 'Sprint', 'Sprint Race']);
export function eligibleSessions(sessions, now = Date.now()) {
  return sessions.filter(s => SESSION_NAMES.has(s.session_name) && !s.is_cancelled && Date.parse(s.date_end) < now)
    .sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start));
}
export function assetKey(endpoint, params) {
  if (!/^\w+$/.test(endpoint) || !/^\d+$/.test(String(params.session_key))) throw Error('Invalid data selection.');
  const base = `${params.session_key}/${endpoint}`;
  if (endpoint !== 'car_data') return base;
  if (!/^\d+$/.test(String(params.driver_number))) throw Error('Invalid driver selection.');
  return `${base}/${params.driver_number}`;
}
export const CAR_COLUMNS = ['date', 'speed', 'throttle', 'brake', 'n_gear', 'rpm', 'drs'];
export function packCarData(rows) {
  return {format: 'apex-car-v1', columns: CAR_COLUMNS, rows: rows.map(r => CAR_COLUMNS.map(c => r[c] ?? null))};
}
export function unpackCarData(data) {
  if (data?.format !== 'apex-car-v1' || JSON.stringify(data.columns) !== JSON.stringify(CAR_COLUMNS) || !Array.isArray(data.rows)) throw Error('Unsupported telemetry file. Run the data updater again.');
  return data.rows.map(row => {
    if (!Array.isArray(row) || row.length !== CAR_COLUMNS.length) throw Error('Invalid telemetry row.');
    return Object.fromEntries(CAR_COLUMNS.map((c, i) => [c, row[i]]));
  });
}
export function filterWindow(rows, params) {
  const from = params['date>'] ? Date.parse(params['date>']) : -Infinity;
  const to = params['date<'] ? Date.parse(params['date<']) : Infinity;
  return rows.filter(row => {const t = Date.parse(row.date); return t >= from && t <= to;});
}
export function createArchiveClient(fetcher = fetch, year = 2026) {
  let manifest;
  const cache = new Map();
  async function getManifest() {
    if (!manifest) {
      const response = await fetcher(`data/${year}/manifest.json`, {cache: 'no-store'});
      if (!response.ok) throw Error('Saved data is not installed yet. Run npm run update-data in VS Code, then reload saved data.');
      const json = await response.json();
      if (json.version !== 1 || json.year !== year || !Array.isArray(json.sessions) || !json.assets) throw Error('Unsupported data manifest. Run the data updater again.');
      manifest = json;
    }
    return manifest;
  }
  return {
    reset() { manifest = undefined; cache.clear(); },
    manifest: getManifest,
    async query(endpoint, params = {}) {
      const manifest = await getManifest();
      if (endpoint === 'sessions') return manifest.sessions;
      const key = assetKey(endpoint, params), asset = manifest.assets[key];
      if (!asset) throw Error('This data has not been downloaded yet. Run npm run update-data for this weekend; the app will not make an OpenF1 request automatically.');
      if (!cache.has(key)) {
        const response = await fetcher(`data/${year}/${key}${asset.encoding==='gzip'?'.json.gz':'.json'}?v=${asset.sha256}`);
        if (!response.ok) throw Error('A saved file is missing. Run npm run update-data to repair the archive.');
        let json;
        if(asset.encoding==='gzip'){
          if(typeof DecompressionStream==='undefined')throw Error('Saved telemetry requires a current Safari, Chrome or Firefox browser.');
          const bytes=await response.arrayBuffer();
          // Some hosts transparently decompress gzip responses; accept either form.
          const header=new Uint8Array(bytes,0,Math.min(2,bytes.byteLength));
          json=header[0]===31&&header[1]===139 ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json() : JSON.parse(new TextDecoder().decode(bytes));
        }else json=await response.json();
        const rows = endpoint === 'car_data' ? unpackCarData(json) : json;
        if (!Array.isArray(rows)) throw Error('Invalid saved data file.');
        cache.set(key, rows);
        // Bound memory when browsing a whole season of telemetry.
        if (cache.size > 12) cache.delete(cache.keys().next().value);
      }
      const rows = cache.get(key);
      return endpoint === 'car_data' ? filterWindow(rows, params) : rows;
    }
  };
}
