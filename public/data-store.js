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
  let manifestPromise, generation=0;
  const cache=new Map(),pending=new Map(),indexes=new Map();
  async function getManifest(){
    if(!manifestPromise)manifestPromise=(async()=>{
      // Newer archives publish a small start-up index. Anything unexpected here falls back
      // to the full manifest, so older archives keep working unchanged.
      try{
        const response=await fetcher(`data/${year}/index.json`,{cache:'no-store'});
        if(response.ok){
          const index=await response.json();
          if(index?.format==='apex-index-v1'&&index.year===year&&Array.isArray(index.sessions)&&index.sessionAssets&&typeof index.sessionAssets==='object')return {...index,version:2,format:'apex-archive-v2'};
        }
      }catch{}
      const response=await fetchRetry(`data/${year}/manifest.json`,{cache:'no-store'});
      if(!response.ok)throw Error(`Saved ${year} data is not installed yet. Run npm run update-data -- --year ${year} --all in VS Code, then reload saved data.`);
      const json=await response.json();
      if(![1,2].includes(json.version)||json.year!==year||!Array.isArray(json.sessions)||!json.assets||(json.version===2&&json.format!=='apex-archive-v2'))throw Error('Unsupported data manifest. Update the app and saved data together.');
      return json;
    })().catch(error=>{manifestPromise=undefined;throw error;});
    return manifestPromise;
  }
  // One quiet retry covers a dropped connection or a brief server error.
  async function fetchRetry(url,options){
    for(let attempt=0;;attempt++){
      try{const response=await fetcher(url,options);if(!(response.status>=500)||attempt)return response;}
      catch{if(attempt)throw Error('Saved data could not be reached. Check your connection, then choose Try again.');}
      await new Promise(resolve=>setTimeout(resolve,600));
    }
  }
  const missingFile=()=>Object.assign(Error('A saved file is missing. Reload data or run the data updater to repair the archive.'),{missing:true});
  // One session's asset list, fetched the first time that session is opened.
  function sessionIndex(manifest,session){
    const entry=Object.hasOwn(manifest.sessionAssets,String(session))?manifest.sessionAssets[String(session)]:null;
    if(!entry)return {};
    if(!/^\d+\/bundles\/index-[a-f0-9]+\.json$/.test(entry.file))throw Error('Invalid session index path.');
    const key=entry.file+'?v='+entry.sha256;
    if(!indexes.has(key)){
      const promise=(async()=>{
        const response=await fetchRetry(`data/${year}/${key}`);
        if(!response.ok)throw missingFile();
        const value=await response.json();
        if(value?.format!=='apex-session-index-v1'||!value.assets||typeof value.assets!=='object')throw Error('Invalid session index.');
        return value.assets;
      })();
      indexes.set(key,promise);
      promise.catch(()=>{if(indexes.get(key)===promise)indexes.delete(key);});
    }
    return indexes.get(key);
  }
  async function readAsset(file,asset){
    const key=file+'?v='+asset.sha256;
    if(cache.has(key)){const item=cache.get(key);cache.delete(key);cache.set(key,item);return item.value;}
    if(pending.has(key))return pending.get(key);
    const atGeneration=generation;
    const promise=(async()=>{
      const response=await fetchRetry(`data/${year}/${key}`);
      if(!response.ok)throw missingFile();
      let value;
      if(asset.encoding==='gzip'||file.endsWith('.gz')){
        if(typeof DecompressionStream==='undefined')throw Error('Saved data requires a current Safari, Chrome or Firefox browser.');
        const bytes=await response.arrayBuffer(),header=new Uint8Array(bytes,0,Math.min(2,bytes.byteLength));
        value=header[0]===31&&header[1]===139?await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json():JSON.parse(new TextDecoder().decode(bytes));
      }else value=await response.json();
      if(atGeneration===generation){
        cache.set(key,{value,size:asset.rawBytes??JSON.stringify(value).length*2});
        while(cache.size>4||[...cache.values()].reduce((sum,item)=>sum+item.size,0)>64*1024*1024)cache.delete(cache.keys().next().value);
      }
      return value;
    })();
    pending.set(key,promise);
    try{return await promise;}finally{if(pending.get(key)===promise)pending.delete(key);}
  }
  const client={
    reset(){generation++;manifestPromise=undefined;cache.clear();pending.clear();indexes.clear();},
    manifest:getManifest,
    async summary(){
      const manifest=await getManifest();if(!manifest.summary)return null;
      if(manifest.summary.file!=='season-summary.json')throw Error('Unsupported summary path.');
      const value=await readAsset(manifest.summary.file,manifest.summary);
      if(value.format!=='apex-season-summary-v1'||value.year!==year||!Array.isArray(value.weekends))throw Error('Invalid season summary.');
      return value;
    },
    async query(endpoint,params={}){
      try{return await client.lookup(endpoint,params);}
      catch(error){
        if(!error?.missing)throw error;
        // An open tab can hold an index from before a newer deployment retired this file:
        // read the index again and try once more.
        manifestPromise=undefined;indexes.clear();
        return client.lookup(endpoint,params);
      }
    },
    async lookup(endpoint,params={}){
      const manifest=await getManifest();
      if(endpoint==='sessions')return manifest.sessions;
      const key=assetKey(endpoint,params),asset=(manifest.assets??await sessionIndex(manifest,params.session_key))[key];
      if(!asset)throw Error('This data has not been downloaded yet. Run npm run update-data for this season/weekend; no automatic OpenF1 request will be made.');
      if(manifest.version===1){
        const value=await readAsset(key+(asset.encoding==='gzip'?'.json.gz':'.json'),asset);
        const rows=endpoint==='car_data'?unpackCarData(value):value;
        if(!Array.isArray(rows))throw Error('Invalid saved data file.');
        return endpoint==='car_data'?filterWindow(rows,params):rows;
      }
      if(!Array.isArray(asset.chunks))throw Error('Invalid bundle index.');
      const from=params['date>']?Date.parse(params['date>']):-Infinity,to=params['date<']?Date.parse(params['date<']):Infinity;
      const chunks=asset.chunks.filter(c=>endpoint!=='car_data'||c.from==null||c.to==null||(c.to>=from&&c.from<=to));
      const rows=[];
      for(const chunk of chunks){
        if(!/^\d+\/bundles\/[a-z]+-[a-f0-9]+\.json\.gz$/.test(chunk.file))throw Error('Invalid bundle path.');
        const bundle=await readAsset(chunk.file,chunk);
        if(bundle.format!=='apex-bundle-v1'||!bundle.datasets||!Object.hasOwn(bundle.datasets,chunk.member))throw Error('Invalid bundle or missing dataset.');
        const value=bundle.datasets[chunk.member];
        let part;
        if(endpoint==='car_data'){
          if(value?.format!=='apex-car-v1'||JSON.stringify(value.columns)!==JSON.stringify(CAR_COLUMNS)||!Array.isArray(value.rows))throw Error('Unsupported bundled telemetry.');
          // Decode only the requested driver's samples in the requested lap window.
          const samples=value.rows.filter(row=>{const time=Date.parse(row[0]);return time>=from&&time<=to;});
          part=unpackCarData({...value,rows:samples});
        }else{if(!Array.isArray(value))throw Error('Invalid bundled dataset.');part=value;}
        for(const row of part)rows.push(row);
      }
      return rows;
    }
  };
  return client;
}
