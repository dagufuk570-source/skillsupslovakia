import dotenv from 'dotenv';
dotenv.config();

// Use the same DB helper the app uses
const db = await import('../db/postgres.js');

const langs = ['en', 'sk', 'hu'];
const pagesToEnsure = [
  { slug: 'focus-areas', titles: { en: 'Focus Areas', sk: 'Zamerania', hu: 'Fókuszterületek' } },
  { slug: 'about-us', titles: { en: 'About Us', sk: 'O nás', hu: 'Rólunk' } },
  { slug: 'gdpr', titles: { en: 'GDPR', sk: 'GDPR', hu: 'GDPR' } },
  { slug: 'contact', titles: { en: 'Contact', sk: 'Kontakt', hu: 'Kapcsolat' } },
];

function defaultContent(title){
  return `<h2>${title}</h2><p>Content coming soon.</p>`;
}

async function run(){
  let created = 0;
  for(const lang of langs){
    for(const p of pagesToEnsure){
      const title = p.titles[lang] || p.titles.en;
      try {
        const existing = await db.getPage(lang, p.slug);
        if(!existing){
          await db.upsertPage({ lang, slug: p.slug, title, content: defaultContent(title) });
          created++;
          console.log(`Created page ${lang}/${p.slug}`);
        } else {
          // keep existing; do not overwrite user content
          console.log(`Exists, skip ${lang}/${p.slug}`);
        }
      } catch (err){
        console.error(`Error ensuring ${lang}/${p.slug}:`, err.message);
      }
    }
  }
  await db.close?.();
  console.log(`Done. Created ${created} pages if missing.`);
}

run().catch(err=>{
  console.error('Seed failed:', err);
  process.exit(1);
});
