import {readdir,mkdir,open,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareSource,publishBundles} from './bundles.mjs';
const base=fileURLToPath(new URL('../',import.meta.url)),args=process.argv.slice(2);
if(args.length&&!(args.length===2&&args[0]==='--year'&&/^\d{4}$/.test(args[1])))throw Error('Usage: npm run bundle-data [-- --year 2026]');
const years=args.length?[Number(args[1])]:[...new Set((await Promise.all(['public/data','.archive-source'].map(async dir=>{try{return (await readdir(path.join(base,dir))).filter(s=>/^\d{4}$/.test(s));}catch(e){if(e.code==='ENOENT')return [];throw e;}}))).flat())].map(Number).sort();
for(const year of years){
 const publicRoot=path.join(base,'public/data',String(year));await mkdir(publicRoot,{recursive:true});
 const lockPath=path.join(publicRoot,'.update.lock');const lock=await open(lockPath,'wx').catch(()=>{throw Error(`An update/bundle operation is already active for ${year}.`);});
 try{await lock.writeFile(String(process.pid));await prepareSource(base,year);console.log(JSON.stringify(await publishBundles(base,year)));}
 finally{await lock.close();await unlink(lockPath);}
}
