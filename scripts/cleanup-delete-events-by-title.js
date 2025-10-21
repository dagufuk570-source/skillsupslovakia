import * as db from '../db/postgres.js';

const langs = ['en','sk','hu'];

function usage(){
  console.log('Usage: node scripts/cleanup-delete-events-by-title.js <title1> [title2] [...titleN]');
}

async function main(){
  const args = process.argv.slice(2);
  if(args.length === 0){
    usage();
    process.exit(1);
  }
  const targetLc = new Set(args.map(s => String(s).trim().toLowerCase()).filter(Boolean));
  console.log('[cleanup] Target titles:', Array.from(targetLc));
  let all = [];
  try{
    const res = await Promise.all(langs.map(l => db.listEvents(l).catch(()=>[])));
    for(const arr of res) all.push(...arr);
  }catch(e){
    console.error('[cleanup] Failed to list events:', e?.message || e);
    process.exit(2);
  }
  const matches = all.filter(ev => ev && typeof ev.title === 'string' && targetLc.has(ev.title.trim().toLowerCase()));
  if(matches.length === 0){
    console.log('[cleanup] No matching events found.');
    process.exit(0);
  }
  console.log(`[cleanup] Found ${matches.length} matching records:`);
  for(const m of matches){
    console.log(` - id=${m.id} lang=${m.lang} group=${m.group_id || '–'} title=${m.title}`);
  }
  let deleted = 0;
  for(const m of matches){
    try{
      await db.deleteEvent(m.id);
      deleted++;
      console.log(`[cleanup] Deleted id=${m.id} (${m.lang})`);
    }catch(e){
      console.warn(`[cleanup] Failed to delete id=${m.id}:`, e?.message || e);
    }
  }
  console.log(`[cleanup] Done. Deleted ${deleted}/${matches.length} records.`);
  process.exit(0);
}

main();
