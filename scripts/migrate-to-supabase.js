#!/usr/bin/env node
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

const SRC = process.env.SOURCE_DATABASE_URL || 'postgresql://skills_user:changeme@localhost:5432/skillsupslovakia';
const DST = process.env.TARGET_DATABASE_URL || process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
if(!DST){
  console.error('TARGET_DATABASE_URL (or SUPABASE_DATABASE_URL/DATABASE_URL) is required');
  process.exit(1);
}

// Enable SSL for Supabase
function mkPool(url){
  const cfg = { connectionString: url };
  try{
    const host = new URL(url).hostname || '';
    if(host.includes('supabase.co')) {
      cfg.ssl = { rejectUnauthorized: false }; // Supabase requires SSL
    } else if(host === 'localhost' || host === '127.0.0.1') {
      cfg.ssl = false; // Local default: no SSL
    }
  }catch{}
  // Apply env SSL only if not decided above
  if(typeof cfg.ssl === 'undefined' && process.env.DATABASE_SSL === '1') {
    cfg.ssl = { rejectUnauthorized: false };
  }
  return new Pool(cfg);
}

const src = mkPool(SRC);
const dst = mkPool(DST);

async function ensureTargetSchema(){
  // Minimal ensures just in case target is empty
  await dst.query(`CREATE TABLE IF NOT EXISTS pages (id SERIAL PRIMARY KEY, lang TEXT NOT NULL, slug TEXT NOT NULL, title TEXT NOT NULL, content JSONB NOT NULL DEFAULT '{}'::jsonb, image_url TEXT, created_at TIMESTAMP DEFAULT now(), updated_at TIMESTAMP DEFAULT now(), UNIQUE(lang, slug))`);
  await dst.query(`CREATE TABLE IF NOT EXISTS events (id SERIAL PRIMARY KEY, lang TEXT NOT NULL, slug TEXT, group_id TEXT, title TEXT NOT NULL, event_date DATE, location TEXT, description TEXT, image_url TEXT, created_at TIMESTAMP DEFAULT now(), updated_at TIMESTAMP DEFAULT now())`);
  await dst.query(`CREATE UNIQUE INDEX IF NOT EXISTS events_lang_slug_idx ON events(lang, slug) WHERE slug IS NOT NULL`);
  await dst.query(`CREATE INDEX IF NOT EXISTS events_group_idx ON events(group_id)`);
  await dst.query(`CREATE TABLE IF NOT EXISTS additional_images (id SERIAL PRIMARY KEY, content_type TEXT NOT NULL, content_id INTEGER NOT NULL, image_url TEXT NOT NULL, alt_text TEXT, sort_order INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT now())`);
  await dst.query(`CREATE INDEX IF NOT EXISTS additional_images_content_idx ON additional_images(content_type, content_id)`);
  await dst.query(`CREATE TABLE IF NOT EXISTS news (id SERIAL PRIMARY KEY, lang TEXT NOT NULL, slug TEXT, group_id TEXT, title TEXT NOT NULL, summary TEXT, content TEXT, image_url TEXT, published_at TIMESTAMP, is_published BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT now(), updated_at TIMESTAMP DEFAULT now())`);
  await dst.query(`CREATE UNIQUE INDEX IF NOT EXISTS news_lang_slug_idx ON news(lang, slug) WHERE slug IS NOT NULL`);
  await dst.query(`CREATE INDEX IF NOT EXISTS news_group_idx ON news(group_id)`);
  await dst.query(`CREATE INDEX IF NOT EXISTS news_published_idx ON news(is_published, published_at)`);
  await dst.query(`CREATE TABLE IF NOT EXISTS themes (id SERIAL PRIMARY KEY, lang TEXT NOT NULL, slug TEXT NOT NULL, group_id TEXT, title TEXT NOT NULL, description TEXT, image_url TEXT, created_at TIMESTAMP DEFAULT now(), updated_at TIMESTAMP DEFAULT now())`);
  await dst.query(`CREATE UNIQUE INDEX IF NOT EXISTS themes_lang_slug_idx ON themes(lang, slug)`);
  await dst.query(`CREATE INDEX IF NOT EXISTS themes_group_idx ON themes(group_id)`);
  await dst.query(`CREATE TABLE IF NOT EXISTS team_members (id SERIAL PRIMARY KEY, lang TEXT NOT NULL, slug TEXT, group_id TEXT, name TEXT NOT NULL, role TEXT, photo_url TEXT, bio TEXT, created_at TIMESTAMP DEFAULT now(), updated_at TIMESTAMP DEFAULT now())`);
  await dst.query(`CREATE UNIQUE INDEX IF NOT EXISTS team_lang_slug_idx ON team_members(lang, slug) WHERE slug IS NOT NULL`);
  await dst.query(`CREATE INDEX IF NOT EXISTS team_group_idx ON team_members(group_id)`);
  await dst.query(`CREATE TABLE IF NOT EXISTS settings (lang TEXT PRIMARY KEY, config JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMP DEFAULT now())`);
  await dst.query(`CREATE TABLE IF NOT EXISTS documents (id SERIAL PRIMARY KEY, lang TEXT NOT NULL, title TEXT NOT NULL, file_url TEXT NOT NULL, description TEXT, sort_order INTEGER DEFAULT 0, published BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT now(), updated_at TIMESTAMP DEFAULT now())`);
  await dst.query(`CREATE INDEX IF NOT EXISTS documents_lang_idx ON documents(lang)`);
  await dst.query(`CREATE INDEX IF NOT EXISTS documents_published_idx ON documents(published)`);
}

async function copyTable(table, keyColumns){
  console.log(`Migrating ${table}...`);
  // Determine if source table has an 'id' column for stable ordering
  const srcColsProbe = await src.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name=$1`,
    [table]
  );
  const srcColsNames = srcColsProbe.rows.map(r => r.column_name);
  const hasIdInSrc = srcColsNames.includes('id');
  const srcRes = await src.query(`SELECT * FROM ${table}${hasIdInSrc ? ' ORDER BY id' : ''}`);
  const rows = srcRes.rows;
  if(rows.length === 0){ console.log(`- ${table}: 0 rows`); return; }
  // Build column list from first row
  const cols = Object.keys(rows[0]);
  // Inspect destination table columns to know if 'id' exists there
  const dstColsRes = await dst.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name=$1`,
    [table]
  );
  const dstCols = dstColsRes.rows.map(r => r.column_name);
  // Columns that should be treated as JSON in target
  const JSON_COLUMNS = {
    pages: ['content'],
    settings: ['config']
  };
  const placeholders = cols.map((c,i)=>{
    const needsJson = (JSON_COLUMNS[table] || []).includes(c);
    return needsJson ? `$${i+1}::jsonb` : `$${i+1}`;
  }).join(',');
  const colList = cols.map(c=>`"${c}"`).join(',');
  // Use upsert if keyColumns provided and unique conflicts exist
  const onConflict = (keyColumns && keyColumns.length>0)
    ? ` ON CONFLICT (${keyColumns.map(c=>`"${c}"`).join(',')}) DO UPDATE SET ${cols.filter(c=>!keyColumns.includes(c) && c!=='id').map(c=>`"${c}"=EXCLUDED."${c}"`).join(', ')}`
    : '';
  await dst.query('BEGIN');
  try{
    // Helper to convert arbitrary value into valid JSON text for ::jsonb columns
    const toJsonCompat = (val) => {
      if (val === null || typeof val === 'undefined') return null;
      if (typeof val === 'string') {
        // If it's already valid JSON, keep as is; otherwise wrap as JSON string
        try { JSON.parse(val); return val; } catch { return JSON.stringify(val); }
      }
      // Objects/arrays/numbers/booleans -> JSON text
      try { return JSON.stringify(val); } catch { return JSON.stringify(String(val)); }
    };

    for(const r of rows){
      const values = cols.map(c=>{
        const v = r[c];
        const needsJson = (JSON_COLUMNS[table] || []).includes(c);
        return needsJson ? toJsonCompat(v) : v;
      });
      const sql = `INSERT INTO ${table} (${colList}) VALUES (${placeholders})${onConflict}`;
      await dst.query(sql, values);
    }
    // Fix sequence to max(id) only if destination has an 'id' column
    if(dstCols.includes('id')){
      await dst.query(`SELECT setval(pg_get_serial_sequence('${table}','id'), (SELECT COALESCE(MAX(id),1) FROM ${table}))`);
    }
    await dst.query('COMMIT');
    console.log(`- ${table}: ${rows.length} rows`);
  }catch(e){
    await dst.query('ROLLBACK');
    console.error(`Failed migrating ${table}:`, e.message);
    throw e;
  }
}

(async () => {
  try{
    await src.query('SELECT 1');
  }catch(e){
    console.error('Source DB not reachable:', e.message);
    process.exit(1);
  }
  try{
    await dst.query('SELECT 1');
  }catch(e){
    console.error('Target DB not reachable:', e.message);
    process.exit(1);
  }
  await ensureTargetSchema();

  // Order matters slightly
  await copyTable('pages', ['lang','slug']);
  await copyTable('themes', ['lang','slug']);
  // Use primary key based upsert to avoid duplicates on re-run
  await copyTable('events', ['id']);
  await copyTable('news', ['lang','slug']);
  await copyTable('team_members', ['lang','slug']);
  await copyTable('documents', ['id']);
  await copyTable('additional_images', ['id']);
  await copyTable('settings', ['lang']);

  await src.end();
  await dst.end();
  console.log('Migration complete.');
})();
