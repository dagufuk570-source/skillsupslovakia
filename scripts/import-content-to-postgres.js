import fs from 'fs/promises';
import { upsertPage } from '../db/postgres.js';

async function run(){
  const raw = await fs.readFile(new URL('../content.json', import.meta.url), 'utf8');
  const content = JSON.parse(raw);
  for(const [lang, blob] of Object.entries(content)){
    const pages = blob.pages || {};
    for(const [slug, page] of Object.entries(pages)){
      console.log(`Importing ${lang}/${slug}`);
      await upsertPage({ lang, slug, title: page.title, content: page.content });
    }
  }
  console.log('Import complete');
}

run().catch(err=>{ console.error(err); process.exit(1); });
