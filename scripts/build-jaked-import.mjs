// Run from the local reconciliation workspace. The output contains JAKED supplier prices: name it
// sql/<date>_jaked-business-catalogue.sql (git-ignored) and NEVER commit it — this repository is public.
import fs from 'node:fs/promises';
const [sourcesPath,reconPath,photosPath,outputPath]=process.argv.slice(2);
if(!outputPath)throw Error('Usage: node build-jaked-import.mjs sources.json reconciliation.json official-products.json output.sql');
const sources=JSON.parse(await fs.readFile(sourcesPath,'utf8'));
const {catalogue,vv}=JSON.parse(await fs.readFile(reconPath,'utf8'));
const photos=JSON.parse(await fs.readFile(photosPath,'utf8')).products;
const norm=x=>String(x??'').trim().toUpperCase().replace(/\s+/g,'');
const products=catalogue.map(p=>{const exact=photos.filter(x=>(x.tags||[]).some(t=>norm(t)===p[0])||x.handle.toUpperCase().endsWith('-'+p[0]));const found=exact.length===1?exact[0]:null;return {sku:p[0],sourceSku:p[1],section:p[2],collection:p[3],gender:p[4],description:p[5],retail:p[6],wholesale:p[7],source:p[8],sourceRow:p[9],match:p[13],images:found?(found.images||[]).slice(0,4).map(x=>x.src):[],productUrl:found?'https://www.jaked.com/en/products/'+found.handle:null,imageMatch:found?'Exact parent code':exact.length>1?'Multiple official matches':'No official match'};});
const variants=vv.map(v=>({sku:v[0],parent:v[1],collection:v[2],description:v[3],size:v[4],colorCode:v[5],color:v[6],ws:v[7],ec:v[8],rt:v[9],total:v[10],other:v[10]-v[7]-v[8]-v[9],sourceRows:v[11],priceMatch:v[12]}));
const rawStock=sources.find(s=>s.file.startsWith('16.')).sheets[0].rows.slice(1);
const sourceTotal=rawStock.reduce((s,r)=>s+r[12],0),total=variants.reduce((s,v)=>s+v.total,0);
if(sourceTotal!==total||products.length!==122||variants.length!==3836)throw Error('Source control mismatch');
const payload={snapshotDate:'2026-11-16',snapshotDateBasis:'Supplier filename',imageRetrieved:'2026-11-18',imageSource:'https://www.jaked.com/products.json?limit=250&page=1',products,variants,sourceControls:{priceRows:products.length,stockRows:rawStock.length,stockTotal:total,photoMatches:products.filter(p=>p.images.length).length},sources:sources.map(s=>s.file)};
const json=JSON.stringify(payload);if(json.includes('$jakedseed$'))throw Error('Unsafe SQL delimiter');
await fs.writeFile(outputPath,`-- Private catalogue import. Pending review; not applied. No public JS/JSON price bundle.\n-- Purpose: import 122 prices and 3,836 variants from the three supplier workbooks.\n-- Requested by: Dave.\n-- Pre-checks: SELECT count(*) FROM public.jaked_business_catalogue WHERE snapshot_date='2026-11-16'; -- expect 0\n-- Backup: insert-only; duplicate snapshot fails without overwriting existing data.\nDO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public._project_identity WHERE key='project_name' AND value='swimloading') THEN RAISE EXCEPTION 'Wrong project'; END IF; END $$;\nBEGIN;\nINSERT INTO public.jaked_business_catalogue(snapshot_date,payload) VALUES('2026-11-16',$jakedseed$${json}$jakedseed$::jsonb);\nCOMMIT;\n-- Rollback: retain source workbook, export any newer imports first; DELETE FROM public.jaked_business_catalogue WHERE snapshot_date='2026-11-16'; requires approved backup before executing.\n-- Verify: SELECT jsonb_array_length(payload->'products'),jsonb_array_length(payload->'variants'),payload->'sourceControls' FROM public.jaked_business_catalogue WHERE snapshot_date='2026-11-16'; -- 122 / 3836 / stockTotal 149054\n`);
console.log(JSON.stringify(payload.sourceControls));
// Separate fixture for loopback-only developer QA; not part of the website package.
if(process.env.JAKED_LOCAL_FIXTURE)await fs.writeFile(process.env.JAKED_LOCAL_FIXTURE,json);
