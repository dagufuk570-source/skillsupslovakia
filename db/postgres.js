import pkg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const { Pool } = pkg;

// Supabase-only: require an explicit DATABASE_URL (or SUPABASE_DATABASE_URL) and do not fallback to localhost
const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;
if(!connectionString){
  throw new Error('DATABASE_URL is not set. Please set your Supabase Postgres connection string in .env');
}

// Enable SSL automatically for Supabase or when DATABASE_SSL=1
let poolConfig = {
  connectionString,
  // Server-optimized defaults for persistent app (not serverless)
  max: parseInt(process.env.PG_POOL_MAX || '10', 10), // 10 connections for normal server
  min: parseInt(process.env.PG_POOL_MIN || '2', 10), // Keep 2 connections alive
  idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT_MS || '30000', 10), // 30s idle timeout
  connectionTimeoutMillis: parseInt(process.env.PG_CONN_TIMEOUT_MS || '10000', 10), // 10s connection timeout
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000, // Send keepalive every 10s
  // Reduce statement_timeout for faster failures
  statement_timeout: 10000, // 10 seconds per query
  query_timeout: 10000,
  // Retry connection on failure
  allowExitOnIdle: false // Prevent pool from closing when idle
};
// Force SSL with rejectUnauthorized: false for Supabase (accepts self-signed certs)
try {
  const host = new URL(connectionString).hostname || '';
  // Always use SSL for Supabase with rejectUnauthorized: false
  if (host.includes('supabase.co') || host.includes('supabase.com') || host.includes('.supabase.')) {
    // Must set ssl to true first, then configure with rejectUnauthorized: false
    poolConfig.ssl = true;
    poolConfig.ssl = { rejectUnauthorized: false };
    console.log('[postgres.js] SSL enabled for Supabase host:', host);
  }
} catch (e) {
  // ignore URL parse issues, fall back to non-SSL
  console.warn('[postgres.js] URL parse failed:', e.message);
}
if (process.env.DATABASE_SSL === '1') {
  poolConfig.ssl = { rejectUnauthorized: false };
  console.log('[postgres.js] SSL enabled via DATABASE_SSL=1');
}
console.log('[postgres.js] Final SSL config:', poolConfig.ssl);

const pool = new Pool(poolConfig);
// Prevent unhandled 'error' events from crashing the app when the DB restarts/terminates idle clients
pool.on('error', (err) => {
  try {
    console.error('[pg pool] Unexpected error on idle client:', err?.code || err?.message || err);
  } catch {}
});
// Also attach an error handler to each client to avoid unhandled 'error' events on active clients
pool.on('connect', (client) => {
  try {
    client.on('error', (err) => {
      try {
        console.error('[pg client] error:', err?.code || err?.message || err);
      } catch {}
    });
  } catch {}
});

export async function getPage(lang, slug){
  const res = await pool.query('SELECT * FROM pages WHERE lang=$1 AND slug=$2', [lang, slug]);
  return res.rows[0];
}

export async function listPages(lang){
  const res = await pool.query('SELECT * FROM pages WHERE lang=$1 ORDER BY id', [lang]);
  return res.rows;
}

export async function upsertPage({lang,slug,title,content,image_url}){
  // Ensure content is valid JSON for the JSONB column. If content is a string (HTML), stringify it
  const contentForDb = (typeof content === 'string' || typeof content === 'object') ? JSON.stringify(content) : content;
  // When image_url is undefined, preserve existing value by selecting first.
  let finalImageUrl = image_url;
  if(typeof finalImageUrl === 'undefined'){
    const existing = await pool.query('SELECT image_url FROM pages WHERE lang=$1 AND slug=$2', [lang, slug]);
    if(existing.rowCount > 0){
      finalImageUrl = existing.rows[0].image_url;
    } else {
      finalImageUrl = null;
    }
  }
  await pool.query(
    `INSERT INTO pages (lang,slug,title,content,image_url) VALUES ($1,$2,$3,$4::jsonb,$5)
     ON CONFLICT (lang,slug) DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content, image_url = EXCLUDED.image_url, updated_at = now()`,
    [lang,slug,title,contentForDb,finalImageUrl]
  );
}

// Ensure pages table exists (used by app startup)
export async function ensurePagesTable(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pages (
      id SERIAL PRIMARY KEY,
      lang TEXT NOT NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      content JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now(),
      UNIQUE(lang, slug)
    )`);
  // Conditionally add image_url column; ignore ownership errors but warn user
  const colRes = await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name='pages' AND column_name='image_url'");
  if(colRes.rowCount === 0){
    try {
      await pool.query('ALTER TABLE pages ADD COLUMN IF NOT EXISTS image_url TEXT');
    } catch (e) {
      if(/must be owner of table pages/i.test(e.message) || e.code === '42501'){
        console.warn('[ensurePagesTable] Lacking privileges to ALTER pages. Run as superuser:\n  ALTER TABLE pages OWNER TO skills_user;\n  ALTER TABLE pages ADD COLUMN IF NOT EXISTS image_url TEXT;');
      } else {
        throw e;
      }
    }
  }
}

export async function close(){
  await pool.end();
}

export async function ping(){
  await pool.query('SELECT 1');
}

// Events CRUD
export async function ensureEventsTable(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      lang TEXT NOT NULL,
      slug TEXT,
      group_id TEXT,
      title TEXT NOT NULL,
      event_date DATE,
      location TEXT,
      description TEXT,
      image_url TEXT,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    )`);
  await pool.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS slug TEXT');
  await pool.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS group_id TEXT');
  await pool.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS image_url TEXT');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS events_lang_slug_idx ON events(lang, slug) WHERE slug IS NOT NULL');
  await pool.query('CREATE INDEX IF NOT EXISTS events_group_idx ON events(group_id)');
}

export async function backfillEventLeadImages(){
  // For events with a group_id, if some variants have image_url and others don't, copy the image_url to missing ones
  await pool.query(`
    WITH lead_per_group AS (
      SELECT group_id, MAX(image_url) AS image_url
      FROM events
      WHERE group_id IS NOT NULL AND image_url IS NOT NULL
      GROUP BY group_id
    )
    UPDATE events e
       SET image_url = l.image_url,
           updated_at = now()
      FROM lead_per_group l
     WHERE e.group_id = l.group_id
       AND e.image_url IS NULL
  `);
}

export async function ensureAdditionalImagesTable(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS additional_images (
      id SERIAL PRIMARY KEY,
      content_type TEXT NOT NULL, -- 'event', 'theme', 'team', 'news', 'page'
      content_id INTEGER NOT NULL,
      image_url TEXT NOT NULL,
      alt_text TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT now()
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS additional_images_content_idx ON additional_images(content_type, content_id)');
}

export async function ensureNewsTable(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS news (
      id SERIAL PRIMARY KEY,
      lang TEXT NOT NULL,
      slug TEXT,
      group_id TEXT,
      title TEXT NOT NULL,
      summary TEXT,
      content TEXT,
      image_url TEXT,
      published_at TIMESTAMP,
      is_published BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    )`);
  await pool.query('ALTER TABLE news ADD COLUMN IF NOT EXISTS slug TEXT');
  await pool.query('ALTER TABLE news ADD COLUMN IF NOT EXISTS group_id TEXT');
  await pool.query('ALTER TABLE news ADD COLUMN IF NOT EXISTS image_url TEXT');
  await pool.query('ALTER TABLE news ADD COLUMN IF NOT EXISTS summary TEXT');
  await pool.query('ALTER TABLE news ADD COLUMN IF NOT EXISTS published_at TIMESTAMP');
  await pool.query('ALTER TABLE news ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT true');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS news_lang_slug_idx ON news(lang, slug) WHERE slug IS NOT NULL');
  await pool.query('CREATE INDEX IF NOT EXISTS news_group_idx ON news(group_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS news_published_idx ON news(is_published, published_at)');
}

export async function listEvents(lang){
  const res = await pool.query('SELECT * FROM events WHERE lang=$1 ORDER BY event_date NULLS LAST, id DESC', [lang]);
  return res.rows;
}
export async function listEventsUpcoming(lang, limit = 5){
  const res = await pool.query('SELECT * FROM events WHERE lang=$1 AND event_date IS NOT NULL AND event_date >= CURRENT_DATE ORDER BY event_date ASC LIMIT $2', [lang, limit]);
  return res.rows;
}

export async function getEvent(id){
  const res = await pool.query('SELECT * FROM events WHERE id=$1', [id]);
  return res.rows[0];
}

export async function getEventBySlug(lang, slug){
  const res = await pool.query('SELECT * FROM events WHERE lang=$1 AND slug=$2', [lang, slug]);
  return res.rows[0];
}

export async function getEventByGroupAndLang(group_id, lang){
  const res = await pool.query('SELECT * FROM events WHERE group_id=$1 AND lang=$2', [group_id, lang]);
  return res.rows[0];
}

export async function createEvent({ lang, group_id, slug, title, event_date, location, description, image_url }){
  const res = await pool.query(
    `INSERT INTO events (lang, group_id, slug, title, event_date, location, description, image_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [lang, group_id || null, slug || null, title, event_date || null, location || null, description || null, image_url || null]
  );
  return res.rows[0];
}

export async function updateEvent(id, { title, event_date, location, description, image_url }){
  const res = await pool.query(
    `UPDATE events
       SET title = $2,
           event_date = $3,
           location = $4,
           description = $5,
           image_url = $6,
           updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, title, event_date || null, location || null, description || null, image_url || null]
  );
  return res.rows[0];
}

export async function updateEventImageForGroup(id, image_url){
  // Given an event id, set image_url for all events in the same group_id
  const base = await pool.query('SELECT group_id FROM events WHERE id=$1', [id]);
  const groupId = base.rows[0]?.group_id || null;
  if(!groupId){
    // no group; update only this record
    await pool.query('UPDATE events SET image_url=$2, updated_at=now() WHERE id=$1', [id, image_url || null]);
    return;
  }
  await pool.query('UPDATE events SET image_url=$1, updated_at=now() WHERE group_id=$2', [image_url || null, groupId]);
}

export async function setEventGroup(id, group_id){
  await pool.query('UPDATE events SET group_id=$2, updated_at=now() WHERE id=$1', [id, group_id]);
}

export async function deleteEvent(id){
  // Delete additional images first
  await pool.query('DELETE FROM additional_images WHERE content_type=$1 AND content_id=$2', ['event', id]);
  await pool.query('DELETE FROM events WHERE id=$1', [id]);
}

export async function deleteEventGroup(group_id){
  await pool.query("DELETE FROM additional_images WHERE content_type='event' AND content_id IN (SELECT id FROM events WHERE group_id=$1)", [group_id]);
  await pool.query('DELETE FROM events WHERE group_id=$1', [group_id]);
}

// Additional Images functions
export async function addAdditionalImages(contentType, contentId, imageUrls){
  if(imageUrls.length === 0) return;
  
  for(let i = 0; i < imageUrls.length; i++) {
    await pool.query(
      'INSERT INTO additional_images (content_type, content_id, image_url, alt_text, sort_order) VALUES ($1, $2, $3, $4, $5)',
      [contentType, contentId, imageUrls[i], '', i]
    );
  }
}

export async function getAdditionalImages(contentType, contentId){
  const res = await pool.query('SELECT * FROM additional_images WHERE content_type=$1 AND content_id=$2 ORDER BY sort_order, id', [contentType, contentId]);
  return res.rows;
}

export async function deleteAdditionalImages(contentType, contentId){
  await pool.query('DELETE FROM additional_images WHERE content_type=$1 AND content_id=$2', [contentType, contentId]);
}

// Replace additional image items with explicit alt_text and sort_order
export async function replaceAdditionalImageItems(contentType, contentId, items){
  // items: [{ image_url: string, alt_text: string, sort_order: number }]
  await pool.query('DELETE FROM additional_images WHERE content_type=$1 AND content_id=$2', [contentType, contentId]);
  let idx = 0;
  for(const it of (items || [])){
    await pool.query(
      'INSERT INTO additional_images (content_type, content_id, image_url, alt_text, sort_order) VALUES ($1,$2,$3,$4,$5)',
      [contentType, contentId, it.image_url || '', it.alt_text || '', Number.isInteger(it.sort_order) ? it.sort_order : idx]
    );
    idx++;
  }
}

// News CRUD
export async function listNews(lang){
  const res = await pool.query('SELECT * FROM news WHERE lang=$1 ORDER BY published_at DESC NULLS LAST, id DESC', [lang]);
  return res.rows;
}

export async function listPublishedNews(lang, limit = 10){
  const res = await pool.query('SELECT * FROM news WHERE lang=$1 AND is_published=true ORDER BY published_at DESC NULLS LAST, id DESC LIMIT $2', [lang, limit]);
  return res.rows;
}

export async function getNews(id){
  const res = await pool.query('SELECT * FROM news WHERE id=$1', [id]);
  return res.rows[0];
}

export async function getNewsBySlug(slug, lang){
  const res = await pool.query('SELECT * FROM news WHERE slug=$1 AND lang=$2', [slug, lang]);
  return res.rows[0];
}

export async function getNewsByGroupAndLang(group_id, lang){
  const res = await pool.query('SELECT * FROM news WHERE group_id=$1 AND lang=$2', [group_id, lang]);
  return res.rows[0];
}

export async function createNews({ lang, group_id, slug, title, summary, content, image_url, published_at, is_published }){
  const res = await pool.query(
    `INSERT INTO news (lang, group_id, slug, title, summary, content, image_url, published_at, is_published)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [lang, group_id || null, slug || null, title, summary || null, content || null, image_url || null, published_at || null, is_published !== false]
  );
  return res.rows[0];
}

export async function updateNews(id, { title, summary, content, image_url, published_at, is_published, slug }){
  const res = await pool.query(
    `UPDATE news
       SET title = $2,
           summary = $3,
           content = $4,
           image_url = $5,
           published_at = $6,
           is_published = $7,
           slug = $8,
           updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, title, summary || null, content || null, image_url || null, published_at || null, is_published !== false, slug || null]
  );
  return res.rows[0];
}

export async function deleteNews(id){
  // Delete additional images first
  await pool.query('DELETE FROM additional_images WHERE content_type=$1 AND content_id=$2', ['news', id]);
  await pool.query('DELETE FROM news WHERE id=$1', [id]);
}

export async function deleteNewsGroup(group_id){
  await pool.query("DELETE FROM additional_images WHERE content_type='news' AND content_id IN (SELECT id FROM news WHERE group_id=$1)", [group_id]);
  await pool.query('DELETE FROM news WHERE group_id=$1', [group_id]);
}

// Themes CRUD
export async function ensureThemesTable(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS themes (
      id SERIAL PRIMARY KEY,
      lang TEXT NOT NULL,
      slug TEXT NOT NULL,
      group_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      image_url TEXT,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    )`);
  await pool.query('ALTER TABLE themes ADD COLUMN IF NOT EXISTS slug TEXT');
  await pool.query('ALTER TABLE themes ADD COLUMN IF NOT EXISTS group_id TEXT');
  await pool.query('ALTER TABLE themes ADD COLUMN IF NOT EXISTS image_url TEXT');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS themes_lang_slug_idx ON themes(lang, slug)');
  await pool.query('CREATE INDEX IF NOT EXISTS themes_group_idx ON themes(group_id)');
}

export async function listThemes(lang){
  const res = await pool.query('SELECT * FROM themes WHERE lang=$1 ORDER BY id DESC', [lang]);
  return res.rows;
}

export async function getTheme(id){
  const res = await pool.query('SELECT * FROM themes WHERE id=$1', [id]);
  return res.rows[0];
}

export async function createTheme({ lang, group_id, slug, title, description, image_url }){
  const res = await pool.query(
    `INSERT INTO themes (lang, group_id, slug, title, description, image_url)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [lang, group_id || null, slug, title, description || null, image_url || null]
  );
  return res.rows[0];
}

export async function updateTheme(id, { title, description, image_url }){
  const res = await pool.query(
    `UPDATE themes SET title=$2, description=$3, image_url=$4, updated_at=now() WHERE id=$1 RETURNING *`,
    [id, title, description || null, image_url || null]
  );
  return res.rows[0];
}

// Update theme with slug (used in multi-language edit flow)
export async function updateThemeWithSlug(id, { title, description, image_url, slug }){
  const res = await pool.query(
    `UPDATE themes SET title=$2, description=$3, image_url=$4, slug=$5, updated_at=now() WHERE id=$1 RETURNING *`,
    [id, title, description || null, image_url || null, slug || null]
  );
  return res.rows[0];
}

export async function updateThemeImageForGroup(id, image_url){
  const base = await pool.query('SELECT group_id FROM themes WHERE id=$1', [id]);
  const groupId = base.rows[0]?.group_id || null;
  if(!groupId){
    await pool.query('UPDATE themes SET image_url=$2, updated_at=now() WHERE id=$1', [id, image_url || null]);
    return;
  }
  await pool.query('UPDATE themes SET image_url=$1, updated_at=now() WHERE group_id=$2', [image_url || null, groupId]);
}

export async function deleteTheme(id){
  // Delete additional images first
  await pool.query('DELETE FROM additional_images WHERE content_type=$1 AND content_id=$2', ['theme', id]);
  await pool.query('DELETE FROM themes WHERE id=$1', [id]);
}

export async function deleteThemeGroup(group_id){
  await pool.query("DELETE FROM additional_images WHERE content_type='theme' AND content_id IN (SELECT id FROM themes WHERE group_id=$1)", [group_id]);
  await pool.query('DELETE FROM themes WHERE group_id=$1', [group_id]);
}

export async function backfillThemeLeadImages(){
  await pool.query(`
    WITH lead_per_group AS (
      SELECT group_id, MAX(image_url) AS image_url
      FROM themes
      WHERE group_id IS NOT NULL AND image_url IS NOT NULL
      GROUP BY group_id
    )
    UPDATE themes t
       SET image_url = l.image_url, updated_at = now()
      FROM lead_per_group l
     WHERE t.group_id = l.group_id AND t.image_url IS NULL
  `);
}

export async function updateNewsImageForGroup(id, image_url){
  const base = await pool.query('SELECT group_id FROM news WHERE id=$1', [id]);
  const groupId = base.rows[0]?.group_id || null;
  if(!groupId){
    await pool.query('UPDATE news SET image_url=$2, updated_at=now() WHERE id=$1', [id, image_url || null]);
    return;
  }
  await pool.query('UPDATE news SET image_url=$1, updated_at=now() WHERE group_id=$2', [image_url || null, groupId]);
}

export async function setNewsGroup(id, group_id){
  await pool.query('UPDATE news SET group_id=$2, updated_at=now() WHERE id=$1', [id, group_id]);
}

export async function backfillNewsLeadImages(){
  await pool.query(`
    WITH lead_per_group AS (
      SELECT group_id, MAX(image_url) AS image_url
      FROM news
      WHERE group_id IS NOT NULL AND image_url IS NOT NULL
      GROUP BY group_id
    )
    UPDATE news n
       SET image_url = l.image_url, updated_at = now()
      FROM lead_per_group l
     WHERE n.group_id = l.group_id AND n.image_url IS NULL
  `);
}

export async function getThemeBySlug(lang, slug){
  const res = await pool.query('SELECT * FROM themes WHERE lang=$1 AND slug=$2', [lang, slug]);
  return res.rows[0];
}

export async function getThemeByGroupAndLang(group_id, lang){
  const res = await pool.query('SELECT * FROM themes WHERE group_id=$1 AND lang=$2', [group_id, lang]);
  return res.rows[0];
}

export async function setThemeGroup(id, group_id){
  await pool.query('UPDATE themes SET group_id=$2, updated_at=now() WHERE id=$1', [id, group_id]);
}

// Team Members CRUD
export async function ensureTeamMembersTable(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_members (
      id SERIAL PRIMARY KEY,
      lang TEXT NOT NULL,
      slug TEXT,
      group_id TEXT,
      name TEXT NOT NULL,
      role TEXT,
      photo_url TEXT,
      bio TEXT,
      linkedin TEXT,
      facebook TEXT,
      twitter TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    )`);
  await pool.query('ALTER TABLE team_members ADD COLUMN IF NOT EXISTS slug TEXT');
  await pool.query('ALTER TABLE team_members ADD COLUMN IF NOT EXISTS group_id TEXT');
  await pool.query('ALTER TABLE team_members ADD COLUMN IF NOT EXISTS linkedin TEXT');
  await pool.query('ALTER TABLE team_members ADD COLUMN IF NOT EXISTS facebook TEXT');
  await pool.query('ALTER TABLE team_members ADD COLUMN IF NOT EXISTS twitter TEXT');
  await pool.query('ALTER TABLE team_members ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS team_lang_slug_idx ON team_members(lang, slug) WHERE slug IS NOT NULL');
  await pool.query('CREATE INDEX IF NOT EXISTS team_group_idx ON team_members(group_id)');
}

export async function listTeam(lang){
  const res = await pool.query('SELECT * FROM team_members WHERE lang=$1 ORDER BY sort_order, id DESC', [lang]);
  return res.rows;
}

export async function getTeamMember(id){
  const res = await pool.query('SELECT * FROM team_members WHERE id=$1', [id]);
  return res.rows[0];
}

export async function createTeamMember({ lang, group_id, slug, name, role, photo_url, bio, linkedin, facebook, twitter, sort_order }){
  const res = await pool.query(
    `INSERT INTO team_members (lang, group_id, slug, name, role, photo_url, bio, linkedin, facebook, twitter, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [lang, group_id || null, slug || null, name, role || null, photo_url || null, bio || null, linkedin || null, facebook || null, twitter || null, Number.isInteger(sort_order) ? sort_order : 0]
  );
  return res.rows[0];
}

export async function updateTeamMember(id, { name, role, photo_url, bio, linkedin, facebook, twitter, sort_order }){
  const res = await pool.query(
    `UPDATE team_members
        SET name=$2, role=$3, photo_url=$4, bio=$5, linkedin=$6, facebook=$7, twitter=$8, sort_order=$9, updated_at=now()
      WHERE id=$1 RETURNING *`,
    [id, name, role || null, photo_url || null, bio || null, linkedin || null, facebook || null, twitter || null, Number.isInteger(sort_order) ? sort_order : 0]
  );
  return res.rows[0];
}

export async function deleteTeamMember(id){
  await pool.query('DELETE FROM team_members WHERE id=$1', [id]);
}

export async function deleteTeamGroup(group_id){
  await pool.query('DELETE FROM team_members WHERE group_id=$1', [group_id]);
}

export async function getTeamMemberBySlug(lang, slug){
  const res = await pool.query('SELECT * FROM team_members WHERE lang=$1 AND slug=$2', [lang, slug]);
  return res.rows[0];
}

// Team helpers for multi-language grouping
export async function getTeamMemberByGroupAndLang(group_id, lang){
  const res = await pool.query('SELECT * FROM team_members WHERE group_id=$1 AND lang=$2 LIMIT 1', [group_id, lang]);
  return res.rows[0];
}

export async function setTeamGroup(id, group_id){
  await pool.query('UPDATE team_members SET group_id=$2, updated_at=now() WHERE id=$1', [id, group_id]);
}

export async function updateTeamPhotoForGroup(group_id, photo_url){
  await pool.query('UPDATE team_members SET photo_url=$1, updated_at=now() WHERE group_id=$2', [photo_url || null, group_id]);
}

export async function updateTeamSharedForGroup(group_id, { name, linkedin, facebook, twitter, sort_order }){
  await pool.query(
    `UPDATE team_members
       SET name = COALESCE($2, name),
           linkedin = COALESCE($3, linkedin),
           facebook = COALESCE($4, facebook),
           twitter = COALESCE($5, twitter),
           sort_order = COALESCE($6, sort_order),
           updated_at = now()
     WHERE group_id=$1`,
    [group_id, name || null, linkedin || null, facebook || null, twitter || null, Number.isInteger(sort_order) ? sort_order : null]
  );
}

// Settings per language (simple JSON config)
export async function ensureSettingsTable(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      lang TEXT PRIMARY KEY,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMP DEFAULT now()
    )`);
}

// Focus Areas (flexible columns via JSONB fields)
export async function ensureFocusAreasTable(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS focus_areas (
      id SERIAL PRIMARY KEY,
      lang TEXT NOT NULL,
      group_id TEXT,
      fields JSONB NOT NULL DEFAULT '{}'::jsonb,
      sort_order INTEGER DEFAULT 0,
      published BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS focus_areas_lang_idx ON focus_areas(lang)');
  await pool.query('CREATE INDEX IF NOT EXISTS focus_areas_published_idx ON focus_areas(published)');
  // Migrate: ensure group_id column exists (for older installs)
  await pool.query('ALTER TABLE focus_areas ADD COLUMN IF NOT EXISTS group_id TEXT');
  await pool.query('CREATE INDEX IF NOT EXISTS focus_areas_group_idx ON focus_areas(group_id)');
}

export async function listFocusAreas(lang, includeUnpublished = false){
  const res = includeUnpublished
    ? await pool.query('SELECT * FROM focus_areas WHERE lang=$1 ORDER BY sort_order, id DESC', [lang])
    : await pool.query('SELECT * FROM focus_areas WHERE lang=$1 AND published=true ORDER BY sort_order, id DESC', [lang]);
  return res.rows;
}

export async function getFocusArea(id){
  const res = await pool.query('SELECT * FROM focus_areas WHERE id=$1', [id]);
  return res.rows[0];
}

export async function createFocusArea({ lang, fields, sort_order, published, group_id }){
  const res = await pool.query(
    `INSERT INTO focus_areas (lang, group_id, fields, sort_order, published)
     VALUES ($1, $2, $3::jsonb, $4, $5) RETURNING *`,
    [lang, group_id || null, JSON.stringify(fields || {}), Number.isInteger(sort_order) ? sort_order : 0, published !== false]
  );
  return res.rows[0];
}

export async function updateFocusArea(id, { fields, sort_order, published }){
  const res = await pool.query(
    `UPDATE focus_areas
       SET fields = COALESCE($2::jsonb, fields),
           sort_order = COALESCE($3, sort_order),
           published = COALESCE($4, published),
           updated_at = now()
     WHERE id=$1 RETURNING *`,
    [id, fields ? JSON.stringify(fields) : null, Number.isInteger(sort_order) ? sort_order : null, typeof published === 'boolean' ? published : null]
  );
  return res.rows[0];
}

export async function deleteFocusArea(id){
  await pool.query('DELETE FROM focus_areas WHERE id=$1', [id]);
}

export async function deleteFocusAreaGroup(group_id){
  await pool.query('DELETE FROM focus_areas WHERE group_id=$1', [group_id]);
}

export async function getFocusAreaByGroupAndLang(group_id, lang){
  const res = await pool.query('SELECT * FROM focus_areas WHERE group_id=$1 AND lang=$2 LIMIT 1', [group_id, lang]);
  return res.rows[0];
}

export async function setFocusAreaGroup(id, group_id){
  const res = await pool.query('UPDATE focus_areas SET group_id=$2, updated_at=now() WHERE id=$1 RETURNING *', [id, group_id]);
  return res.rows[0];
}

export async function getSettings(lang){
  const res = await pool.query('SELECT config FROM settings WHERE lang=$1', [lang]);
  return res.rows[0]?.config || {};
}

export async function updateSettings(lang, config){
  await pool.query(
    `INSERT INTO settings (lang, config, updated_at)
     VALUES ($1,$2::jsonb, now())
     ON CONFLICT (lang) DO UPDATE SET config = EXCLUDED.config, updated_at = now()`,
    [lang, JSON.stringify(config)]
  );
}

// Documents CRUD
export async function ensureDocumentsTable(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      lang TEXT NOT NULL,
      group_id TEXT,
      title TEXT NOT NULL,
      file_url TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER DEFAULT 0,
      published BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    )`);
  await pool.query('ALTER TABLE documents ADD COLUMN IF NOT EXISTS group_id TEXT');
  await pool.query('CREATE INDEX IF NOT EXISTS documents_lang_idx ON documents(lang)');
  await pool.query('CREATE INDEX IF NOT EXISTS documents_published_idx ON documents(published)');
  await pool.query('CREATE INDEX IF NOT EXISTS documents_group_idx ON documents(group_id)');
}

export async function listDocuments(lang){
  const res = await pool.query('SELECT * FROM documents WHERE lang=$1 ORDER BY sort_order, id DESC', [lang]);
  return res.rows;
}

export async function getDocument(id){
  const res = await pool.query('SELECT * FROM documents WHERE id=$1', [id]);
  return res.rows[0];
}

export async function createDocument({ lang, title, file_url, description, sort_order, published }){
  const res = await pool.query(
    `INSERT INTO documents (lang, group_id, title, file_url, description, sort_order, published)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [lang, null, title, file_url, description || null, sort_order || 0, published !== false]
  );
  return res.rows[0];
}

export async function updateDocument(id, { title, file_url, description, sort_order, published }){
  const res = await pool.query(
    `UPDATE documents
       SET title=$2,
           file_url=$3,
           description=$4,
           sort_order=$5,
           published=$6,
           updated_at=now()
     WHERE id=$1 RETURNING *`,
    [id, title, file_url, description || null, sort_order || 0, published !== false]
  );
  return res.rows[0];
}

export async function deleteDocument(id){
  await pool.query('DELETE FROM documents WHERE id=$1', [id]);
}

export async function deleteDocumentGroup(group_id){
  await pool.query('DELETE FROM documents WHERE group_id=$1', [group_id]);
}

export async function getDocumentByGroupAndLang(group_id, lang){
  const res = await pool.query('SELECT * FROM documents WHERE group_id=$1 AND lang=$2 LIMIT 1', [group_id, lang]);
  return res.rows[0];
}

export async function setDocumentGroup(id, group_id){
  await pool.query('UPDATE documents SET group_id=$2, updated_at=now() WHERE id=$1', [id, group_id]);
}

export async function updateDocumentFileForGroup(group_id, file_url){
  await pool.query('UPDATE documents SET file_url=$2, updated_at=now() WHERE group_id=$1', [group_id, file_url]);
}

// Random gallery images (aggregate from various image sources)
export async function listRandomImages(limit = 12){
  const sql = `
    SELECT url FROM (
      SELECT image_url AS url FROM additional_images
      UNION
      SELECT image_url AS url FROM events
      UNION
      SELECT image_url AS url FROM news
      UNION
      SELECT image_url AS url FROM themes
      UNION
      SELECT photo_url AS url FROM team_members
      UNION
      SELECT image_url AS url FROM pages
    ) u
    WHERE url IS NOT NULL AND url <> ''
    ORDER BY random()
    LIMIT $1`;
  const res = await pool.query(sql, [limit]);
  return res.rows.map(r => r.url);
}

// Contact messages storage (fallback/logging)
export async function ensureContactMessagesTable(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contact_messages (
      id SERIAL PRIMARY KEY,
      name TEXT,
      email TEXT,
      subject TEXT,
      message TEXT,
      lang TEXT,
      status TEXT,
      error TEXT,
      created_at TIMESTAMP DEFAULT now()
    )`);
}

export async function createContactMessage({ name, email, subject, message, lang, status, error }){
  await pool.query(
    `INSERT INTO contact_messages (name, email, subject, message, lang, status, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [name || null, email || null, subject || null, message || null, lang || null, status || null, error || null]
  );
}

export async function listRecentContactMessages(limit = 50){
  const res = await pool.query(
    'SELECT id, name, email, subject, lang, status, error, created_at FROM contact_messages ORDER BY id DESC LIMIT $1',
    [limit]
  );
  return res.rows;
}

// Partners management
export async function ensurePartnersTable(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS partners (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      logo_url TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    )`);
}

export async function listPartners(){
  const res = await pool.query('SELECT * FROM partners ORDER BY sort_order, id');
  return res.rows;
}

export async function getPartner(id){
  const res = await pool.query('SELECT * FROM partners WHERE id=$1', [id]);
  return res.rows[0];
}

export async function createPartner({ name, logo_url, sort_order }){
  const res = await pool.query(
    `INSERT INTO partners (name, logo_url, sort_order) VALUES ($1,$2,$3) RETURNING id`,
    [name, logo_url || null, sort_order || 0]
  );
  return res.rows[0].id;
}

export async function updatePartner(id, { name, logo_url, sort_order }){
  await pool.query(
    `UPDATE partners SET name=$1, logo_url=$2, sort_order=$3, updated_at=now() WHERE id=$4`,
    [name, logo_url || null, sort_order || 0, id]
  );
}

export async function deletePartner(id){
  await pool.query('DELETE FROM partners WHERE id=$1', [id]);
}
