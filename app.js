console.log('[app.js] Module loading START');
import express from 'express';
console.log('[app.js] express imported');
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
console.log('[app.js] dotenv imported');
import multer from 'multer';
console.log('[app.js] multer imported');
import sharp from 'sharp';
console.log('[app.js] sharp imported');
import fsSync from 'fs';
import crypto from 'crypto';
import helmet from 'helmet';
import nodemailer from 'nodemailer';
import https from 'https';
import { uploadFile, deleteFile } from './lib/storage.js';
console.log('[app.js] storage imported');
dotenv.config();
console.log('[app.js] dotenv configured');

let db = null;
let useDb = true; // enforce DB-only

// Ensure __filename and __dirname are available early (ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Detect serverless environment globally
const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);

// Global safety nets to avoid process exit on transient DB terminations and unhandled rejections
process.on('uncaughtException', (err) => {
  try {
    const code = err && (err.code || err.name);
    const msg = err?.stack || err?.message || String(err);
    console.error('[uncaughtException]', code ? `${code}: ${msg}` : msg);
  } catch {}
});
process.on('unhandledRejection', (reason) => {
  try {
    const code = reason && (reason.code || reason.name);
    const msg = (reason && (reason.stack || reason.message)) ? (reason.stack || reason.message) : String(reason);
    console.error('[unhandledRejection]', code ? `${code}: ${msg}` : msg);
  } catch {}
});

// Preferred navigation order by slug
const NAV_ORDER = ['home','about-us','focus-areas','themes','events','team','gdpr','contact','news','documents'];

function buildMenu(pages){
  const bySlug = Object.create(null);
  for(const p of pages || []) bySlug[p.slug] = p;
  const ordered = [];
  for(const slug of NAV_ORDER){
    if(bySlug[slug]){
      ordered.push(bySlug[slug]);
      delete bySlug[slug];
    }
  }
  const extras = Object.values(bySlug).sort((a,b)=>{
    return String(a.title||'').localeCompare(String(b.title||''));
  });
  return ordered.concat(extras);
}

// Simple slugify for titles (supports accents removal)
function slugify(input){
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// Sanitize location: remove parentheses and quotes, collapse spaces
function sanitizeLocation(input){
  const s = String(input || '')
    .replace(/[()'\"]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return s || null;
}

// Resolve canonical gallery owner record within a group for events/news/themes
async function resolveEventGalleryOwnerId(base){
  try{
    const ids = [];
    if(base.group_id){
      const en = await db.getEventByGroupAndLang?.(base.group_id, 'en');
      const sk = await db.getEventByGroupAndLang?.(base.group_id, 'sk');
      const hu = await db.getEventByGroupAndLang?.(base.group_id, 'hu');
      for(const r of [en, sk, hu, base]){ if(r && r.id && !ids.includes(r.id)) ids.push(r.id); }
    } else if (base?.id){
      ids.push(base.id);
    }
    // Prefer the first record that already has images; else fallback to EN/SK/HU/base order
    for(const id of ids){
      const imgs = await db.getAdditionalImages('event', id);
      if(Array.isArray(imgs) && imgs.length > 0) return id;
    }
    return ids[0] || base.id;
  }catch{
    return base?.id;
  }
}

// Resolve event variant for current language with fallback
async function resolveEventVariant(event, lang){
  if(!event || !event.group_id || !db.getEventByGroupAndLang) return event;
  try{
    const cur = await db.getEventByGroupAndLang(event.group_id, lang);
    if(cur) return cur;
    const en = await db.getEventByGroupAndLang(event.group_id, 'en');
    const sk = await db.getEventByGroupAndLang(event.group_id, 'sk');
    const hu = await db.getEventByGroupAndLang(event.group_id, 'hu');
    return en || sk || hu || event;
  }catch{ return event; }
}

async function resolveNewsGalleryOwnerId(base){
  try{
    const ids = [];
    if(base.group_id){
      const en = await db.getNewsByGroupAndLang?.(base.group_id, 'en');
      const sk = await db.getNewsByGroupAndLang?.(base.group_id, 'sk');
      const hu = await db.getNewsByGroupAndLang?.(base.group_id, 'hu');
      for(const r of [en, sk, hu, base]){ if(r && r.id && !ids.includes(r.id)) ids.push(r.id); }
    } else if (base?.id){
      ids.push(base.id);
    }
    for(const id of ids){
      const imgs = await db.getAdditionalImages('news', id);
      if(Array.isArray(imgs) && imgs.length > 0) return id;
    }
    return ids[0] || base.id;
  }catch{
    return base?.id;
  }
}

async function resolveThemeGalleryOwnerId(base){
  try{
    const ids = [];
    if(base.group_id){
      const en = await db.getThemeByGroupAndLang?.(base.group_id, 'en');
      const sk = await db.getThemeByGroupAndLang?.(base.group_id, 'sk');
      const hu = await db.getThemeByGroupAndLang?.(base.group_id, 'hu');
      for(const r of [en, sk, hu, base]){ if(r && r.id && !ids.includes(r.id)) ids.push(r.id); }
    } else if (base?.id){
      ids.push(base.id);
    }
    for(const id of ids){
      const imgs = await db.getAdditionalImages('theme', id);
      if(Array.isArray(imgs) && imgs.length > 0) return id;
    }
    return ids[0] || base.id;
  }catch{
    return base?.id;
  }
}

async function uniqueThemeSlug(lang, base){
  let slug = base || 'item';
  let attempt = 0;
  while(true){
    const s = attempt === 0 ? slug : `${slug}-${attempt+1}`;
    const existing = await db.getThemeBySlug?.(lang, s);
    if(!existing) return s;
    attempt++;
    if(attempt > 50) throw new Error('Could not generate unique slug');
  }
}

async function uniqueNewsSlug(lang, base){
  let slug = base || 'article';
  let attempt = 0;
  while(true){
    const s = attempt === 0 ? slug : `${slug}-${attempt+1}`;
    const existing = await db.getNewsBySlug?.(s, lang);
    if(!existing) return s;
    attempt++;
    if(attempt > 50) throw new Error('Could not generate unique slug');
  }
}

async function uniqueEventSlug(lang, base){
  let slug = base || 'event';
  let attempt = 0;
  while(true){
    const s = attempt === 0 ? slug : `${slug}-${attempt+1}`;
    const existing = await db.getEventBySlug?.(lang, s);
    if(!existing) return s;
    attempt++;
    if(attempt > 50) throw new Error('Could not generate unique slug');
  }
}

async function connectDbWithRetry(){
  const requireDb = true; // always require DB
  const shouldTryDb = true;
  // In serverless, reduce retries to avoid cold start timeout
  const defaultAttempts = isServerless ? '3' : '20'; // Only 3 attempts in serverless
  const defaultDelay = isServerless ? '500' : '1500'; // 500ms delay in serverless
  const attempts = parseInt(process.env.DB_RETRY_ATTEMPTS || defaultAttempts, 10);
  const delayMs = parseInt(process.env.DB_RETRY_DELAY_MS || defaultDelay, 10);
  let lastErr = null;
  for(let i=1;i<=attempts;i++){
    try{
      if(!db){
        db = await import('./db/postgres.js');
      }
      await db.ping();
      
      // Create tables in parallel for faster initialization
      await Promise.all([
        db.ensurePagesTable?.(),
        db.ensureEventsTable?.(),
        db.ensureThemesTable?.(),
        db.ensureTeamMembersTable?.(),
        db.ensurePartnersTable?.(),
        db.ensureSettingsTable?.(),
        db.ensureFocusAreasTable?.(),
        db.ensureAdditionalImagesTable?.(),
        db.ensureNewsTable?.(),
        db.ensureDocumentsTable?.(),
        db.ensureContactMessagesTable?.()
      ]);
      
      // Backfill consistency in parallel
      await Promise.all([
        db.backfillEventLeadImages?.(),
        db.backfillThemeLeadImages?.(),
        db.backfillNewsLeadImages?.()
      ]);
      
      // Ensure key pages exist (About Us, Focus Areas, Contact, GDPR) if not present
      try{
        const langs = ['en','sk','hu'];
        for(const l of langs){
          const pages = await db.listPages?.(l) || [];
          const bySlug = Object.fromEntries(pages.map(p=>[p.slug, p]));
          const ensure = async (slug, title, content) => {
            if(!bySlug[slug]){
              await db.upsertPage?.({ lang: l, slug, title, content });
            }
          };
          await ensure('about-us', l==='sk' ? 'O nás' : (l==='hu' ? 'Rólunk' : 'About Us'), '<p>About our organization.</p>');
          await ensure('focus-areas', l==='sk' ? 'Zamerania' : (l==='hu' ? 'Fókuszterületek' : 'Focus Areas'), '<p>Our key focus areas.</p>');
          await ensure('contact', l==='sk' ? 'Kontakt' : (l==='hu' ? 'Kapcsolat' : 'Contact'), '<p>Get in touch with us.</p>');
          await ensure('gdpr', 'GDPR', '<p>Privacy and data protection information.</p>');
          if(!bySlug['home']){
            await db.upsertPage?.({ lang: l, slug: 'home', title: l==='sk' ? 'Domov' : (l==='hu' ? 'Főoldal' : 'Home'), content: '<p>Welcome to our site.</p>' });
          }
        }
      }catch(e){
        console.warn('Ensure key pages failed (non-fatal):', e.message);
      }
  useDb = true;
      console.log('Backend: PostgreSQL (connected)');
      return;
    }catch(err){
      lastErr = err;
      console.warn(`DB not ready (attempt ${i}/${attempts}): ${err.message}`);
      await new Promise(r=>setTimeout(r, delayMs));
    }
  }
  const errMsg = 'Backend: PostgreSQL required but unavailable: ' + (lastErr?.stack || lastErr?.message || 'unknown error');
  console.error(errMsg);
  
  // In serverless environments, throw instead of exit so middleware can handle it
  if (isServerless) {
    throw new Error(errMsg);
  }
  
  // In traditional Node server, exit
  process.exit(1);
}

// One-time cleanup at startup: ensure About Us sections 2 and 3 have no images
async function purgeAboutUsMidImages() {
  try {
    const langs = ['en', 'sk', 'hu'];
    for (const l of langs) {
      let page;
      try { page = await db.getPage(l, 'about-us'); } catch {}
      if (!page || !page.id) continue;
      let items = [];
      try { items = await db.getAdditionalImages('page', page.id); } catch {}
      if (!Array.isArray(items) || items.length === 0) continue;
      let changed = false;
      const final = items.map((it, idx) => {
        if (idx === 1 || idx === 2) {
          // Unlink local file if any
          try {
            if (it && it.image_url && typeof it.image_url === 'string' && it.image_url.startsWith('/uploads/')) {
              const p = path.join(__dirname, 'public', it.image_url.replace(/^\//, ''));
              if (fsSync.existsSync(p)) fsSync.unlinkSync(p);
            }
          } catch {}
          changed = true;
          return { image_url: '', alt_text: (it && it.alt_text) || '', sort_order: idx };
        }
        return { image_url: (it && it.image_url) || '', alt_text: (it && it.alt_text) || '', sort_order: idx };
      });
      if (changed) {
        if (typeof db.replaceAdditionalImageItems === 'function') {
          await db.replaceAdditionalImageItems('page', page.id, final);
        } else {
          await db.deleteAdditionalImages('page', page.id);
          if (final.length) await db.addAdditionalImages('page', page.id, final.map(f => f.image_url));
        }
      }
    }
  } catch (e) {
    console.warn('Startup purge (About Us 2 & 3 images) failed:', e?.message || e);
  }
}

// Lazy initialization state (runs once on first request in serverless environments)
let dbInitialized = false;
async function ensureDbInitialized() {
  if (dbInitialized) return;
  
  console.log('[ensureDbInitialized] Starting DB initialization...');
  console.log('[ensureDbInitialized] DATABASE_URL present:', !!process.env.DATABASE_URL);
  console.log('[ensureDbInitialized] DATABASE_URL prefix:', process.env.DATABASE_URL?.substring(0, 30) + '...');
  
  try {
    await connectDbWithRetry();
    await purgeAboutUsMidImages();
    dbInitialized = true;
    console.log('[ensureDbInitialized] DB initialization SUCCESS');
  } catch (error) {
    console.error('[ensureDbInitialized] DB initialization FAILED:', error.message);
    console.error('[ensureDbInitialized] Stack:', error.stack);
    throw error; // Re-throw so middleware can catch it
  }
}

const app = express();
const port = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// NOTE: DB initialization middleware moved further down so static assets can be
// served even when the database is unavailable. The actual middleware is
// inserted after the static file handler below.

// Security headers (Helmet) + CSP
// Note: Helmet disabled temporarily to allow HTTP connections without HTTPS upgrade
// Re-enable after SSL certificate is installed
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false,
  strictTransportSecurity: false,
  crossOriginOpenerPolicy: false,
  originAgentCluster: false,
}));

// Content Security Policy: strict by default, relaxed for /admin to support Quill editor if needed
// Note: Some third-party libraries used on public pages (e.g., animation/carousel plugins) may rely on eval-like constructs.
// To avoid persistent CSP console errors and broken behavior, we explicitly allow 'unsafe-eval' for public pages here.
// If you want to harden this later, consider removing/replacing those libraries and then removing 'unsafe-eval'.
const ALLOW_PUBLIC_EVAL = true; // force-enable eval on public to resolve reported CSP error
const cspDefault = helmet.contentSecurityPolicy({
  useDefaults: true,
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: [
      "'self'",
      "'unsafe-inline'", // inline snippets in templates; consider nonces later
      'https://code.jquery.com',
      'https://cdn.jsdelivr.net',
      'https://cdn.tiny.cloud',
      'https://www.google.com/recaptcha/',
      'https://www.gstatic.com/recaptcha/',
      "'unsafe-eval'" // allow eval on public pages to prevent library breakage
    ],
    // No 'unsafe-eval' here to keep public pages stricter
    styleSrc: [
      "'self'",
      "'unsafe-inline'",
      'https://fonts.googleapis.com',
      'https://cdnjs.cloudflare.com',
      'https://cdn.jsdelivr.net',
      'https://cdn.tiny.cloud'
    ],
    fontSrc: [
      "'self'",
      'https://fonts.gstatic.com',
      'https://cdnjs.cloudflare.com',
      'https://cdn.jsdelivr.net',
      'https://cdn.tiny.cloud',
      'data:'
    ],
    imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
  connectSrc: ["'self'", 'https://cdn.tiny.cloud', 'https://cdn.jsdelivr.net'],
    frameSrc: ["'self'", 'https://www.google.com', 'https://maps.google.com'],
    workerSrc: ["'self'", 'blob:'],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    upgradeInsecureRequests: []
  }
});

const cspAdmin = helmet.contentSecurityPolicy({
  useDefaults: true,
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: [
      "'self'",
      "'unsafe-inline'",
      "'unsafe-eval'", // allow eval for Quill editor-only context
      'https://code.jquery.com',
      'https://cdn.jsdelivr.net',
      'https://cdn.tiny.cloud',
      'https://assets.tiny.cloud',
      'https://www.google.com/recaptcha/',
      'https://www.gstatic.com/recaptcha/',
      'blob:'
    ],
    styleSrc: [
      "'self'",
      "'unsafe-inline'",
      'https://fonts.googleapis.com',
      'https://cdnjs.cloudflare.com',
      'https://cdn.jsdelivr.net',
      'https://cdn.tiny.cloud',
      'https://assets.tiny.cloud'
    ],
    fontSrc: [
      "'self'",
      'https://fonts.gstatic.com',
      'https://cdnjs.cloudflare.com',
      'https://cdn.jsdelivr.net',
      'https://cdn.tiny.cloud',
      'https://assets.tiny.cloud',
      'data:'
    ],
    imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'https://assets.tiny.cloud'],
  connectSrc: ["'self'", 'https://cdn.tiny.cloud', 'https://assets.tiny.cloud', 'https://cdn.jsdelivr.net'],
  frameSrc: ["'self'", 'blob:', 'data:', 'https://www.google.com', 'https://maps.google.com', 'https://www.google.com/recaptcha/'],
    workerSrc: ["'self'", 'blob:'],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    upgradeInsecureRequests: []
  }
});

app.use((req, res, next) => {
  if (req.path && req.path.startsWith('/admin')) {
    return cspAdmin(req, res, next);
  }
  return cspDefault(req, res, next);
});

// Handle public Documents page early to avoid any static path conflicts

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Lazy DB init middleware (runs once on first request in serverless/traditional)
app.use(async (req, res, next) => {
  try {
    await ensureDbInitialized();
    next();
  } catch (err) {
    console.error('[Middleware] DB initialization failed:', err.message);
    console.error('[Middleware] Full error:', err);
    
    // Send detailed error to user (helpful for debugging) but allow static
    // requests to have already been served above.
    const errorDetails = {
      error: 'Database initialization failed',
      message: err.message,
      hasDatabaseUrl: !!process.env.DATABASE_URL,
      suggestion: !process.env.DATABASE_URL
        ? 'DATABASE_URL environment variable is not set. Please configure it in your environment.'
        : 'Check if DATABASE_URL is correct and database is accessible.'
    };
    
    res.status(500).json(errorDetails);
  }
});

// Legacy route alias: /focus -> /focus-areas
app.get('/focus', (req, res) => {
  return res.redirect(`/focus-areas?lang=${req.query.lang || 'en'}`);
});

// Friendly alias: /gdpr -> /page/gdpr
app.get('/gdpr', (req, res) => {
  return res.redirect(`/page/gdpr?lang=${req.query.lang || 'en'}`);
});

// (removed) Early fallback for /focus-areas when DB is not connected

// File uploads (images)
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if(!fsSync.existsSync(uploadsDir)){
  try {
    fsSync.mkdirSync(uploadsDir, { recursive: true });
  } catch (e) {
    if (isServerless) {
      console.warn('[Serverless] Cannot create uploads dir (read-only filesystem). File uploads will fail unless using cloud storage.');
    } else {
      throw e;
    }
  }
}

// Multer: use memory storage (files as buffers) instead of disk
// We'll handle actual storage (Blob or disk) manually via uploadFile()
const storage = multer.memoryStorage();

// Non-fatal image-only filter for galleries: skip non-image files silently
const imageFilter = (req, file, cb) => {
  if(/^image\//.test(file.mimetype)) return cb(null, true);
  // Skip non-image files without throwing — prevents MulterError on unexpected fields
  return cb(null, false);
};
// Permissive filter for documents feature (allow common office types and images)
const docFileFilter = (req, file, cb) => {
  const ok = /^image\//.test(file.mimetype)
    || file.mimetype === 'application/pdf'
    || file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    || file.mimetype === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    || file.mimetype === 'text/plain';
  if(ok) return cb(null, true);
  return cb(new Error('Unsupported file type'));
};
const uploadImages = multer({ storage, fileFilter: imageFilter });
const uploadFiles = multer({ storage, fileFilter: docFileFilter });

// Helper: Generate safe filename
function generateFilename(originalname, prefix = '') {
  const ext = path.extname(originalname).toLowerCase();
  const base = path.basename(originalname, ext).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const stamp = Date.now();
  return prefix ? `${prefix}/${base}-${stamp}${ext}` : `${base}-${stamp}${ext}`;
}

// Optimize and resize image buffer, returns optimized buffer
async function optimizeImageBuffer(buffer, maxWidth = 1600, maxHeight = 1200, quality = 80) {
  try {
    const metadata = await sharp(buffer).metadata();
    const ext = metadata.format;
    
    if (!['jpeg', 'jpg', 'png', 'webp', 'avif'].includes(ext)) {
      return buffer; // No optimization for unsupported formats
    }
    
    let pipeline = sharp(buffer)
      .rotate() // honor EXIF orientation
      .resize({ width: maxWidth, height: maxHeight, fit: 'inside', withoutEnlargement: true });
    
    if (ext === 'jpeg' || ext === 'jpg') {
      pipeline = pipeline.jpeg({ quality, mozjpeg: true });
    } else if (ext === 'png') {
      pipeline = pipeline.png({ compressionLevel: 8, adaptiveFiltering: true });
    } else if (ext === 'webp') {
      pipeline = pipeline.webp({ quality });
    } else if (ext === 'avif') {
      pipeline = pipeline.avif({ quality: 50 });
    }
    
    return await pipeline.toBuffer();
  } catch (e) {
    console.warn('[optimizeImageBuffer] Failed, using original:', e?.message);
    return buffer;
  }
}

// Team-specific upload handling: save under /public/uploads/team and process images with sharp (600x600 + thumbnail)
const teamUploadsDir = path.join(uploadsDir, 'team');
if(!fsSync.existsSync(teamUploadsDir)){
  try {
    fsSync.mkdirSync(teamUploadsDir, { recursive: true });
  } catch (e) {
    if (isServerless) {
      console.warn('[Serverless] Cannot create team uploads dir (read-only filesystem).');
    } else {
      throw e;
    }
  }
}
function safeSlugFilename(title, ext){
  const base = slugify(title || 'member') || 'member';
  const stamp = Date.now();
  return `${base}-${stamp}${ext}`;
}
const uploadTeam = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    // Only images
    if(!/^image\//.test(file.mimetype)){
      return cb(null, false);
    }
    cb(null, true);
  },
  limits: { fileSize: 2 * 1024 * 1024 } // 2 MB
});
async function processTeamImage(buffer, originalname){
  const ext = '.jpg';
  const baseName = safeSlugFilename(path.basename(originalname || 'member', path.extname(originalname || 'member')), ext);
  
  // Resize main photo (600x600)
  const mainBuffer = await sharp(buffer)
    .resize(600, 600, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 82 })
    .toBuffer();
  
  // Resize thumbnail (150x150)
  const thumbBuffer = await sharp(buffer)
    .resize(150, 150, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 80 })
    .toBuffer();
  
  // Upload to storage (Blob or disk)
  const photoUrl = await uploadFile(mainBuffer, `team/${baseName}`, 'image/jpeg');
  const thumbUrl = await uploadFile(thumbBuffer, `team/${baseName.replace(ext, `-thumb${ext}`)}`, 'image/jpeg');
  
  return {
    photo_url: photoUrl,
    thumb_url: thumbUrl
  };
}

// Multer error handler for team routes (e.g., file too large)
app.use((err, req, res, next) => {
  if(err && err.code === 'LIMIT_FILE_SIZE' && req.method === 'POST' && /^\/admin\/team(\/[0-9]+)?$/.test(req.path)){
    const lang = (res && res.locals && res.locals.lang) ? res.locals.lang : (req.query.lang || 'en');
    if(/\/admin\/team\/[0-9]+$/.test(req.path)){
      const id = req.path.split('/').pop();
      db.getTeamMember(id).then(member => {
  res.status(400).render('admin-team-form', { lang, member, error: 'File size exceeds the 2 MB limit.' });
      }).catch(() => {
  res.status(400).render('admin-team-form', { lang, member: null, error: 'File size exceeds the 2 MB limit.' });
      });
    } else {
  res.status(400).render('admin-team-form', { lang, member: null, error: 'File size exceeds the 2 MB limit.' });
    }
    return;
  }
  return next(err);
});

// Log whether admin auth is enabled
const adminAuthEnabled = Boolean(process.env.ADMIN_USER && process.env.ADMIN_PASS);
console.log(`Admin auth ${adminAuthEnabled ? 'ENABLED' : 'DISABLED'}`);

// content.json fallback removed – DB is required

// Middleware to determine language (query param or cookie could be used)
app.use((req,res,next)=>{
  const supported = ['en','sk','hu'];
  let lang = req.query.lang;
  if(!supported.includes(lang)) lang = 'en';
  res.locals.lang = lang;
  next();
});

// Expose current request path to templates for active menu highlighting
app.use((req, res, next) => {
  try { res.locals.currentPath = req.path || '/'; } catch {} 
  next();
});

// Centralized i18n helper available in all views as t(key)
const TRANSLATIONS = {
  en: {
    // Nav
    home: 'Home', themes: 'Themes', focusAreas: 'Focus Areas', events: 'Events', team: 'Our Team', partners: 'Partners', news: 'News', documents: 'Documents',
    // Common UI
    menu: 'Menu', callUs: 'Call Us', mailUs: 'Mail Us', address: 'Address', learnMore: 'Learn More', viewEvents: 'View Events',
    quickLinks: 'Quick Links', languages: 'Languages', newsletter: 'Newsletter', stayUpdated: 'Stay updated with our latest events and programs.',
    yourEmail: 'Your email', subscribe: 'Subscribe', copied: 'Copied', allRightsReserved: 'All Rights Reserved.',
    // Documents
    download: 'Download', noDocumentsYet: 'No documents yet.',
    // Events
    viewDetails: 'View Details', noEventsYet: 'No events yet.', eventsKicker: 'OUR EVENTS', eventsHeading: 'Explore Our Latest Events', eventsTitle: 'Events',
    // Contact
    ourAddress: 'Our Address', emailLabel: 'Email', getInTouch: 'Get in touch', nameLabel: 'Name', subjectLabel: 'Subject', messageLabel: 'Message', sendMessage: 'Send Message',
    contactSuccess: 'Your message has been sent. Thank you!',
  // Theme detail
    aboutThisTheme: 'About This Theme', noDescriptionAvailable: 'No description available.', gallery: 'Gallery', themeInformation: 'Theme Information',
    slug: 'Slug', created: 'Created', backToThemes: 'Back to Themes', relatedThemes: 'Related Themes', galleryImageLabel: 'Gallery Image', noAdditionalImages: 'No additional images available for this theme.',
    // GDPR
    privacyPolicy: 'Privacy Policy',
    // News
    readMore: 'Read More', noNewsYet: 'No news articles yet.', newsKicker: 'NEWS', newsHeading: 'Latest News and Updates', newsTitle: 'News',
  // Themes listing/detail
    noThemesYet: 'No themes yet.', themesKicker: 'OUR THEMES', themesHeading: 'Discover Our Focus Themes', themesTitle: 'Themes',
  themeKicker: 'THEME',
    // Focus Areas
    focusAreasKicker: 'FOCUS AREAS', focusAreasHeading: 'Our Key Focus Areas', focusAreasTitle: 'Focus Areas',
    fa_group: 'Group', fa_field: 'Field', fa_experts: 'Expert(s)', fa_description: 'Description', fa_activity_description: 'Activity - description', fa_type_of_activity: 'Type of activity',
  // Share/copy
  share: 'Share:', copy: 'Copy', backToList: 'Back to list',
    // Not found
    themeNotFound: 'Theme Not Found', eventNotFound: 'Event Not Found', newsNotFound: 'News Not Found', teamNotFound: 'Team Member Not Found',
    // Team
    teamKicker: 'OUR TEAM', teamHeading: 'Meet Our Dedicated Team Members', noTeamYet: 'No team members yet.',
    // Partners
    ourPartners: 'Our Partners', partnersTitle: 'Organizations We Work With',
    // Admin Panel
    adminPanel: 'Admin Panel', dashboard: 'Dashboard', managePartners: 'Manage Partners', addNewPartner: 'Add New Partner', 
    editPartner: 'Edit Partner', partnerName: 'Partner Name', partnerLogo: 'Partner Logo', sortOrder: 'Sort Order',
    save: 'Save', update: 'Update', cancel: 'Cancel', delete: 'Delete', edit: 'Edit', actions: 'Actions',
    noPartnersYet: 'No partners yet.', partnerCreated: 'Partner created successfully!', partnerUpdated: 'Partner updated successfully!',
    partnerDeleted: 'Partner deleted successfully!', deleteConfirm: 'Delete this partner?', noLogo: 'No logo',
    optional: 'Optional', required: 'Required', currentLogo: 'Current Logo', removeLogo: 'Remove current logo',
    defaultPlaceholder: 'will use default placeholder', imageInfo: 'PNG, JPG, or SVG recommended. Max 2MB. Image will be resized to 300x300px.',
    noLogoProvided: 'If not provided, a default placeholder will be used.',
    // Admin Menu Items
    contentManagement: 'Content Management', pages: 'Pages', ourTeam: 'Our Team', settings: 'Settings',
    slider: 'Slider', stats: 'Stats', multiLanguageContent: 'Multi-Language Content', viewSite: 'View Site',
    logout: 'Logout', logoutConfirm: 'Are you sure you want to logout?', lowerNumbersFirst: 'Lower numbers appear first.',
    // Admin Common
    newItem: 'New', editItem: 'Edit', created_successfully: 'has been created successfully.',
    updated_successfully: 'has been updated successfully.', deleted_successfully: 'has been deleted.',
    // Admin Events
    eventsManagement: 'Events Management', newEvent: 'New Event', editEvent: 'Edit Event',
    event: 'Event', date: 'Date', location: 'Location', eventImage: 'Event Image',
    eventDeleted: 'Event has been deleted.', eventCreated: 'Event has been created successfully.',
    eventUpdated: 'Event has been updated successfully.', deleteThisEvent: 'Delete this event?',
    noEventsYet_admin: 'No events yet.', createFirstEvent: 'Create First Event',
    startCreatingEvent: 'Start by creating your first event.',
    eventDate: 'Event Date', eventLocation: 'Event Location', additionalImages: 'Additional Images',
    uploadMultipleImages: 'Upload multiple images that will be displayed in the event gallery on detail pages.',
    chooseImages: 'Choose images...', published: 'Published', status: 'Status', active: 'Active', inactive: 'Inactive',
    // Admin Team
    teamManagement: 'Team Management', newMember: 'New Member', editMember: 'Edit Member',
    member: 'Member', bio: 'Bio', order: 'Order', memberPhoto: 'Member Photo',
    memberDeleted: 'Member has been deleted.', memberCreated: 'Member has been created successfully.',
    memberUpdated: 'Member has been updated successfully.', deleteThisMember: 'Delete this member?',
    noTeamYet_admin: 'No Team Members Yet', createFirstMember: 'Create First Member',
    startCreatingMember: 'Start by creating your first team member.',
    // Admin News
    newsManagement: 'News Management', newsArticles: 'News Articles', newArticle: 'New Article',
    editArticle: 'Edit Article', article: 'Article', publishedDate: 'Published Date',
    articleDeleted: 'Article has been deleted.', articleCreated: 'Article has been created successfully.',
    articleUpdated: 'Article has been updated successfully.', deleteThisArticle: 'Delete this article?',
    noNewsYet_admin: 'No news articles yet.', summary: 'Summary',
    // Admin Themes
    themesManagement: 'Themes Management', newTheme: 'New Theme', editTheme: 'Edit Theme',
    theme: 'Theme', themeDeleted: 'Theme has been deleted.', themeCreated: 'Theme has been created successfully.',
    themeUpdated: 'Theme has been updated successfully.', deleteThisTheme: 'Delete this theme?',
    noThemesYet_admin: 'No themes yet.', createFirstTheme: 'Create First Theme',
    startCreatingTheme: 'Start by creating your first theme.',
    // Admin Documents
    documentsManagement: 'Documents Management', newDocument: 'New Document', editDocument: 'Edit Document',
    document: 'Document', file: 'File', documentDeleted: 'Document has been deleted.',
    documentCreated: 'Document has been created successfully.', documentUpdated: 'Document has been updated successfully.',
    deleteThisDocument: 'Delete this document?', editDocumentTitle: 'Edit Document',
    editingDocument: 'Editing Document', fileUpload: 'File', fileFormats: 'pdf, docx, xlsx, pptx, txt, image',
    // Admin Focus Areas
    focusAreasManagement: 'Focus Areas Management', newFocusArea: 'New Focus Area', editFocusArea: 'Edit Focus Area',
    focusArea: 'Focus Area', focusAreaDeleted: 'Focus Area has been deleted.',
    focusAreaCreated: 'Focus Area has been created successfully.', focusAreaUpdated: 'Focus Area has been updated successfully.',
    deleteThisFocusArea: 'Delete this focus area?',
    // Admin Settings
    settingsContact: 'Settings › Contact', settingsGDPR: 'Settings › GDPR', settingsSlider: 'Settings › Slider',
    settingsStats: 'Settings › Stats', saveSlider: 'Save Slider', sliderBackgroundImage: 'Slider Background Image',
    uploadBackgroundImages: 'Upload Background Images', titleColor: 'Title Color', captionColor: 'Caption Color',
    textAlignment: 'Text Alignment', left: 'Left', center: 'Center', right: 'Right',
    slides: 'Slides', addSlide: 'Add Slide', removeSlide: 'Remove Slide', slideLink: 'Slide Link',
    titleCaptionPerLanguage: 'Title/Caption are per language', linkShared: 'Link is shared; Title/Caption are per language',
    // Admin Messages
    messagesManagement: 'Messages Management', messages: 'Messages', from: 'From', subject: 'Subject',
    receivedAt: 'Received At', messageText: 'Message', noMessagesYet: 'No messages yet.',
    // Admin Pages
    pagesManagement: 'Pages Management', editPage: 'Edit Page', pageName: 'Page Name',
    pageContent: 'Page Content', saveChanges: 'Save Changes',
    // Common Form Fields
    title: 'Title', description: 'Description', image: 'Image', currentImage: 'Current Image',
    removeImage: 'Remove current image', uploadNewImage: 'Upload new image', imageRecommendation: 'PNG, JPG, or SVG recommended.',
    content: 'Content', link: 'Link', caption: 'Caption', name: 'Name', email: 'Email',
    position: 'Position', phone: 'Phone', facebook: 'Facebook', linkedin: 'LinkedIn', twitter: 'Twitter',
    // Dashboard
    welcomeAdmin: 'Welcome to Admin Panel', quickStats: 'Quick Statistics', recentActivity: 'Recent Activity',
    totalEvents: 'Total Events', totalThemes: 'Total Themes', totalMembers: 'Total Members', totalPartners: 'Total Partners',
    totalNews: 'Total News', totalDocuments: 'Total Documents', viewAll: 'View All', manage: 'Manage',
    // Form Labels
    slug: 'Slug', galleryImages: 'Gallery Images', uploadImages: 'Upload Images', chooseFiles: 'Choose files...',
    eventInformation: 'Event Information', themeInformation: 'Theme Information', memberInformation: 'Member Information',
    newsInformation: 'News Information', documentInformation: 'Document Information',
    currentPhoto: 'Current Photo', removePhoto: 'Remove current photo', socialMedia: 'Social Media',
    publishedAt: 'Published At', articleSummary: 'Article Summary', articleContent: 'Article Content',
    makePublished: 'Make Published', eventDetails: 'Event Details', additionalInformation: 'Additional Information',
    // Settings Forms
    contactInformation: 'Contact Information', addressLine1: 'Address Line 1', addressLine2: 'Address Line 2',
    city: 'City', zipCode: 'Zip Code', country: 'Country', phoneNumber: 'Phone Number', emailAddress: 'Email Address',
    facebookUrl: 'Facebook URL', linkedinUrl: 'LinkedIn URL', twitterUrl: 'Twitter URL',
    statsConfiguration: 'Stats Configuration', stat1Label: 'Stat 1 Label', stat1Value: 'Stat 1 Value',
    stat2Label: 'Stat 2 Label', stat2Value: 'Stat 2 Value', stat3Label: 'Stat 3 Label', stat3Value: 'Stat 3 Value',
    stat4Label: 'Stat 4 Label', stat4Value: 'Stat 4 Value', saveSettings: 'Save Settings',
    sliderConfiguration: 'Slider Configuration', backgroundImage: 'Background Image', selectImage: 'Select Image',
    textColor: 'Text Color', slideTitle: 'Slide Title', slideCaption: 'Slide Caption', buttonText: 'Button Text',
    buttonUrl: 'Button URL', addNewSlide: 'Add New Slide', deleteSlide: 'Delete Slide',
    // Validation & Hints
    requiredField: 'Required field', optionalField: 'Optional field', maxFileSize: 'Maximum file size',
    recommendedSize: 'Recommended size', multipleFilesAllowed: 'Multiple files allowed',
    urlFormat: 'URL format', dateFormat: 'Date format', wysiwygEditor: 'Rich text editor',
    characterLimit: 'Character limit', fillAllLanguages: 'Fill in all languages',
    // Misc
    preview: 'Preview', backToList: 'Back to List', viewOnSite: 'View on Site', lastUpdated: 'Last Updated',
    createdAt: 'Created At', updatedAt: 'Updated At', noDataAvailable: 'No data available',
    // Additional form keys
    role: 'Role', sortOrder: 'Sort Order', sortOrderHelp: 'Lower numbers appear first', coverImage: 'Cover Image',
    setAsCover: 'Set as cover', addCoverImage: 'Add Cover Image', coverImageHelp: 'If provided, this will be used as the main image and appear first in the gallery',
    coverImageEditHelp: 'If provided, this image will be set as the cover; you can also select any existing image above as cover',
    publishingOptions: 'Publishing Options', publishedAtHelp: 'Leave empty to use current date/time', summaryPlaceholder: 'Brief summary for article cards',
    visibleOnSite: 'Visible on site', fileTypesAllowed: 'pdf, docx, xlsx, pptx, txt, image', currentFile: 'Current file', download: 'Download',
    language: 'Language', sliderManageInfo: 'Manage slides dynamically. You can add or remove slides as needed.',
    currentSet: 'Currently set', uploadBackgroundImages: 'Upload Background Images', selectedBackground: 'Selected Background',
    noBackgroundSet: 'No background set', removeSelected: 'Remove Selected', use: 'Use', view: 'View',
    textSettings: 'Text Settings', alignment: 'Alignment', slide: 'Slide', slideMultilingualInfo: 'Title/Caption are per language',
    newNews: 'New Article', editNews: 'Edit Article',
    instagram: 'Instagram', youtube: 'YouTube', stat: 'Stat', moveUp: 'Move up', moveDown: 'Move down',
    value: 'Value', icon: 'Icon', fontAwesome: 'Font Awesome', iconPlaceholder: 'e.g., fa-trophy',
    suffix: 'Suffix', suffixPlaceholder: 'e.g., +, %', yes: 'Yes', no: 'No', label: 'Label',
    addNewStat: 'Add Stat', statsManageInfo: 'Define up to 6 counters. Numbers are shared globally; labels are per language. You can reorder with the arrows.',
    // Dashboard tiles
    quickAccess: 'Quick access', openDashboard: 'Open Dashboard', manageTopics: 'Manage topics', manageThemes: 'Manage Themes',
    createEditEvents: 'Create & edit events', manageEvents: 'Manage Events', manageMembers: 'Manage members', manageTeam: 'Manage Team',
    publishPosts: 'Publish posts', uploadFiles: 'Upload files', manageData: 'Manage data', manageFocusAreas: 'Manage Focus Areas',
    heroSlides: 'Hero & slides', sliderSettings: 'Slider Settings', contactDetails: 'Contact details', contactSettings: 'Contact Settings',
    privacyNotice: 'Privacy notice', gdprSettings: 'GDPR Settings', statsCounters: 'Stats / Counters', homepageCounters: 'Homepage counters',
    statsSettings: 'Stats Settings', pageHome: 'Page: Home', editContent: 'Edit content', editHomePage: 'Edit Home Page',
    pageAboutUs: 'Page: About Us', editAboutUsPage: 'Edit About Us Page', openWebsite: 'Open website', openSite: 'Open Site',
    adminInterface: 'Admin interface', supportedLanguages: 'Supported languages',
    // User Guide
    userGuide: 'User Guide', adminPanelUserGuide: 'Admin Panel User Guide'
  },
  sk: {
    home: 'Home', themes: 'Themes', focusAreas: 'Focus Areas', events: 'Events', team: 'Our Team', partners: 'Partners', news: 'News', documents: 'Documents', about: 'About Us', contact: 'Contact', gdpr: 'GDPR',
    menu: 'Menu', callUs: 'Zavolajte nám', mailUs: 'Napíšte nám', address: 'Adresa', learnMore: 'Zistiť viac', viewEvents: 'Zobraziť podujatia',
    home: 'Domov', themes: 'Témy', focusAreas: 'Zamerania', events: 'Podujatia', team: 'Náš tím', partners: 'Partneri', news: 'Novinky', documents: 'Dokumenty', about: 'O nás', contact: 'Kontakt', gdpr: 'GDPR',
    yourEmail: 'Váš email', subscribe: 'Prihlásiť sa', copied: 'Skopírované', allRightsReserved: 'Všetky práva vyhradené.',
    home: 'Főoldal', themes: 'Témák', focusAreas: 'Fókuszterületek', events: 'Események', team: 'Csapatunk', partners: 'Partners', news: 'Hírek', documents: 'Dokumentumok', about: 'Rólunk', contact: 'Kapcsolat', gdpr: 'GDPR',
    viewDetails: 'Zobraziť podrobnosti', noEventsYet: 'Zatiaľ žiadne podujatia.', eventsKicker: 'NAŠE PODUJATIA', eventsHeading: 'Preskúmajte naše najnovšie podujatia', eventsTitle: 'Podujatia',
    ourAddress: 'Naša adresa', emailLabel: 'Email', getInTouch: 'Kontaktujte nás', nameLabel: 'Meno', subjectLabel: 'Predmet', messageLabel: 'Správa', sendMessage: 'Odoslať správu',
    contactSuccess: 'Vaša správa bola odoslaná. Ďakujeme!',
    aboutThisTheme: 'O tejto téme', noDescriptionAvailable: 'Popis nie je k dispozícii.', gallery: 'Galéria', themeInformation: 'Informácie o téme',
    slug: 'Slug', created: 'Vytvorené', backToThemes: 'Späť na Témy', relatedThemes: 'Súvisiace témy', galleryImageLabel: 'Obrázok v galérii', noAdditionalImages: 'Pre túto tému nie sú k dispozícii žiadne ďalšie obrázky.',
    privacyPolicy: 'Ochrana osobných údajov',
    readMore: 'Čítať viac', noNewsYet: 'Zatiaľ žiadne novinky.', newsKicker: 'NOVINKY', newsHeading: 'Najnovšie správy a aktualizácie', newsTitle: 'Novinky',
  noThemesYet: 'Zatiaľ žiadne témy.', themesKicker: 'NAŠE TÉMY', themesHeading: 'Objavte naše zamerania', themesTitle: 'Témy',
  themeKicker: 'TÉMA',
    focusAreasKicker: 'ZAMERANIA', focusAreasHeading: 'Naše kľúčové zamerania', focusAreasTitle: 'Zamerania',
    fa_group: 'Skupina', fa_field: 'Oblasť', fa_experts: 'Odborník(ovia)', fa_description: 'Popis', fa_activity_description: 'Aktivita - popis', fa_type_of_activity: 'Typ aktivity',
  share: 'Zdieľať:', copy: 'Kopírovať', backToList: 'Späť na zoznam',
    themeNotFound: 'Téma sa nenašla', eventNotFound: 'Podujatie sa nenašlo', newsNotFound: 'Novinka sa nenašla', teamNotFound: 'Člen tímu sa nenašiel',
    teamKicker: 'NÁŠ TÍM', teamHeading: 'Zoznámte sa s našimi členmi tímu', noTeamYet: 'Zatiaľ žiadni členovia tímu.',
    ourPartners: 'Naši partneri', partnersTitle: 'Organizácie, s ktorými spolupracujeme',
    // Admin Panel
    adminPanel: 'Admin Panel', dashboard: 'Prehľad', managePartners: 'Spravovať partnerov', addNewPartner: 'Pridať nového partnera',
    editPartner: 'Upraviť partnera', partnerName: 'Názov partnera', partnerLogo: 'Logo partnera', sortOrder: 'Poradie',
    save: 'Uložiť', update: 'Aktualizovať', cancel: 'Zrušiť', delete: 'Vymazať', edit: 'Upraviť', actions: 'Akcie',
    noPartnersYet: 'Zatiaľ žiadni partneri.', partnerCreated: 'Partner bol úspešne vytvorený!', partnerUpdated: 'Partner bol úspešne aktualizovaný!',
    partnerDeleted: 'Partner bol úspešne vymazaný!', deleteConfirm: 'Vymazať tohto partnera?', noLogo: 'Bez loga',
    optional: 'Voliteľné', required: 'Povinné', currentLogo: 'Aktuálne logo', removeLogo: 'Odstrániť aktuálne logo',
    defaultPlaceholder: 'použije sa predvolený zástupný obrázok', imageInfo: 'Odporúčané PNG, JPG alebo SVG. Max 2MB. Obrázok bude zmenšený na 300x300px.',
    noLogoProvided: 'Ak nie je k dispozícii, použije sa predvolený zástupný obrázok.',
    // Admin Menu Items
    contentManagement: 'Správa obsahu', pages: 'Stránky', ourTeam: 'Náš tím', settings: 'Nastavenia',
    slider: 'Posúvač', stats: 'Štatistiky', multiLanguageContent: 'Viacjazyčný obsah', viewSite: 'Zobraziť stránku',
    logout: 'Odhlásiť sa', logoutConfirm: 'Naozaj sa chcete odhlásiť?', lowerNumbersFirst: 'Nižšie čísla sa zobrazia ako prvé.',
    // Admin Common
    newItem: 'Nový', editItem: 'Upraviť', created_successfully: 'bol úspešne vytvorený.',
    updated_successfully: 'bol úspešne aktualizovaný.', deleted_successfully: 'bol vymazaný.',
    // Admin Events
    eventsManagement: 'Správa podujatí', newEvent: 'Nové podujatie', editEvent: 'Upraviť podujatie',
    event: 'Podujatie', date: 'Dátum', location: 'Miesto', eventImage: 'Obrázok podujatia',
    eventDeleted: 'Podujatie bolo vymazané.', eventCreated: 'Podujatie bolo úspešne vytvorené.',
    eventUpdated: 'Podujatie bolo úspešne aktualizované.', deleteThisEvent: 'Vymazať toto podujatie?',
    noEventsYet_admin: 'Zatiaľ žiadne podujatia.', createFirstEvent: 'Vytvoriť prvé podujatie',
    startCreatingEvent: 'Začnite vytvorením prvého podujatia.',
    eventDate: 'Dátum podujatia', eventLocation: 'Miesto podujatia', additionalImages: 'Ďalšie obrázky',
    uploadMultipleImages: 'Nahrajte viacero obrázkov, ktoré sa zobrazia v galérii podujatia na stránkach s detailmi.',
    chooseImages: 'Vybrať obrázky...', published: 'Zverejnené', status: 'Stav', active: 'Aktívny', inactive: 'Neaktívny',
    // Admin Team
    teamManagement: 'Správa tímu', newMember: 'Nový člen', editMember: 'Upraviť člena',
    member: 'Člen', bio: 'Životopis', order: 'Poradie', memberPhoto: 'Fotografia člena',
    memberDeleted: 'Člen bol vymazaný.', memberCreated: 'Člen bol úspešne vytvorený.',
    memberUpdated: 'Člen bol úspešne aktualizovaný.', deleteThisMember: 'Vymazať tohto člena?',
    noTeamYet_admin: 'Zatiaľ žiadni členovia tímu', createFirstMember: 'Vytvoriť prvého člena',
    startCreatingMember: 'Začnite vytvorením prvého člena tímu.',
    // Admin News
    newsManagement: 'Správa noviniek', newsArticles: 'Články noviniek', newArticle: 'Nový článok',
    editArticle: 'Upraviť článok', article: 'Článok', publishedDate: 'Dátum zverejnenia',
    articleDeleted: 'Článok bol vymazaný.', articleCreated: 'Článok bol úspešne vytvorený.',
    articleUpdated: 'Článok bol úspešne aktualizovaný.', deleteThisArticle: 'Vymazať tento článok?',
    noNewsYet_admin: 'Zatiaľ žiadne články.', summary: 'Zhrnutie',
    // Admin Themes
    themesManagement: 'Správa tém', newTheme: 'Nová téma', editTheme: 'Upraviť tému',
    theme: 'Téma', themeDeleted: 'Téma bola vymazaná.', themeCreated: 'Téma bola úspešne vytvorená.',
    themeUpdated: 'Téma bola úspešne aktualizovaná.', deleteThisTheme: 'Vymazať túto tému?',
    noThemesYet_admin: 'Zatiaľ žiadne témy.', createFirstTheme: 'Vytvoriť prvú tému',
    startCreatingTheme: 'Začnite vytvorením prvej témy.',
    // Admin Documents
    documentsManagement: 'Správa dokumentov', newDocument: 'Nový dokument', editDocument: 'Upraviť dokument',
    document: 'Dokument', file: 'Súbor', documentDeleted: 'Dokument bol vymazaný.',
    documentCreated: 'Dokument bol úspešne vytvorený.', documentUpdated: 'Dokument bol úspešne aktualizovaný.',
    deleteThisDocument: 'Vymazať tento dokument?', editDocumentTitle: 'Upraviť dokument',
    editingDocument: 'Úprava dokumentu', fileUpload: 'Súbor', fileFormats: 'pdf, docx, xlsx, pptx, txt, obrázok',
    // Admin Focus Areas
    focusAreasManagement: 'Správa zameraní', newFocusArea: 'Nové zameranie', editFocusArea: 'Upraviť zameranie',
    focusArea: 'Zameranie', focusAreaDeleted: 'Zameranie bolo vymazané.',
    focusAreaCreated: 'Zameranie bolo úspešne vytvorené.', focusAreaUpdated: 'Zameranie bolo úspešne aktualizované.',
    deleteThisFocusArea: 'Vymazať toto zameranie?',
    // Admin Settings
    settingsContact: 'Nastavenia › Kontakt', settingsGDPR: 'Nastavenia › GDPR', settingsSlider: 'Nastavenia › Posúvač',
    settingsStats: 'Nastavenia › Štatistiky', saveSlider: 'Uložiť posúvač', sliderBackgroundImage: 'Obrázok pozadia posúvača',
    uploadBackgroundImages: 'Nahrať obrázky pozadia', titleColor: 'Farba nadpisu', captionColor: 'Farba titulku',
    textAlignment: 'Zarovnanie textu', left: 'Vľavo', center: 'Stred', right: 'Vpravo',
    slides: 'Snímky', addSlide: 'Pridať snímku', removeSlide: 'Odstrániť snímku', slideLink: 'Odkaz snímky',
    titleCaptionPerLanguage: 'Nadpis/titulok sú pre každý jazyk', linkShared: 'Odkaz je zdieľaný; Nadpis/titulok sú pre každý jazyk',
    // Admin Messages
    messagesManagement: 'Správa správ', messages: 'Správy', from: 'Od', subject: 'Predmet',
    receivedAt: 'Prijaté', messageText: 'Správa', noMessagesYet: 'Zatiaľ žiadne správy.',
    // Admin Pages
    pagesManagement: 'Správa stránok', editPage: 'Upraviť stránku', pageName: 'Názov stránky',
    pageContent: 'Obsah stránky', saveChanges: 'Uložiť zmeny',
    // Common Form Fields
    title: 'Nadpis', description: 'Popis', image: 'Obrázok', currentImage: 'Aktuálny obrázok',
    removeImage: 'Odstrániť aktuálny obrázok', uploadNewImage: 'Nahrať nový obrázok', imageRecommendation: 'Odporúčané PNG, JPG alebo SVG.',
    content: 'Obsah', link: 'Odkaz', caption: 'Titulok', name: 'Meno', email: 'Email',
    position: 'Pozícia', phone: 'Telefón', facebook: 'Facebook', linkedin: 'LinkedIn', twitter: 'Twitter',
    // Dashboard
    welcomeAdmin: 'Vitajte v Admin Paneli', quickStats: 'Rýchle štatistiky', recentActivity: 'Nedávna aktivita',
    totalEvents: 'Celkový počet podujatí', totalThemes: 'Celkový počet tém', totalMembers: 'Celkový počet členov', totalPartners: 'Celkový počet partnerov',
    totalNews: 'Celkový počet noviniek', totalDocuments: 'Celkový počet dokumentov', viewAll: 'Zobraziť všetko', manage: 'Spravovať',
    // Form Labels
    slug: 'Slug', galleryImages: 'Galéria obrázkov', uploadImages: 'Nahrať obrázky', chooseFiles: 'Vybrať súbory...',
    eventInformation: 'Informácie o podujatí', themeInformation: 'Informácie o téme', memberInformation: 'Informácie o členovi',
    newsInformation: 'Informácie o novinke', documentInformation: 'Informácie o dokumente',
    currentPhoto: 'Aktuálna fotografia', removePhoto: 'Odstrániť aktuálnu fotografiu', socialMedia: 'Sociálne siete',
    publishedAt: 'Zverejnené', articleSummary: 'Zhrnutie článku', articleContent: 'Obsah článku',
    makePublished: 'Zverejniť', eventDetails: 'Podrobnosti podujatia', additionalInformation: 'Dodatočné informácie',
    // Settings Forms
    contactInformation: 'Kontaktné informácie', addressLine1: 'Adresa riadok 1', addressLine2: 'Adresa riadok 2',
    city: 'Mesto', zipCode: 'PSČ', country: 'Krajina', phoneNumber: 'Telefónne číslo', emailAddress: 'Emailová adresa',
    facebookUrl: 'Facebook URL', linkedinUrl: 'LinkedIn URL', twitterUrl: 'Twitter URL',
    statsConfiguration: 'Konfigurácia štatistík', stat1Label: 'Štítok štatistiky 1', stat1Value: 'Hodnota štatistiky 1',
    stat2Label: 'Štítok štatistiky 2', stat2Value: 'Hodnota štatistiky 2', stat3Label: 'Štítok štatistiky 3', stat3Value: 'Hodnota štatistiky 3',
    stat4Label: 'Štítok štatistiky 4', stat4Value: 'Hodnota štatistiky 4', saveSettings: 'Uložiť nastavenia',
    sliderConfiguration: 'Konfigurácia posúvača', backgroundImage: 'Obrázok pozadia', selectImage: 'Vybrať obrázok',
    textColor: 'Farba textu', slideTitle: 'Nadpis snímky', slideCaption: 'Titulok snímky', buttonText: 'Text tlačidla',
    buttonUrl: 'URL tlačidla', addNewSlide: 'Pridať novú snímku', deleteSlide: 'Vymazať snímku',
    // Validation & Hints
    requiredField: 'Povinné pole', optionalField: 'Voliteľné pole', maxFileSize: 'Maximálna veľkosť súboru',
    recommendedSize: 'Odporúčaná veľkosť', multipleFilesAllowed: 'Povolené viacero súborov',
    urlFormat: 'Formát URL', dateFormat: 'Formát dátumu', wysiwygEditor: 'Editor formátovaného textu',
    characterLimit: 'Limit znakov', fillAllLanguages: 'Vyplňte všetky jazyky',
    // Misc
    preview: 'Náhľad', backToList: 'Späť na zoznam', viewOnSite: 'Zobraziť na stránke', lastUpdated: 'Naposledy aktualizované',
    createdAt: 'Vytvorené', updatedAt: 'Aktualizované', noDataAvailable: 'Žiadne dostupné údaje',
    // Additional form keys
    role: 'Funkcia', sortOrder: 'Poradie', sortOrderHelp: 'Nižšie čísla sa zobrazia ako prvé', coverImage: 'Hlavný obrázok',
    setAsCover: 'Nastaviť ako hlavný', addCoverImage: 'Pridať hlavný obrázok', coverImageHelp: 'Ak je uvedený, použije sa ako hlavný obrázok a zobrazí sa ako prvý v galérii',
    coverImageEditHelp: 'Ak je uvedený, tento obrázok bude nastavený ako hlavný; môžete tiež vybrať akýkoľvek existujúci obrázok vyššie ako hlavný',
    publishingOptions: 'Možnosti zverejnenia', publishedAtHelp: 'Nechajte prázdne pre použitie aktuálneho dátumu/času', summaryPlaceholder: 'Stručné zhrnutie pre karty článkov',
    visibleOnSite: 'Viditeľné na stránke', fileTypesAllowed: 'pdf, docx, xlsx, pptx, txt, obrázok', currentFile: 'Aktuálny súbor', download: 'Stiahnuť',
    language: 'Jazyk', sliderManageInfo: 'Dynamicky spravujte snímky. Môžete pridávať alebo odstraňovať snímky podľa potreby.',
    currentSet: 'Aktuálne nastavené', selectedBackground: 'Vybrané pozadie',
    noBackgroundSet: 'Žiadne pozadie nastavené', removeSelected: 'Odstrániť vybrané', use: 'Použiť', view: 'Zobraziť',
    textSettings: 'Nastavenia textu', alignment: 'Zarovnanie', slide: 'Snímka', slideMultilingualInfo: 'Nadpis/Titulok sú pre každý jazyk',
    newNews: 'Nový článok', editNews: 'Upraviť článok',
    instagram: 'Instagram', youtube: 'YouTube', stat: 'Štatistika', moveUp: 'Posunúť hore', moveDown: 'Posunúť dole',
    value: 'Hodnota', icon: 'Ikona', fontAwesome: 'Font Awesome', iconPlaceholder: 'napr., fa-trophy',
    suffix: 'Prípona', suffixPlaceholder: 'napr., +, %', yes: 'Áno', no: 'Nie', label: 'Štítok',
    addNewStat: 'Pridať štatistiku', statsManageInfo: 'Definujte až 6 počítadiel. Čísla sú zdieľané globálne; štítky sú pre každý jazyk. Môžete zmeniť poradie pomocou šípok.',
    // Dashboard tiles
    quickAccess: 'Rýchly prístup', openDashboard: 'Otvoriť panel', manageTopics: 'Spravovať témy', manageThemes: 'Spravovať témy',
    createEditEvents: 'Vytvoriť a upraviť podujatia', manageEvents: 'Spravovať podujatia', manageMembers: 'Spravovať členov', manageTeam: 'Spravovať tím',
    publishPosts: 'Publikovať príspevky', uploadFiles: 'Nahrať súbory', manageData: 'Spravovať údaje', manageFocusAreas: 'Spravovať zamerania',
    heroSlides: 'Úvodné snímky', sliderSettings: 'Nastavenia posúvača', contactDetails: 'Kontaktné údaje', contactSettings: 'Nastavenia kontaktu',
    privacyNotice: 'Oznámenie o ochrane údajov', gdprSettings: 'Nastavenia GDPR', statsCounters: 'Štatistiky / Počítadlá', homepageCounters: 'Počítadlá domovskej stránky',
    statsSettings: 'Nastavenia štatistík', pageHome: 'Stránka: Domov', editContent: 'Upraviť obsah', editHomePage: 'Upraviť domovskú stránku',
    pageAboutUs: 'Stránka: O nás', editAboutUsPage: 'Upraviť stránku O nás', openWebsite: 'Otvoriť webovú stránku', openSite: 'Otvoriť stránku',
    adminInterface: 'Administrátorské rozhranie', supportedLanguages: 'Podporované jazyky',
    // User Guide
    userGuide: 'Používateľská príručka', adminPanelUserGuide: 'Používateľská príručka administrátorského panelu'
  },
  hu: {
    home: 'Főoldal', themes: 'Témák', focusAreas: 'Fókuszterületek', events: 'Események', team: 'Csapatunk', partners: 'Partnerek', news: 'Hírek', documents: 'Dokumentumok',
    menu: 'Menü', callUs: 'Hívjon minket', mailUs: 'Írjon nekünk', address: 'Cím', learnMore: 'Tudjon meg többet', viewEvents: 'Események megtekintése',
    quickLinks: 'Gyors linkek', languages: 'Nyelvek', newsletter: 'Hírlevél', stayUpdated: 'Értesüljön legújabb eseményeinkről és programjainkról.',
    yourEmail: 'Az Ön e-mail címe', subscribe: 'Feliratkozás', copied: 'Másolva', allRightsReserved: 'Minden jog fenntartva.',
    download: 'Letöltés', noDocumentsYet: 'Még nincsenek dokumentumok.',
    viewDetails: 'Részletek megtekintése', noEventsYet: 'Még nincsenek események.', eventsKicker: 'ESEMÉNYEINK', eventsHeading: 'Fedezze fel legújabb eseményeinket', eventsTitle: 'Események',
    ourAddress: 'Címünk', emailLabel: 'E-mail', getInTouch: 'Lépjen kapcsolatba velünk', nameLabel: 'Név', subjectLabel: 'Tárgy', messageLabel: 'Üzenet', sendMessage: 'Üzenet küldése',
    contactSuccess: 'Üzenetét elküldtük. Köszönjük!',
    aboutThisTheme: 'A témáról', noDescriptionAvailable: 'Leírás nem érhető el.', gallery: 'Galéria', themeInformation: 'Téma információk',
    slug: 'Slug', created: 'Létrehozva', backToThemes: 'Vissza a Témákhoz', relatedThemes: 'Kapcsolódó témák', galleryImageLabel: 'Galéria kép', noAdditionalImages: 'Ehhez a témához nem állnak rendelkezésre további képek.',
    privacyPolicy: 'Adatvédelmi tájékoztató',
    readMore: 'Tovább', noNewsYet: 'Még nincsenek hírek.', newsKicker: 'HÍREK', newsHeading: 'Legfrissebb hírek és frissítések', newsTitle: 'Hírek',
  noThemesYet: 'Még nincsenek témák.', themesKicker: 'TÉMÁINK', themesHeading: 'Fedezze fel fókuszterületeinket', themesTitle: 'Témák',
  themeKicker: 'TÉMA',
    focusAreasKicker: 'FÓKUSZTERÜLETEK', focusAreasHeading: 'Fő fókuszterületeink', focusAreasTitle: 'Fókuszterületek',
    fa_group: 'Csoport', fa_field: 'Terület', fa_experts: 'Szakértő(k)', fa_description: 'Leírás', fa_activity_description: 'Tevékenység - leírás', fa_type_of_activity: 'Tevékenység típusa',
  share: 'Megosztás:', copy: 'Másolás', backToList: 'Vissza a listához',
    themeNotFound: 'Téma nem található', eventNotFound: 'Esemény nem található', newsNotFound: 'Hír nem található', teamNotFound: 'Csapattag nem található',
    teamKicker: 'CSAPATUNK', teamHeading: 'Ismerje meg elkötelezett csapatunkat', noTeamYet: 'Még nincsenek csapattagok.',
    ourPartners: 'Partnereink', partnersTitle: 'Szervezetek, amelyekkel együttműködünk',
    // Admin Panel
    adminPanel: 'Admin Panel', dashboard: 'Műszerfal', managePartners: 'Partnerek kezelése', addNewPartner: 'Új partner hozzáadása',
    editPartner: 'Partner szerkesztése', partnerName: 'Partner neve', partnerLogo: 'Partner logó', sortOrder: 'Sorrend',
    save: 'Mentés', update: 'Frissítés', cancel: 'Mégse', delete: 'Törlés', edit: 'Szerkesztés', actions: 'Műveletek',
    noPartnersYet: 'Még nincsenek partnerek.', partnerCreated: 'Partner sikeresen létrehozva!', partnerUpdated: 'Partner sikeresen frissítve!',
    partnerDeleted: 'Partner sikeresen törölve!', deleteConfirm: 'Törli ezt a partnert?',
    optional: 'Opcionális', required: 'Kötelező', currentLogo: 'Jelenlegi logó', removeLogo: 'Jelenlegi logó eltávolítása',
    defaultPlaceholder: 'alapértelmezett helyőrző lesz használva', imageInfo: 'PNG, JPG vagy SVG ajánlott. Max 2MB. A kép 300x300px-re lesz átméretezve.',
    noLogoProvided: 'Ha nincs megadva, alapértelmezett helyőrző lesz használva.'
  }
};
app.use((req, res, next) => {
  res.locals.t = function t(key){
    try{
      const lang = (res.locals.lang || 'en').toLowerCase();
      const L = TRANSLATIONS[lang] || TRANSLATIONS.en;
      return L[key] || TRANSLATIONS.en[key] || key;
    }catch{
      return key;
    }
  };
  next();
});

// Load site settings (e.g., contact info) into locals per request
app.use(async (req, res, next) => {
  res.locals.site = res.locals.site || {};
  if(useDb){
    try{
      const cfg = await db.getSettings?.(res.locals.lang);
      let contact = cfg?.contact || {};
      if((!contact || Object.keys(contact).length === 0)){
        const cfgEn = await db.getSettings?.('en');
        contact = cfgEn?.contact || {};
      }
      res.locals.site.contact = contact;
      // Footer gallery: get a few random images for display
      try{
        const imgs = await db.listRandomImages?.(12).catch(()=>[]);
        res.locals.footerGallery = (imgs || []).slice(0, 12);
      }catch{ res.locals.footerGallery = []; }
    }catch(e){
      res.locals.site.contact = {};
      res.locals.footerGallery = [];
    }
  }
  next();
});

// Basic auth middleware for admin routes (optional)
function basicAuth(req, res, next){
  const adminUser = process.env.ADMIN_USER;
  const adminPass = process.env.ADMIN_PASS;
  // if not configured, allow access (dev convenience)
  if(!adminUser || !adminPass) return next();

  const auth = req.headers['authorization'];
  if(!auth){
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Authentication required');
  }
  const parts = auth.split(' ');
  if(parts.length !== 2 || parts[0] !== 'Basic') return res.status(400).send('Bad authorization header');
  const creds = Buffer.from(parts[1], 'base64').toString('utf8');
  const [user, pass] = creds.split(':');
  if(user === adminUser && pass === adminPass) return next();
  res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
  return res.status(403).send('Forbidden');
}

app.get('/', async (req,res) =>{
  // get home page from DB
  let pages = [];
  let menu = [];
  let home = null;
  let settings = {};
  let slider = [];
  try {
    pages = await db.listPages(res.locals.lang);
    menu = buildMenu(pages);
    home = pages.find(p=>p.slug === 'home');
    settings = await db.getSettings?.(res.locals.lang).catch(()=>({})) || {};
    slider = Array.isArray(settings.slider) ? settings.slider : [];
  } catch(err) {
    console.error('[app.get /] Database error:', err.message);
    // Show placeholder content when DB is unavailable
  }
    // Fetch EN images + current language content blocks for homepage
  let blocksHtml = '';
  let midRowHtml = '';
  let b4RowHtml = '';
  try {
    const enHome = await db.getPage('en', 'home');
    const curHome = await db.getPage(res.locals.lang, 'home');
    if (enHome && enHome.id) {
      const itemsEn = await db.getAdditionalImages('page', enHome.id);
      let itemsCur = [];
      if (curHome && curHome.id) {
        itemsCur = await db.getAdditionalImages('page', curHome.id);
      }
      const getTxt = (idx) => {
        const enIt = (itemsEn || [])[idx];
        const curIt = (itemsCur || [])[idx];
        return (curIt && curIt.alt_text && curIt.alt_text.trim()) ? curIt.alt_text : ((enIt && enIt.alt_text) || '');
      };
      const getImg = (idx) => {
        const enIt = (itemsEn || [])[idx];
        return enIt && enIt.image_url ? enIt.image_url : '';
      };
      const b1 = { img: getImg(0), txt: getTxt(0) };
      const b2 = { img: getImg(1), txt: getTxt(1) };
      const b3 = { img: getImg(2), txt: getTxt(2) };
      const b4 = { img: getImg(3), txt: getTxt(3) };
      const hasAny = (b1.img || b1.txt || b2.txt || b3.txt || b4.txt);
      if (hasAny) {
        const imageCol = b1.img ? `
          <div class="col-lg-6 wow fadeIn" data-wow-delay="0.2s">
            <div class="rounded overflow-hidden shadow-sm">
              <img class="img-fluid w-100" src="${b1.img}" alt="Home section image">
            </div>
          </div>` : '';
        const rightCol = `
          <div class="col-lg-6">
            ${b1.txt ? `<div class="mb-4 wow fadeIn" data-wow-delay="0.2s">${b1.txt}</div>` : ''}
          </div>`;
        // Prepare mid-row (sections 2 & 3) to be rendered later below stats
        midRowHtml = (b2.txt || b3.txt) ? `
          <div class="container py-4">
            <div class="row g-3 align-items-stretch about-row wow fadeInUp" data-wow-delay="0.05s">
              <div class="col-12 col-md-6">
                ${b2.txt ? `
                <div class="about-mid-card about-mid-card-left h-100">
                  <div class="about-mid-icon"><i class="fas fa-hands-helping"></i></div>
                  <div class="about-mid-body">${b2.txt}</div>
                </div>` : ''}
              </div>
              <div class="col-12 col-md-6">
                ${b3.txt ? `
                <div class="about-mid-card about-mid-card-right h-100">
                  <div class="about-mid-icon"><i class="fas fa-people-group"></i></div>
                  <div class="about-mid-body">${b3.txt}</div>
                </div>` : ''}
              </div>
            </div>
          </div>` : '';
        // Prepare bottom row (section 4): text left, image right under the two cards
        b4RowHtml = (b4.txt || b4.img) ? `
          <div class="container py-4">
            <div class="row align-items-stretch about-row wow fadeInUp" data-wow-delay="0.1s">
              <div class="col-md-6 mb-3 mb-md-0">
                <div class="bg-white p-3 rounded shadow-sm h-100">${b4.txt || ''}</div>
              </div>
              <div class="col-md-6">
                ${b4.img ? `<div class="about-img-fill rounded shadow-sm"><img src="${b4.img}" class="w-100" alt="Section"></div>` : `<div class="h-100"></div>`}
              </div>
            </div>
          </div>` : '';

        blocksHtml = `
          <div class="container-fluid py-5">
            <div class="container">
              <div class="row g-5 align-items-center">
                ${imageCol}${rightCol}
              </div>
            </div>
          </div>`;
      }
    }
  } catch {}
  // Stats counters from settings (light style, with localized header)
  let statsHtml = '';
  try {
    const cfg = await db.getSettings?.(res.locals.lang).catch(()=>({})) || {};
    const stats = Array.isArray(cfg.stats) ? cfg.stats : [];
    const actives = stats.filter(s => (typeof s.active === 'boolean' ? s.active : true));
    if (actives.length) {
      const lang = (res.locals.lang || 'en').toLowerCase();
      const hdrMap = {
        en: { kicker: 'OUR IMPACT', heading: 'Key Numbers' },
        sk: { kicker: 'NÁŠ DOPAD', heading: 'Kľúčové čísla' },
        hu: { kicker: 'HATÁSUNK', heading: 'Kulcsszámok' }
      };
      const H = hdrMap[lang] || hdrMap.en;
      const cards = actives.map((s, i) => {
        const val = Number.isFinite(+s.value) ? Number(s.value) : 0;
        const label = (s.labels && (s.labels[res.locals.lang] || s.labels.en || s.labels.sk || s.labels.hu)) || '';
        const icon = (s.icon || '').trim();
        const suffix = (s.suffix || '').trim();
        const iconHtml = icon ? `<i class="fas ${icon} fa-2x text-primary mb-2"></i>` : '';
        return `
          <div class="col-6 col-md-3">
            <div class="stats-card text-center p-4 shadow-sm rounded wow fadeIn" data-wow-delay="${0.1 + i*0.1}s">
              ${iconHtml}
              <h2 class="mb-0" style="font-family:'Josefin Sans',sans-serif; font-weight:700; color:#1A685B;">
                <span data-toggle="counter-up">${val}</span>${suffix ? `<span class="ms-1">${suffix}</span>` : ''}
              </h2>
              ${label ? `<div class="text-muted small mt-1">${label}</div>` : ''}
            </div>
          </div>`;
      }).join('');
      statsHtml = `
        <div class="container py-5 stats-section">
          <div class="text-center mx-auto mb-4" style="max-width:820px;">
            <div class="section-title-bar mb-2"><div class="bar"></div><span class="section-title text-warning">${H.kicker}</span><div class="bar"></div></div>
            <h2 class="display-6" style="font-family:'Josefin Sans',sans-serif; font-weight:700;">${H.heading}</h2>
          </div>
          <div class="row g-3 align-items-stretch">
            ${cards}
          </div>
        </div>`;
    }
  } catch {}

  const pageObj = home || { title: 'Home', content: '' };
  // Keep title empty in the card but show a localized section header, similar to other pages
  const merged = { ...pageObj, title: '', content: blocksHtml + statsHtml + midRowHtml + b4RowHtml };
  let sliderBg = settings.slider_bg_image_url || '';
  // Add cache-busting based on file mtime for local uploads
  try {
    if (sliderBg && sliderBg.startsWith('/uploads/')){
      const rel = sliderBg.replace(/^\//, '');
      const p = path.join(__dirname, 'public', rel.split('?')[0]);
      const st = fsSync.statSync(p);
      if (st && st.mtimeMs){
        const sep = sliderBg.includes('?') ? '&' : '?';
        sliderBg = `${sliderBg}${sep}v=${Math.floor(st.mtimeMs)}`;
      }
    }
  } catch {}
  const sliderTextAlign = settings.slider_text_align || 'center';
  const sliderTitleColor = settings.slider_title_color || '#ffffff';
  const sliderCaptionColor = settings.slider_caption_color || '#ffffff';
  // Home section header (like other pages): localized small kicker + big heading
  const shLang = (res.locals.lang || 'en').toLowerCase();
  const shMap = {
    en: { kicker: 'WELCOME', heading: 'Welcome to our site' },
    sk: { kicker: 'VITAJTE', heading: 'Vitajte na našej stránke' },
    hu: { kicker: 'ÜDVÖZÖLJÜK', heading: 'Üdvözöljük oldalunkon' }
  };
  const sectionHeader = shMap[shLang] || shMap.en;
  return res.render('page', { menu, page: merged, lang: res.locals.lang, slider, sliderBg, sliderTextAlign, sliderTitleColor, sliderCaptionColor, sectionHeader, t: res.locals.t });
});

app.get('/page/:slug', async (req,res)=>{
  try {
    const page = await db.getPage(res.locals.lang, req.params.slug);
    const pages = await db.listPages(res.locals.lang);
    const menu = buildMenu(pages);
    if(!page) return res.status(404).send('Not found');
  let contentHtml = page.content;
  // Special rendering for GDPR: use section header like other pages and hide the page title text
  if (req.params.slug === 'gdpr') {
    const lang = res.locals.lang;
    const shI18n = {
      en: { kicker: 'GDPR', subheading: 'We respect your privacy and process data responsibly.' },
      sk: { kicker: 'GDPR', subheading: 'Rešpektujeme vaše súkromie a zodpovedne spracúvame údaje.' },
      hu: { kicker: 'GDPR', subheading: 'Tiszteletben tartjuk az adatvédelmet és felelősen kezeljük az adatokat.' }
    };
    const cur = shI18n[lang] || shI18n.en;
    const shGDPR = { kicker: cur.kicker, heading: '', subheading: cur.subheading };
    // Localized table header label and render GDPR content inside the table; no image/illustration
    const headerLabel = res.locals.t('privacyPolicy');
    const combined = `
      <div class="table-responsive">
        <table class="table table-striped align-middle focus-areas-table">
          <thead>
            <tr><th class="text-uppercase small">${headerLabel}</th></tr>
          </thead>
          <tbody>
            <tr><td><div class="gdpr-content">${contentHtml}</div></td></tr>
          </tbody>
        </table>
      </div>`;
    return res.render('page', { 
      menu, 
      page: { title: '', content: combined, image_url: null }, 
      lang: res.locals.lang, 
      slider: null,
      sectionHeader: shGDPR,
      t: res.locals.t
    });
  }
  if(req.params.slug === 'contact'){
    const c = res.locals.site?.contact || {};
    const siteKey = process.env.RECAPTCHA_SITE_KEY || '';
    const addr = (c.address || '').trim() || 'Bratislava, Slovakia';
    const mapSrc = `https://www.google.com/maps?q=${encodeURIComponent(addr)}&output=embed`;
    const success = req.query.success === '1';
    const failure = req.query.success === '0';
    const alert = success
      ? `<div class="alert alert-success mb-4"><i class='fas fa-check-circle me-2'></i>Your message has been sent. Thank you!</div>`
      : (failure ? `<div class="alert alert-danger mb-4"><i class='fas fa-triangle-exclamation me-2'></i>We couldn't send your message right now. Please try again later.</div>` : '');
    const infoList = `
      <ul class="list-unstyled mb-0">
        ${c.address ? `<li class='mb-2'><i class='fas fa-map-marker-alt me-2 text-primary'></i>${c.address}</li>` : ''}
        ${c.phone ? `<li class='mb-2'><i class='fas fa-phone me-2 text-primary'></i><a href='tel:${c.phone}'>${c.phone}</a></li>` : ''}
        ${c.email ? `<li class='mb-2'><i class='fas fa-envelope me-2 text-primary'></i><a href='mailto:${c.email}'>${c.email}</a></li>` : ''}
      </ul>`;
    const socials = `
      <div class='d-flex gap-2 mt-2'>
        ${c.facebook ? `<a class='btn btn-sm btn-outline-primary' href='${c.facebook}' target='_blank' rel='noopener'><i class="fab fa-facebook-f"></i></a>` : ''}
        ${c.instagram ? `<a class='btn btn-sm btn-outline-primary' href='${c.instagram}' target='_blank' rel='noopener'><i class="fab fa-instagram"></i></a>` : ''}
        ${c.twitter ? `<a class='btn btn-sm btn-outline-primary' href='${c.twitter}' target='_blank' rel='noopener'><i class="fab fa-x-twitter"></i></a>` : ''}
        ${c.linkedin ? `<a class='btn btn-sm btn-outline-primary' href='${c.linkedin}' target='_blank' rel='noopener'><i class="fab fa-linkedin-in"></i></a>` : ''}
        ${c.youtube ? `<a class='btn btn-sm btn-outline-primary' href='${c.youtube}' target='_blank' rel='noopener'><i class="fab fa-youtube"></i></a>` : ''}
      </div>`;
    const hero = `
      <section class="contact-map-hero">
        <iframe class="contact-map-iframe" src="${mapSrc}" allowfullscreen loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
      </section>`;
    const contentSection = `
      <section class="contact-content">
        <div class="container py-5">
          ${alert}
          <div class="row g-4 align-items-start">
            <div class="col-lg-6">
              <div class="bg-white p-4 rounded shadow-sm h-100">
                <h4 class="mb-3"><i class="fas fa-location-dot me-2 text-primary"></i>${res.locals.t('ourAddress')}</h4>
                ${c.address ? `<p class='mb-3'>${c.address}</p>` : ''}
                <h4 class="mt-3 mb-2"><i class="fas fa-envelope me-2 text-primary"></i>${res.locals.t('emailLabel')}</h4>
                ${c.email ? `<p class='mb-1'><a href='mailto:${c.email}'>${c.email}</a></p>` : ''}
                ${c.phone ? `<p class='mb-1'><a href='tel:${c.phone}'>${c.phone}</a></p>` : ''}
                ${socials}
              </div>
            </div>
            <div class="col-lg-6">
              <div class="bg-white p-4 rounded shadow-sm h-100">
                <h3 class="mb-3">${res.locals.t('getInTouch')}</h3>
                <form method="post" action="/contact?lang=${res.locals.lang}">
                  <div class="row g-3">
                    <!-- Honeypot field: should remain empty -->
                    <div class="col-12" style="position:absolute; left:-9999px; top:auto; width:1px; height:1px; overflow:hidden;">
                      <label class="form-label" for="contact_website">Website</label>
                      <input id="contact_website" type="text" name="website" class="form-control" tabindex="-1" autocomplete="off" />
                    </div>
                    <div class="col-md-6">
                      <label class="form-label" for="contact_name">${res.locals.t('nameLabel')}</label>
                      <input id="contact_name" type="text" name="name" class="form-control" required />
                    </div>
                    <div class="col-md-6">
                      <label class="form-label" for="contact_email">${res.locals.t('emailLabel')}</label>
                      <input id="contact_email" type="email" name="email" class="form-control" required />
                    </div>
                    <div class="col-12">
                      <label class="form-label" for="contact_subject">${res.locals.t('subjectLabel')}</label>
                      <input id="contact_subject" type="text" name="subject" class="form-control" />
                    </div>
                    <div class="col-12">
                      <label class="form-label" for="contact_message">${res.locals.t('messageLabel')}</label>
                      <textarea id="contact_message" name="message" class="form-control" rows="5" required></textarea>
                    </div>
                    ${siteKey ? `
                    <div class="col-12">
                      <div class="g-recaptcha" data-sitekey="${siteKey}"></div>
                    </div>` : ''}
                    <div class="col-12 d-grid">
                      <button class="btn btn-primary" type="submit"><i class="fas fa-paper-plane me-2"></i>${res.locals.t('sendMessage')}</button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      </section>${siteKey ? `
      <script src="https://www.google.com/recaptcha/api.js" async defer></script>` : ''}`;
    // Render hero above, and the content section below without default card wrapper; remove contact title
    return res.render('page', { 
      menu, 
      page: { title: '', content: contentSection, image_url: null }, 
      lang: res.locals.lang, 
      slider: null,
      hero,
      rawContent: true,
      t: res.locals.t
    });
  }
  // Special: About Us — render with a custom layout (alternate image/text rows), no default page title/card
  if (req.params.slug === 'about-us') {
    try {
      const curPage = await db.getPage(res.locals.lang, 'about-us');
      const enPage = await db.getPage('en', 'about-us');
      const curItems = (curPage && curPage.id) ? (await db.getAdditionalImages('page', curPage.id)) : [];
      const enItems = (enPage && enPage.id) ? (await db.getAdditionalImages('page', enPage.id)) : [];
      // Localized static header texts for About page
      const aboutTextsByLang = {
        en: { kicker: 'ABOUT', heading: 'Who We Are', subheading: 'Get to know our mission, values, and the people behind our work.', empty: 'No sections yet.' },
        sk: { kicker: 'O NÁS', heading: 'Kto sme', subheading: 'Spoznajte naše poslanie, hodnoty a ľudí, ktorí stoja za našou prácou.', empty: 'Zatiaľ žiadne sekcie.' },
        hu: { kicker: 'RÓLUNK', heading: 'Kik vagyunk', subheading: 'Ismerje meg küldetésünket, értékeinket és a munkánk mögött álló embereket.', empty: 'Még nincsenek szekciók.' }
      };
      const aboutL = aboutTextsByLang[(res.locals.lang || 'en').toLowerCase()] || aboutTextsByLang.en;
      // Prepare section data (EN image + current-language text fallback)
      const sec = Array.from({length:4}).map((_,i)=>{
        const enA = enItems[i] || null;
        const curA = curItems[i] || null;
        const img = enA ? (enA.image_url || '') : '';
        const txt = ((curA && curA.alt_text) || (enA && enA.alt_text) || '').trim();
        return { img, txt };
      });
      const rows = [];
      // Row 1: image left, text right — equal heights
      if (sec[0] && (sec[0].img || sec[0].txt)){
        const imageCol = sec[0].img ? `<div class=\"col-md-6 mb-3 mb-md-0\"><div class=\"about-img-fill rounded shadow-sm\"><img src=\"${sec[0].img}\" class=\"w-100\" alt=\"${aboutL.heading}\"></div></div>` : `<div class=\"col-md-6 mb-3 mb-md-0\"></div>`;
        const textCol = `<div class=\"col-md-6\"><div class=\"bg-white p-3 rounded shadow-sm h-100\">${sec[0].txt}</div></div>`;
        rows.push(`<div class=\"row align-items-stretch mb-4 about-row wow fadeInUp\" data-wow-delay=\"0.05s\">${imageCol}${textCol}</div>`);
      }
      // Row 2: texts for sections 2 and 3 side-by-side (no images) with headers/icons and background variants
      const t2 = (sec[1] && sec[1].txt) || '';
      const t3 = (sec[2] && sec[2].txt) || '';
      if (t2 || t3){
        const col2 = t2 ? `
          <div class=\"about-mid-card about-mid-card-left h-100\">
            <div class=\"about-mid-icon\"><i class=\"fas fa-hands-helping\"></i></div>
            <div class=\"about-mid-body\">${t2}</div>
          </div>` : '';
        const col3 = t3 ? `
          <div class=\"about-mid-card about-mid-card-right h-100\">
            <div class=\"about-mid-icon\"><i class=\"fas fa-people-group\"></i></div>
            <div class=\"about-mid-body\">${t3}</div>
          </div>` : '';
        rows.push(`
          <div class=\"row g-3 align-items-stretch mb-4 about-row wow fadeInUp\" data-wow-delay=\"0.1s\">
            <div class=\"col-12 col-md-6\">${col2}</div>
            <div class=\"col-12 col-md-6\">${col3}</div>
          </div>`);
      }
      // Row 3: section 4, text left, image right (reverse of row 1) — equal heights
      if (sec[3] && (sec[3].img || sec[3].txt)){
        const textCol = `<div class=\"col-md-6 mb-3 mb-md-0\"><div class=\"bg-white p-3 rounded shadow-sm h-100\">${sec[3].txt}</div></div>`;
        const imageCol = sec[3].img ? `<div class=\"col-md-6\"><div class=\"about-img-fill rounded shadow-sm\"><img src=\"${sec[3].img}\" class=\"w-100\" alt=\"${aboutL.heading}\"></div></div>` : `<div class=\"col-md-6\"></div>`;
        rows.push(`<div class=\"row align-items-stretch mb-4 about-row wow fadeInUp\" data-wow-delay=\"0.15s\">${textCol}${imageCol}</div>`);
      }
      // Optional decorative header for the About page section
      const hdr = `
        <div class=\"container pt-5\">
          <div class=\"text-center mx-auto mb-4\" style=\"max-width:820px;\">
            <div class=\"section-title-bar mb-2\"><div class=\"bar\"></div><span class=\"section-title text-warning\">${aboutL.kicker}</span><div class=\"bar\"></div></div>
            <h2 class=\"display-6\" style=\"font-family:'Josefin Sans',sans-serif; font-weight:700;\">${aboutL.heading}</h2>
            <p class=\"text-muted\">${aboutL.subheading}</p>
          </div>
        </div>`;
  const blocks = rows.length ? `${hdr}<div class=\"container pb-5 about-page\">${rows.join('')}</div>` : `<div class=\"container py-5 about-page\"><div class=\"text-muted\">${aboutL.empty}</div></div>`;
      // Render only our custom layout (no default title/card)
      return res.render('page', { 
        menu, 
        page: { title: '', content: blocks, image_url: null }, 
        lang: res.locals.lang, 
        slider: null,
        rawContent: true,
        t: res.locals.t 
      });
    } catch {}
  }
  return res.render('page', { menu, page: { title: page.title, content: contentHtml, image_url: page.image_url }, lang: res.locals.lang, slider: null, t: res.locals.t });
  } catch(err) {
    console.error('[app.get /page/:slug] Database error:', err.message);
    return res.status(500).send('Database connection error. Please try again later.');
  }
});

// Contact form handler (stores nothing for now; extend to email/DB later)
app.post('/contact', async (req, res) => {
  try {
    const { name, email, subject, message, website } = req.body || {};
    const lang = res.locals.lang || req.query.lang || 'en';
    // Honeypot field should be empty
    if (website && String(website).trim() !== ''){
      return res.redirect(`/page/contact?lang=${lang}&success=1`);
    }
    // Basic validation
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if(!name || !email || !emailRe.test(String(email)) || !message){
      return res.redirect(`/page/contact?lang=${lang}&success=0`);
  }
  // reCAPTCHA verification (if configured)
  try {
    const secret = process.env.RECAPTCHA_SECRET || '';
    const siteKey = process.env.RECAPTCHA_SITE_KEY || '';
    if (secret && siteKey) {
      const token = (req.body['g-recaptcha-response'] || '').toString().trim();
      if (!token) {
        try { await db.createContactMessage?.({ name, email, subject, message, lang, status: 'failed', error: 'recaptcha_missing' }); } catch {}
        return res.redirect(`/page/contact?lang=${lang}&success=0`);
      }
      const form = new URLSearchParams();
      form.append('secret', secret);
      form.append('response', token);
      const remoteip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || '').toString();
      if (remoteip) form.append('remoteip', remoteip);
      let ok = false;
      let errCodes = [];
      try {
        if (typeof fetch === 'function') {
          const resp = await fetch('https://www.google.com/recaptcha/api/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form.toString()
          });
          const data = await resp.json().catch(()=>({}));
          ok = !!data.success;
          errCodes = Array.isArray(data['error-codes']) ? data['error-codes'] : [];
        } else {
          const payload = form.toString();
          const data = await new Promise((resolve, reject) => {
            const reqOpts = {
              method: 'POST',
              hostname: 'www.google.com',
              path: '/recaptcha/api/siteverify',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(payload)
              }
            };
            const r = https.request(reqOpts, (resp) => {
              let buf = '';
              resp.on('data', (chunk) => { buf += chunk; });
              resp.on('end', () => {
                try { resolve(JSON.parse(buf)); } catch { resolve({ success: false, 'error-codes': ['bad_json'] }); }
              });
            });
            r.on('error', reject);
            r.write(payload);
            r.end();
          });
          ok = !!data.success;
          errCodes = Array.isArray(data['error-codes']) ? data['error-codes'] : [];
        }
      } catch (e) {
        ok = false;
        errCodes = ['verify_error'];
      }
      if (!ok) {
        try { await db.createContactMessage?.({ name, email, subject, message, lang, status: 'failed', error: `recaptcha_failed:${errCodes.join(',')}` }); } catch {}
        return res.redirect(`/page/contact?lang=${lang}&success=0`);
      }
    }
  } catch {}
  // SMTP env
  const host = process.env.SMTP_HOST;
  const portEnv = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const to = process.env.CONTACT_TO || process.env.SMTP_TO || process.env.SMTP_USER;
  const fromEmail = process.env.SMTP_FROM_EMAIL || user;
  const fromName  = process.env.SMTP_FROM_NAME || 'Website Contact';
  const ignoreTLS = process.env.SMTP_IGNORE_TLS === '1';
  const allowInvalid = process.env.SMTP_ALLOW_INVALID_CERT === '1';
  if(!host || !user || !pass || !to){
    try{ console.warn('[contact] SMTP not configured; skipping send.'); }catch{}
    try { await db.createContactMessage?.({ name, email, subject, message, lang, status: 'skipped', error: 'smtp_not_configured' }); } catch {}
    return res.redirect(`/page/contact?lang=${lang}&success=1`);
  }
  try{
    // Try STARTTLS (587) then SMTPS (465)
    const attempts = ignoreTLS
      ? [{ port: portEnv || 587, secure: false }]
      : [
          { port: portEnv || 587, secure: (process.env.SMTP_SECURE === '1') || (portEnv === 465) },
          { port: 465, secure: true }
        ];
    const html = `
      <h3>New contact message</h3>
      <p><strong>Name:</strong> ${String(name).replace(/[<>]/g,'')}</p>
      <p><strong>Email:</strong> <a href="mailto:${String(email).replace(/[<>]/g,'')}">${String(email).replace(/[<>]/g,'')}</a></p>
      ${subject ? `<p><strong>Subject:</strong> ${String(subject).replace(/[<>]/g,'')}</p>` : ''}
      <p><strong>Message:</strong></p>
      <p style="white-space:pre-wrap">${String(message).slice(0,5000).replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>
    `;
    let sent = false;
    let lastErr = null;
    for(const cfg of attempts){
      try{
        const transporter = nodemailer.createTransport({
          host,
          port: cfg.port,
          secure: cfg.secure,
          auth: { user, pass },
          ignoreTLS,
          tls: allowInvalid ? { rejectUnauthorized: false } : undefined
        });
        await transporter.sendMail({
          from: { name: fromName, address: fromEmail || user },
          replyTo: { name, address: String(email) },
          to,
          subject: subject ? `[Contact] ${subject}` : 'New contact message',
          html
        });
        sent = true;
        break;
      }catch(e){ lastErr = e; }
    }
    if(sent){
      try { await db.createContactMessage?.({ name, email, subject, message, lang, status: 'sent', error: null }); } catch {}
      return res.redirect(`/page/contact?lang=${lang}&success=1`);
    }
    throw lastErr || new Error('send_failed');
  }catch(e){
    try{ console.error('[contact] send failed:', e?.message || e); }catch{}
    try {
      const errMsg = (e && (e.message || String(e))) || 'unknown';
      const extra = (e && (e.response || e.code || e.responseCode)) ? ` code=${e.code||''} resp=${e.responseCode||''}:${e.response||''}` : '';
      await db.createContactMessage?.({ name, email, subject, message, lang, status: 'failed', error: `${errMsg}${extra}` });
    } catch {}
    return res.redirect(`/page/contact?lang=${lang}&success=0`);
  }
  } catch(err) {
    console.error('[app.post /contact] Error:', err.message);
    // Even on error, try to send the email without DB logging
    const lang = req.body?.lang || req.query.lang || 'en';
    return res.redirect(`/page/contact?lang=${lang}&success=0`);
  }
});

// Public events listing
app.get('/events', async (req, res) => {
  try {
    const pages = await db.listPages(res.locals.lang);
    const menu = buildMenu(pages);
    // Aggregate across languages and deduplicate by group
    let all = [];
    try{
      const [en, sk, hu] = await Promise.all([
        db.listEvents('en').catch(()=>[]),
        db.listEvents('sk').catch(()=>[]),
        db.listEvents('hu').catch(()=>[])
      ]);
      all = [...en, ...sk, ...hu];
    } catch {
      all = await db.listEvents(res.locals.lang).catch(()=>[]) || [];
    }
    const byGroup = new Map();
    for(const ev of all){
      const key = ev.group_id || `single_${ev.id}`;
      if(!byGroup.has(key)) byGroup.set(key, ev);
    }
    const bases = Array.from(byGroup.values());
    const resolved = await Promise.all(bases.map(b => resolveEventVariant(b, res.locals.lang)));
    const cards = resolved.map(e => {
      const listImage = e.image_url && String(e.image_url).trim() ? e.image_url : '/img/placeholder-event.svg';
      return `
      <div class="col-lg-4 col-md-6 mb-4">
        <div class="card bg-light shadow-sm h-100 d-flex flex-column">
          <a href="/events/${e.slug || e.id}?lang=${res.locals.lang}${e.group_id ? (`&gid=${encodeURIComponent(e.group_id)}`) : ''}">
            <img src="${listImage}" class="card-img-top" alt="${e.title}" style="height:200px; object-fit:cover;">
          </a>
          <div class="card-body d-flex flex-column">
            <h5 class="card-title text-primary mb-2">${e.title}</h5>
            <p class="card-text text-muted">
              <i class="fas fa-calendar me-1"></i>${e.event_date ? new Date(e.event_date).toLocaleDateString() : ''}
            </p>
            <p class="card-text">
              <i class="fas fa-map-marker-alt me-1"></i>${e.location || ''}
            </p>
            <div class="mt-auto pt-2">
              <a href="/events/${e.slug || e.id}?lang=${res.locals.lang}${e.group_id ? (`&gid=${encodeURIComponent(e.group_id)}`) : ''}" class="btn btn-primary btn-sm w-100 text-center">
                <i class="fas fa-eye me-1"></i>${res.locals.t('viewDetails')}
              </a>
            </div>
          </div>
        </div>
      </div>
    `}).join('');
    const html = `<div class=\"row\">${cards || `<div class=\"text-muted\">${res.locals.t('noEventsYet')}</div>`}</div>`;
  const shEvents = { kicker: res.locals.t('eventsKicker'), heading: res.locals.t('eventsHeading'), subheading: '' };
  return res.render('page', { menu, page: { title: res.locals.t('eventsTitle'), content: html }, lang: res.locals.lang, slider: null, sectionHeader: shEvents, t: res.locals.t });
  } catch(err) {
    console.error('[app.get /events] Database error:', err.message);
    return res.status(500).send('Database connection error. Please try again later.');
  }
});

// Simple admin UI to edit content for a language
app.get('/admin', basicAuth, async (req,res)=>{
  // Admin dashboard (DB only)
  res.render('admin', { lang: res.locals.lang, useDb: true });
});

// Admin User Guide
app.get('/admin/user-guide', basicAuth, (req, res) => {
  res.render('admin-user-guide', { lang: res.locals.lang, useDb: true, active: 'user-guide', title: 'User Guide' });
});

// Admin logout endpoint
app.get('/admin/logout', (req, res) => {
  // Send 401 to clear Basic Auth credentials in browser
  res.set('WWW-Authenticate', 'Basic realm="Admin"');
  res.status(401).send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Logged Out</title>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.0.0/dist/css/bootstrap.min.css" rel="stylesheet">
    </head>
    <body class="bg-light">
      <div class="container">
        <div class="row justify-content-center align-items-center min-vh-100">
          <div class="col-md-6 text-center">
            <div class="card shadow">
              <div class="card-body p-5">
                <i class="fas fa-check-circle text-success" style="font-size: 4rem;"></i>
                <h2 class="mt-3 mb-3">Successfully Logged Out</h2>
                <p class="text-muted mb-4">You have been logged out from the admin panel.</p>
                <a href="/" class="btn btn-primary me-2">
                  <i class="fas fa-home me-1"></i>Go to Homepage
                </a>
                <a href="/admin" class="btn btn-outline-secondary">
                  <i class="fas fa-sign-in-alt me-1"></i>Login Again
                </a>
              </div>
            </div>
            <p class="text-muted mt-3 small">
              <i class="fas fa-info-circle"></i> 
              Close your browser completely to clear the session, or use incognito mode for a fresh login.
            </p>
          </div>
        </div>
      </div>
      <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/7.0.0/css/all.min.css" rel="stylesheet">
    </body>
    </html>
  `);
});

// SMTP test endpoint (admin only): attempts to connect and optionally send a test email
app.get('/admin/test-smtp', basicAuth, async (req, res) => {
  try {
    const host = process.env.SMTP_HOST;
    const portEnv = parseInt(process.env.SMTP_PORT || '587', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const to = process.env.CONTACT_TO || user;
    const fromEmail = process.env.SMTP_FROM_EMAIL || user;
    const fromName  = process.env.SMTP_FROM_NAME || 'SMTP Test';
    const ignoreTLS = process.env.SMTP_IGNORE_TLS === '1';
    const allowInvalid = process.env.SMTP_ALLOW_INVALID_CERT === '1';
    if(!host || !user || !pass) return res.status(400).send('SMTP not configured');
    const attempts = ignoreTLS
      ? [{ port: portEnv || 587, secure: false }]
      : [
          { port: portEnv || 587, secure: (process.env.SMTP_SECURE === '1') || (portEnv === 465) },
          { port: 465, secure: true }
        ];
    let connected = false;
    let lastErr = null;
    for(const cfg of attempts){
      try{
        const transporter = nodemailer.createTransport({
          host,
          port: cfg.port,
          secure: cfg.secure,
          auth: { user, pass },
          ignoreTLS,
          tls: allowInvalid ? { rejectUnauthorized: false } : undefined
        });
        await transporter.verify();
        // optional: send a test mail when query param ?send=1
        if (req.query.send === '1'){
          await transporter.sendMail({ from: { name: fromName, address: fromEmail }, to, subject: 'SMTP Test', text: 'This is a test email from SkillsUp Slovakia.' });
        }
        connected = true;
        return res.status(200).send(`OK via port ${cfg.port} (secure=${cfg.secure})`);
      }catch(e){ lastErr = e; }
    }
    if(!connected){
      return res.status(500).send(`SMTP verify failed: ${(lastErr && (lastErr.message || String(lastErr))) || 'unknown'}`);
    }
  } catch (e) {
    return res.status(500).send(`SMTP test error: ${e?.message || e}`);
  }
});

// Admin: recent contact messages
app.get('/admin/messages', basicAuth, async (req, res) => {
  try{
    const items = await db.listRecentContactMessages?.(100).catch(()=>[]);
    return res.render('admin-messages-list', { lang: res.locals.lang, items });
  } catch (e) {
    return res.status(500).send(`Unable to load messages: ${e?.message || e}`);
  }
});

app.post('/admin/save', basicAuth, async (req,res)=>{
  // Accept either a JSON body (full content object) or a form field named 'content' containing JSON
  let payload = req.body;
  if(typeof payload === 'object' && payload.content && typeof payload.content === 'string'){
    try{
      payload = JSON.parse(payload.content);
    }catch(e){
      return res.status(400).send('Invalid JSON');
    }
  }
  {
    // payload should be full content object; update all pages
    const full = payload;
    for(const [lang, blob] of Object.entries(full)){
      const pages = blob.pages || {};
      for(const [slug, page] of Object.entries(pages)){
        // upsert into db
        const contentValue = page.content;
        await db.upsertPage({ lang, slug, title: page.title, content: contentValue });
      }
    }
    return res.redirect('/admin');
  }
  });

// Documents management (DB only)
app.get('/admin/documents', basicAuth, async (req,res)=>{
  if(!useDb) return res.status(501).send('Documents require DB backend');
  const docs = await db.listDocuments(res.locals.lang);
  const success = req.query.success;
  res.render('admin-docs-list', { docs, lang: res.locals.lang, success });
});

app.get('/admin/documents/new', basicAuth, async (req,res)=>{
  if(!useDb) return res.status(501).send('Documents require DB backend');
  res.render('admin-docs-form', { lang: res.locals.lang, doc: null, docsByLang: null });
});

app.post('/admin/documents', basicAuth, uploadFiles.single('file'), async (req,res)=>{
  if(!useDb) return res.status(501).send('Documents require DB backend');
  const langs = ['en','sk','hu'];
  // Require at least one title
  const titles = Object.fromEntries(langs.map(l => [l, (req.body[`title_${l}`] || '').trim()]));
  const descriptions = Object.fromEntries(langs.map(l => [l, (req.body[`description_${l}`] || '').trim()]));
  const hasAnyTitle = langs.some(l => titles[l]);
  if(!hasAnyTitle){
    return res.status(400).render('admin-docs-form', { lang: res.locals.lang, doc: null, docsByLang: null, error: 'Please enter a title in at least one language.' });
  }
  const sort_order = parseInt(req.body.sort_order || '0', 10) || 0;
  const published = (req.body.published === 'on' || req.body.published === 'true');
  const file = req.file;
  
  // Upload file to storage
  let file_url = '';
  if (file) {
    const filename = generateFilename(file.originalname, 'documents');
    file_url = await uploadFile(file.buffer, filename, file.mimetype);
  }
  
  const groupId = crypto.randomUUID();
  // Create one base record to attach group, then update titles by language
  const sourceLang = langs.find(l => titles[l]) || 'en';
  // Normalize: copy missing titles/descriptions from source
  for(const l of langs){
    if(!titles[l]) titles[l] = titles[sourceLang];
    if(!descriptions[l]) descriptions[l] = descriptions[sourceLang] || '';
  }
  // For each language, create a row
  const created = [];
  for(const l of langs){
    const rec = await db.createDocument({ lang: l, title: titles[l] || 'Document', file_url, description: descriptions[l] || '', sort_order, published });
    created.push(rec);
  }
  // Assign group_id to all
  for(const rec of created){
    await db.setDocumentGroup?.(rec.id, groupId);
  }
  res.redirect(`/admin/documents?lang=${res.locals.lang}&success=created`);
});

app.get('/admin/documents/:id/edit', basicAuth, async (req,res)=>{
  if(!useDb) return res.status(501).send('Documents require DB backend');
  const doc = await db.getDocument(req.params.id);
  if(!doc) return res.status(404).send('Document not found');
  const langs = ['en','sk','hu'];
  const docsByLang = { en: null, sk: null, hu: null };
  if(doc.group_id){
    for(const l of langs){
      docsByLang[l] = await db.getDocumentByGroupAndLang?.(doc.group_id, l) || null;
    }
  } else {
    docsByLang[doc.lang] = doc;
  }
  res.render('admin-docs-form', { lang: res.locals.lang, doc, docsByLang });
});

app.post('/admin/documents/:id', basicAuth, uploadFiles.single('file'), async (req,res)=>{
  if(!useDb) return res.status(501).send('Documents require DB backend');
  const existing = await db.getDocument(req.params.id);
  if(!existing) return res.status(404).send('Document not found');
  // Ensure grouping
  let groupId = existing.group_id;
  if(!groupId){
    groupId = crypto.randomUUID();
    await db.setDocumentGroup?.(existing.id, groupId);
  }
  const langs = ['en','sk','hu'];
  const titles = Object.fromEntries(langs.map(l => [l, (req.body[`title_${l}`] || '').trim()]));
  const descriptions = Object.fromEntries(langs.map(l => [l, (req.body[`description_${l}`] || '').trim()]));
  const sort_order = parseInt(req.body.sort_order || String(existing.sort_order || 0), 10) || (existing.sort_order || 0);
  const published = (req.body.published === 'on' || req.body.published === 'true');
  const file = req.file;
  
  // Upload new file to storage
  let newFileUrl = existing.file_url;
  if (file) {
    const filename = generateFilename(file.originalname, 'documents');
    newFileUrl = await uploadFile(file.buffer, filename, file.mimetype);
    
    // If file uploaded, propagate to all in group
    if(typeof db.updateDocumentFileForGroup === 'function'){
      await db.updateDocumentFileForGroup(groupId, newFileUrl);
    }
  }
  // Determine source language for autofill
  const sourceLang = langs.find(l => titles[l] || descriptions[l]) || null;
  for(const l of langs){
    const dv = await db.getDocumentByGroupAndLang?.(groupId, l);
    let newTitle = titles[l];
    let newDesc  = descriptions[l];
    const titleEmpty = !dv || !dv.title || !dv.title.trim();
    const descEmpty  = !dv || !dv.description || !dv.description.trim();
    if(sourceLang){
      if(!newTitle && titleEmpty) newTitle = titles[sourceLang] || null;
      if(!newDesc  && descEmpty)  newDesc  = descriptions[sourceLang] || null;
    }
    if(dv){
      await db.updateDocument(dv.id, {
        title: newTitle || dv.title,
        description: (newDesc!==undefined && newDesc!==null && newDesc!=='') ? newDesc : (dv.description || null),
        sort_order,
        published,
        file_url: newFileUrl
      });
    } else if (newTitle || newDesc) {
      const rec = await db.createDocument({ lang: l, title: newTitle || titles[sourceLang] || existing.title, file_url: newFileUrl, description: newDesc || descriptions[sourceLang] || existing.description || '', sort_order, published });
      await db.setDocumentGroup?.(rec.id, groupId);
    }
  }
  res.redirect(`/admin/documents?lang=${res.locals.lang}&success=updated`);
});

app.post('/admin/documents/:id/delete', basicAuth, async (req,res)=>{
  if(!useDb) return res.status(501).send('Documents require DB backend');
  try {
    const base = await db.getDocument(req.params.id).catch(() => null);
    if(base?.group_id && typeof db.deleteDocumentGroup === 'function'){
      await db.deleteDocumentGroup(base.group_id);
    } else {
      await db.deleteDocument(req.params.id);
    }
    res.redirect(`/admin/documents?lang=${res.locals.lang}&success=deleted`);
  } catch (e) {
    res.redirect(`/admin/documents?lang=${res.locals.lang}&error=delete_failed`);
  }
});

// Public documents listing
app.get('/documents', async (req,res)=>{
  try {
    const pages = await db.listPages(res.locals.lang);
    const menu = buildMenu(pages);
    // List only current language documents
    const docs = await db.listDocuments(res.locals.lang).catch(()=>[]) || [];
    const items = docs.filter(d=>d.published).map(d=>{
    const fileUrl = d.file_url || '#';
    const listImage = '/img/placeholder-doc.svg';
    const extMatch = (d.file_url || '').match(/\.([a-z0-9]+)(?:\?|#|$)/i);
    const fileExt = extMatch ? extMatch[1].toUpperCase() : 'FILE';
    return `
    <div class="col-md-6 col-lg-4 mb-4">
      <div class="card bg-light shadow-sm h-100 d-flex flex-column">
        <a href="${fileUrl}" target="_blank" rel="noopener">
          <img src="${listImage}" class="card-img-top" alt="${d.title}" style="height:200px; object-fit:cover;">
        </a>
        <div class="card-body d-flex flex-column">
          <div class="d-flex align-items-center justify-content-between mb-2">
            <h5 class="card-title text-primary mb-0">${d.title}</h5>
            <span class="badge" style="background:#1A685B; color:#fff;">${fileExt}</span>
          </div>
          ${d.description ? `<p class=\"card-text\">${d.description}</p>` : ''}
          <div class="mt-auto pt-2">
            <a href="${fileUrl}" class="btn btn-secondary btn-sm w-100 text-center" target="_blank" rel="noopener">
              <i class="fas fa-download me-1"></i>${res.locals.t('download')}
            </a>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
  const html = `<div class=\"row\">${items || `<div class=\"text-muted\">${res.locals.t('noDocumentsYet')}</div>`}</div>`;
  // Localized labels for Documents page
  const lang = (res.locals.lang || 'en').toLowerCase();
  const labels = {
    en: { title: 'Documents', kicker: 'DOCUMENTS', heading: 'Resources and Downloads' },
    sk: { title: 'Dokumenty', kicker: 'DOKUMENTY', heading: 'Zdroje a súbory na stiahnutie' },
    hu: { title: 'Dokumentumok', kicker: 'DOKUMENTUMOK', heading: 'Források és letöltések' }
  };
  const L = labels[lang] || labels.en;
  const shDocs = { kicker: L.kicker, heading: L.heading, subheading: '' };
  return res.render('page', { menu, page: { title: L.title, content: html }, lang: res.locals.lang, slider: null, sectionHeader: shDocs, t: res.locals.t });
  } catch(err) {
    console.error('[app.get /documents] Database error:', err.message);
    return res.status(500).send('Database connection error. Please try again later.');
  }
});

// Events management (DB only)
app.get('/admin/events', basicAuth, async (req,res)=>{
  if(!useDb) return res.status(501).send('Events require DB backend');
  const events = await db.listEvents(res.locals.lang);
  const success = req.query.success;
  res.render('admin-events-list', { events, lang: res.locals.lang, success });
});

// Admin: Events grouped view (all languages) for cleanup

app.get('/admin/events/new', basicAuth, async (req,res)=>{
  if(!useDb) return res.status(501).send('Events require DB backend');
  res.render('admin-events-form', { lang: res.locals.lang, event: null, additionalImages: [] });
});

app.post('/admin/events', basicAuth, uploadImages.any(), async (req,res)=>{
  if(!useDb) return res.status(501).send('Events require DB backend');
  const hasAnyTitle = (req.body.title_en||'').trim() || (req.body.title_sk||'').trim() || (req.body.title_hu||'').trim();
  const event_date = (req.body.event_date||'').trim();
  const location = sanitizeLocation(req.body.location);
  if(!hasAnyTitle || !event_date || !location){
  return res.status(400).render('admin-events-form', { lang: res.locals.lang, event: null, error: 'Please enter a title in at least one language and provide the shared Date and Location.', additionalImages: [] });
  }

  const langs = ['en','sk','hu'];
  const groupId = crypto.randomUUID();
  let createdByLang = { en: null, sk: null, hu: null };
  // Collect provided titles/descriptions
  const titles = { en: (req.body.title_en||'').trim(), sk: (req.body.title_sk||'').trim(), hu: (req.body.title_hu||'').trim() };
  const descs  = { en: (req.body.description_en||'').trim(), sk: (req.body.description_sk||'').trim(), hu: (req.body.description_hu||'').trim() };
  // Determine source language (first one with a title)
  const sourceLang = langs.find(l => titles[l]);
  // Fill missing titles/descriptions from source language so all variants are created
  if(sourceLang){
    for(const l of langs){
      if(!titles[l]) titles[l] = titles[sourceLang];
      if(!descs[l])  descs[l]  = descs[sourceLang];
    }
  }
  // Create variants for all languages using filled values
  for(const l of langs){
    const title = titles[l] || titles[sourceLang];
    const description = descs[l] || '';
    const baseSlug = slugify(title || 'event');
    const slug = await uniqueEventSlug(l, baseSlug);
    const ev = await db.createEvent({ lang: l, group_id: groupId, slug, title: title || 'Event', event_date, location, description, image_url: null });
    createdByLang[l] = ev.id;
  }
  
  // Handle additional images for the last created event (representing the group)
  const filesArr = Array.isArray(req.files) ? req.files : [];
  const additionalFiles = filesArr.filter(f => typeof f.fieldname === 'string' && f.fieldname.startsWith('additional_images'));
  const ownerId = createdByLang.en || createdByLang.sk || createdByLang.hu || Object.values(createdByLang).find(Boolean);
  
  if(additionalFiles.length > 0 && ownerId) {
    // Upload images to storage (Blob or disk)
    const imageUrls = [];
    for (const file of additionalFiles) {
      const optimized = await optimizeImageBuffer(file.buffer);
      const filename = generateFilename(file.originalname, 'events');
      const url = await uploadFile(optimized, filename, file.mimetype);
      imageUrls.push(url);
    }
    
    await db.addAdditionalImages('event', ownerId, imageUrls);
    const lead = imageUrls[0];
    if(db.updateEventImageForGroup){
      await db.updateEventImageForGroup(ownerId, lead);
    } else {
      const existing = await db.getEvent(ownerId);
      await db.updateEvent(ownerId, { title: existing.title, event_date: existing.event_date, location: existing.location, description: existing.description, image_url: lead });
    }
  }
  
  return res.redirect(`/admin/events?lang=${res.locals.lang}&success=created`);
});


app.post('/admin/events/:id/delete', basicAuth, async (req,res)=>{
  if(!useDb) return res.status(501).send('Events require DB backend');
  try {
    const base = await db.getEvent(req.params.id).catch(() => null);
    if(base?.group_id && typeof db.deleteEventGroup === 'function'){
      await db.deleteEventGroup(base.group_id);
    } else {
      await db.deleteEvent(req.params.id);
    }
    res.redirect(`/admin/events?lang=${res.locals.lang}&success=deleted`);
  } catch (e) {
    res.redirect(`/admin/events?lang=${res.locals.lang}&error=delete_failed`);
  }
});

// Admin: one-off cleanup — delete events by title across languages

// Edit Event form
app.get('/admin/events/:id/edit', basicAuth, async (req,res)=>{
  if(!useDb) return res.status(501).send('Events require DB backend');
  const event = await db.getEvent(req.params.id);
  if(!event) return res.status(404).send('Event not found');
  const langs = ['en','sk','hu'];
  const eventsByLang = { en: null, sk: null, hu: null };
  let additionalImages = [];
  try{
    if(event.group_id){
      for(const l of langs){
        const ev = await db.getEventByGroupAndLang?.(event.group_id, l);
        eventsByLang[l] = ev || null;
      }
    } else {
      eventsByLang[event.lang] = event;
    }
    const ownerId = await resolveEventGalleryOwnerId(event);
    additionalImages = await db.getAdditionalImages('event', ownerId);
  }catch{}
  res.render('admin-events-form', { lang: res.locals.lang, event, eventsByLang, additionalImages });
});

// Update Event (multi-language + gallery)
app.post('/admin/events/:id', basicAuth, uploadImages.any(), async (req,res)=>{
  if(!useDb) return res.status(501).send('Events require DB backend');
  const base = await db.getEvent(req.params.id);
  if(!base) return res.status(404).send('Event not found');

  // Ensure grouped editing
  let groupId = base.group_id;
  if(!groupId){
    groupId = crypto.randomUUID();
    if(typeof db.setEventGroup === 'function'){
      await db.setEventGroup(base.id, groupId);
    }
  }

  // Gallery management: remove selected, add new uploads, update/set lead image
  try {
    const ownerId = await resolveEventGalleryOwnerId(base);
    const existing = await db.getAdditionalImages('event', ownerId);
    const removeIdsRaw = req.body.remove_image_ids;
    const removeIds = Array.isArray(removeIdsRaw) ? removeIdsRaw : (removeIdsRaw ? [removeIdsRaw] : []);
    const removeSet = new Set(removeIds.map(id => Number(id)));
    const kept = existing.filter(img => !removeSet.has(Number(img.id)));

    const filesArr = Array.isArray(req.files) ? req.files : [];
    const newFiles = filesArr.filter(f => typeof f.fieldname === 'string' && f.fieldname.startsWith('additional_images'));
    
    // Upload new files to storage
    const newItems = [];
    for (let idx = 0; idx < newFiles.length; idx++) {
      const f = newFiles[idx];
      const optimized = await optimizeImageBuffer(f.buffer);
      const filename = generateFilename(f.originalname, 'events');
      const url = await uploadFile(optimized, filename, f.mimetype);
      newItems.push({ image_url: url, alt_text: '', sort_order: kept.length + idx });
    }

    const finalItems = [
      ...kept.map((img, idx) => ({ image_url: img.image_url, alt_text: img.alt_text || '', sort_order: idx })),
      ...newItems
    ];

    if(typeof db.replaceAdditionalImageItems === 'function'){
      await db.replaceAdditionalImageItems('event', ownerId, finalItems);
    } else {
      await db.deleteAdditionalImages('event', ownerId);
      if(finalItems.length){
        await db.addAdditionalImages('event', ownerId, finalItems.map(i => i.image_url));
      }
    }

    const selectedLead = (req.body.lead_image_url || '').trim();
    let newLead = selectedLead;
    const leadRemoved = base.image_url && !finalItems.find(i => i.image_url === base.image_url);
    if(!newLead && (leadRemoved || !base.image_url)){
      newLead = finalItems[0]?.image_url || null;
    }
    if(typeof db.updateEventImageForGroup === 'function'){
      await db.updateEventImageForGroup(ownerId, newLead || null);
    } else if(newLead !== undefined){
      await db.updateEvent(ownerId, { title: base.title, event_date: base.event_date, location: base.location, description: base.description, image_url: newLead || null });
    }
  } catch (e) {
    console.error('Event gallery update failed', e);
  }

  // Shared fields: event_date and location (apply to existing group records)
  try{
    const event_date = (req.body.event_date || '').trim() || base.event_date;
    const location = (req.body.location || '').trim() || base.location;
    const langs = ['en','sk','hu'];
    for(const l of langs){
      const ev = await db.getEventByGroupAndLang?.(groupId, l);
      if(ev){
        await db.updateEvent(ev.id, { title: ev.title, event_date, location, description: ev.description, image_url: ev.image_url });
      }
    }
  }catch{}

  // Multi-language update for title/description with auto-fill to missing languages
  try{
    const langs = ['en','sk','hu'];
    // Collect posted per-language fields
    const postedTitles = Object.fromEntries(langs.map(l => [l, (req.body[`title_${l}`] || '').trim()]));
    const postedDescs  = Object.fromEntries(langs.map(l => [l, (req.body[`description_${l}`] || '').trim()]));
    // Determine a source language where user provided content
    const sourceLang = langs.find(l => postedTitles[l] || postedDescs[l]) || null;
    for(const l of langs){
      const existing = await db.getEventByGroupAndLang?.(groupId, l);
      // Compute new values: prefer posted; if missing AND existing is empty, replicate from source
      let newTitle = postedTitles[l];
      let newDesc  = postedDescs[l];
      const existingTitleEmpty = !existing || !existing.title || !existing.title.trim();
      const existingDescEmpty  = !existing || !existing.description || !existing.description.trim();
      if(!newTitle && sourceLang && existingTitleEmpty){ newTitle = postedTitles[sourceLang] || null; }
      if(!newDesc  && sourceLang && existingDescEmpty){  newDesc  = postedDescs[sourceLang]  || null; }

      if(existing){
        // If nothing to change for this language, skip
        if(!newTitle && !newDesc) continue;
        await db.updateEvent(existing.id, {
          title: newTitle || existing.title,
          event_date: existing.event_date,
          location: existing.location,
          description: (newDesc !== null && newDesc !== undefined && newDesc !== '') ? newDesc : (existing.description || null),
          image_url: existing.image_url
        });
      } else {
        // Create missing variant only if we have any content either posted or replicated from source
        const titleToUse = newTitle || (sourceLang ? postedTitles[sourceLang] : '') || base.title || 'Event';
        const descToUse  = (newDesc !== null && newDesc !== undefined && newDesc !== '') ? newDesc : ((sourceLang ? postedDescs[sourceLang] : '') || base.description || '');
        if(titleToUse){
          const baseSlug = base.slug || slugify(titleToUse || 'event');
          const slug = await uniqueEventSlug(l, baseSlug);
          await db.createEvent({
            lang: l,
            group_id: groupId,
            slug,
            title: titleToUse,
            event_date: base.event_date,
            location: base.location,
            description: descToUse,
            image_url: base.image_url
          });
        }
      }
    }
  }catch(e){ console.error('Event multi-lang update failed', e); }

  res.redirect(`/admin/events?lang=${res.locals.lang}&success=updated`);
});

app.get('/admin/themes', basicAuth, async (req,res)=>{
  if(!useDb) return res.status(501).send('Themes require DB backend');
  const themes = await db.listThemes(res.locals.lang);
  const success = req.query.success;
  return res.render('admin-themes-list', { themes, lang: res.locals.lang, success });
});

// New Theme form
app.get('/admin/themes/new', basicAuth, async (req, res) => {
  if(!useDb) return res.status(501).send('Themes require DB backend');
  res.render('admin-themes-form', { lang: res.locals.lang, theme: null });
});

// Create Theme (multi-language + gallery + optional cover)
app.post('/admin/themes', basicAuth, uploadImages.any(), async (req, res) => {
  if(!useDb) return res.status(501).send('Themes require DB backend');
  try {
    const hasAnyTitle = (req.body.title_en||'').trim() || (req.body.title_sk||'').trim() || (req.body.title_hu||'').trim();
    if(!hasAnyTitle){
      return res.status(400).render('admin-themes-form', { lang: res.locals.lang, theme: null, error: 'Please enter a title in at least one language.' });
    }

    const langs = ['en','sk','hu'];
    const groupId = crypto.randomUUID();
    let lastThemeId = null;
    // Collect and replicate missing from first provided language
    const titles = { en: (req.body.title_en||'').trim(), sk: (req.body.title_sk||'').trim(), hu: (req.body.title_hu||'').trim() };
    const descs  = { en: (req.body.description_en||'').trim(), sk: (req.body.description_sk||'').trim(), hu: (req.body.description_hu||'').trim() };
    const slugsProvided = { en: (req.body.slug_en||'').trim(), sk: (req.body.slug_sk||'').trim(), hu: (req.body.slug_hu||'').trim() };
    const sourceLang = langs.find(l => titles[l]);
    if(sourceLang){
      for(const l of langs){
        if(!titles[l]) titles[l] = titles[sourceLang];
        if(!descs[l])  descs[l]  = descs[sourceLang];
      }
    }
    for(const l of langs){
      const title = titles[l] || 'Theme';
      const description = descs[l] || '';
      const providedSlug = slugsProvided[l] || '';
      const base = providedSlug ? slugify(providedSlug) : slugify(title);
      const slug = await uniqueThemeSlug(l, base);
      const theme = await db.createTheme({ lang: l, group_id: groupId, slug, title, description, image_url: null });
      lastThemeId = theme.id;
    }

    // Handle cover and additional images for the last created theme (representing the group)
    const filesArr = Array.isArray(req.files) ? req.files : [];
    const coverFile = filesArr.find(f => f.fieldname === 'cover_image');
    const additionalFiles = filesArr.filter(f => typeof f.fieldname === 'string' && f.fieldname.startsWith('additional_images'));
    
    if((coverFile || additionalFiles.length > 0) && lastThemeId) {
      let imageUrls = [];
      
      // Upload additional images
      for (const file of additionalFiles) {
        const optimized = await optimizeImageBuffer(file.buffer);
        const filename = generateFilename(file.originalname, 'themes');
        const url = await uploadFile(optimized, filename, file.mimetype);
        imageUrls.push(url);
      }
      
      // Upload cover image (prepend to list)
      if(coverFile){
        const optimized = await optimizeImageBuffer(coverFile.buffer);
        const filename = generateFilename(coverFile.originalname, 'themes');
        const coverUrl = await uploadFile(optimized, filename, coverFile.mimetype);
        imageUrls = [coverUrl, ...imageUrls];
      }
      
      if(imageUrls.length){
        await db.addAdditionalImages('theme', lastThemeId, imageUrls);
        const lead = imageUrls[0];
        if(db.updateThemeImageForGroup){
          await db.updateThemeImageForGroup(lastThemeId, lead);
        } else {
          const existing = await db.getTheme(lastThemeId);
          await db.updateTheme(lastThemeId, { title: existing.title, description: existing.description, image_url: lead });
        }
      }
    }

  return res.redirect(`/admin/themes?lang=${res.locals.lang}&success=created`);
  } catch (e) {
    return res.status(500).render('admin-themes-form', { lang: res.locals.lang, theme: null, error: e?.message || 'Unexpected error while creating theme.' });
  }
});

// Edit Theme form
app.get('/admin/themes/:id/edit', basicAuth, async (req,res)=>{
  if(!useDb) return res.status(501).send('Themes require DB backend');
  const theme = await db.getTheme(req.params.id);
  if(!theme) return res.status(404).send('Theme not found');
  const langs = ['en','sk','hu'];
  const themesByLang = { en: null, sk: null, hu: null };
  let additionalImages = [];
  try{
    if(theme.group_id){
      for(const l of langs){
        const tv = await db.getThemeByGroupAndLang?.(theme.group_id, l);
        themesByLang[l] = tv || null;
      }
    } else {
      themesByLang[theme.lang] = theme;
    }
    const ownerId = await resolveThemeGalleryOwnerId(theme);
    additionalImages = await db.getAdditionalImages('theme', ownerId);
  }catch{}
  res.render('admin-themes-form', { lang: res.locals.lang, theme, themesByLang, additionalImages });
});

// Update Theme (multi-language + gallery)
app.post('/admin/themes/:id', basicAuth, uploadImages.any(), async (req,res)=>{
  if(!useDb) return res.status(501).send('Themes require DB backend');
  const base = await db.getTheme(req.params.id);
  if(!base) return res.status(404).send('Theme not found');

  // Ensure grouped editing
  let groupId = base.group_id;
  if(!groupId){
    groupId = crypto.randomUUID();
    await db.setThemeGroup?.(base.id, groupId);
  }

  // Gallery management: remove selected, add new uploads, update/set cover image
  try {
    const ownerId = await resolveThemeGalleryOwnerId(base);
    const existing = await db.getAdditionalImages('theme', ownerId);
    const removeIdsRaw = req.body.remove_image_ids;
    const removeIds = Array.isArray(removeIdsRaw) ? removeIdsRaw : (removeIdsRaw ? [removeIdsRaw] : []);
    const removeSet = new Set(removeIds.map(id => Number(id)));
    const kept = existing.filter(img => !removeSet.has(Number(img.id)));

    const filesArr = Array.isArray(req.files) ? req.files : [];
    const newFiles = filesArr.filter(f => typeof f.fieldname === 'string' && f.fieldname.startsWith('additional_images'));
    const coverFile = filesArr.find(f => f.fieldname === 'cover_image');
    
    // Upload new files to storage
    const newItemsRaw = [];
    for (let idx = 0; idx < newFiles.length; idx++) {
      const f = newFiles[idx];
      const optimized = await optimizeImageBuffer(f.buffer);
      const filename = generateFilename(f.originalname, 'themes');
      const url = await uploadFile(optimized, filename, f.mimetype);
      newItemsRaw.push({ image_url: url, alt_text: '', sort_order: kept.length + idx });
    }
    
    let finalItems = [
      ...kept.map((img, idx) => ({ image_url: img.image_url, alt_text: img.alt_text || '', sort_order: idx })),
      ...newItemsRaw
    ];
    
    // If a new cover uploaded, put it first
    let coverUrl = null;
    if(coverFile){
      const optimized = await optimizeImageBuffer(coverFile.buffer);
      const filename = generateFilename(coverFile.originalname, 'themes');
      coverUrl = await uploadFile(optimized, filename, coverFile.mimetype);
      finalItems = [{ image_url: coverUrl, alt_text: '', sort_order: 0 }, ...finalItems.map((it, i) => ({ ...it, sort_order: i+1 }))];
    }

    if(typeof db.replaceAdditionalImageItems === 'function'){
      await db.replaceAdditionalImageItems('theme', ownerId, finalItems);
    } else {
      await db.deleteAdditionalImages('theme', ownerId);
      if(finalItems.length){
        await db.addAdditionalImages('theme', ownerId, finalItems.map(i => i.image_url));
      }
    }

    const selectedLead = (req.body.lead_image_url || '').trim();
    let newLead = coverUrl || selectedLead;
    const leadRemoved = base.image_url && !finalItems.find(i => i.image_url === base.image_url);
    if(!newLead && (leadRemoved || !base.image_url)){
      newLead = finalItems[0]?.image_url || null;
    }
    if(typeof db.updateThemeImageForGroup === 'function'){
      await db.updateThemeImageForGroup(ownerId, newLead || null);
    } else if(newLead !== undefined){
      await db.updateTheme(ownerId, { title: base.title, description: base.description, image_url: newLead || null });
    }
  } catch (e) {
    console.error('Theme gallery update failed', e);
  }

  // Multi-language update for title/description/slug
  const langs = ['en','sk','hu'];
  const posted = Object.fromEntries(langs.map(l => [l, {
    title: (req.body[`title_${l}`] || '').trim(),
    description: (req.body[`description_${l}`] || '').trim(),
    slug: (req.body[`slug_${l}`] || '').trim()
  }]));
  const sourceLang = langs.find(l => posted[l].title || posted[l].description) || null;
  for(const l of langs){
    const tv = await db.getThemeByGroupAndLang(groupId, l);
    let newTitle = posted[l].title;
    let newDesc  = posted[l].description;
    const titleEmpty = !tv || !tv.title || !tv.title.trim();
    const descEmpty  = !tv || !tv.description || !tv.description.trim();
    if(sourceLang){
      if(!newTitle && titleEmpty) newTitle = posted[sourceLang].title || null;
      if(!newDesc  && descEmpty)  newDesc  = posted[sourceLang].description || null;
    }
    const providedSlug = posted[l].slug;
    if(tv){
      if(!newTitle && !newDesc && !providedSlug) continue;
      const newSlug = providedSlug || tv.slug;
      if(typeof db.updateThemeWithSlug === 'function'){
        await db.updateThemeWithSlug(tv.id, { title: newTitle || tv.title, description: (newDesc!==''&&newDesc!=null)?newDesc:tv.description, image_url: tv.image_url, slug: newSlug });
      } else {
        await db.updateTheme(tv.id, { title: newTitle || tv.title, description: (newDesc!==''&&newDesc!=null)?newDesc:tv.description, image_url: tv.image_url });
      }
    } else {
      const titleToUse = newTitle || (sourceLang ? posted[sourceLang].title : '') || base.title || 'Theme';
      const descToUse  = (newDesc!==''&&newDesc!=null)?newDesc:((sourceLang ? posted[sourceLang].description : '') || base.description || '');
      if(titleToUse){
        const baseSlug = providedSlug ? slugify(providedSlug) : (base.slug || slugify(titleToUse));
        const slug = await uniqueThemeSlug(l, baseSlug);
        await db.createTheme({ lang: l, group_id: groupId, slug, title: titleToUse, description: descToUse, image_url: base.image_url });
      }
    }
  }

  // Backward-compatibility: single-language fields
  const { title, description, slug } = req.body;
  if(title || description || slug){
    const newSlug = slug || base.slug;
    if(typeof db.updateThemeWithSlug === 'function'){
      await db.updateThemeWithSlug(base.id, { title: title || base.title, description: description || base.description, image_url: base.image_url, slug: newSlug });
    } else {
      await db.updateTheme(base.id, { title: title || base.title, description: description || base.description, image_url: base.image_url });
    }
  }

  res.redirect(`/admin/themes?lang=${res.locals.lang}&success=updated`);
});

app.post('/admin/themes/:id/delete', basicAuth, async (req,res)=>{
  if(!useDb) return res.status(501).send('Themes require DB backend');
  try {
    const base = await db.getTheme(req.params.id).catch(() => null);
    if(base?.group_id && typeof db.deleteThemeGroup === 'function'){
      await db.deleteThemeGroup(base.group_id);
    } else {
      await db.deleteTheme(req.params.id);
    }
    res.redirect(`/admin/themes?lang=${res.locals.lang}&success=deleted`);
  } catch (e) {
    res.redirect(`/admin/themes?lang=${res.locals.lang}&error=delete_failed`);
  }
});

// Team management (DB only)
app.get('/admin/team', basicAuth, async (req,res)=>{
  if(!useDb) return res.status(501).send('Team requires DB backend');
  const members = await db.listTeam(res.locals.lang);
  const success = req.query.success;
  res.render('admin-team-list', { members, lang: res.locals.lang, success });
});

app.get('/admin/team/new', basicAuth, async (req,res)=>{
  if(!useDb) return res.status(501).send('Team requires DB backend');
  res.render('admin-team-form', { lang: res.locals.lang, member: null, membersByLang: null });
});

app.post('/admin/team', basicAuth, uploadTeam.single('photo'), async (req,res)=>{
  if(!useDb) return res.status(501).send('Team requires DB backend');
  try {
    const body = req.body || {};
    if (!req.body || typeof req.body !== 'object') {
      try { console.warn('Team create: req.body is undefined or not an object. content-type:', req.headers['content-type']); } catch {}
    }
    const name = (body.name || '').trim();
    const { linkedin, facebook, twitter } = body;
    const sort_order = Number.isInteger(parseInt(body.sort_order, 10)) ? parseInt(body.sort_order, 10) : 0;
    if(!name){
      return res.status(400).render('admin-team-form', { lang: res.locals.lang, member: null, membersByLang: null, error: 'Please enter a name.' });
    }
    // Per-language role/bio (tabs)
    const langs = ['en','sk','hu'];
    const roles = { en: (body.role_en||'').trim(), sk: (body.role_sk||'').trim(), hu: (body.role_hu||'').trim() };
    const bios  = { en: (body.bio_en||'').trim(),  sk: (body.bio_sk||'').trim(),  hu: (body.bio_hu||'').trim() };
    const anyProvided = langs.some(l => (roles[l]||'').trim() || (bios[l]||'').trim());
    if(!anyProvided){
      // fallback: accept single-language fields if tabs unused
      roles[res.locals.lang] = (body.role || '').trim();
      bios[res.locals.lang]  = (body.bio  || '').trim();
    }
    // Replicate missing languages from first language that has data
    const sourceLang = langs.find(l => roles[l] || bios[l]);
    if(sourceLang){
      for(const l of langs){
        if(!roles[l]) roles[l] = roles[sourceLang] || '';
        if(!bios[l])  bios[l]  = bios[sourceLang]  || '';
      }
    }
    let photo_url = null;
    if(req.file){
      try{
        const processed = await processTeamImage(req.file.buffer, req.file.originalname || name);
        photo_url = processed.photo_url; // thumb_url currently unused in DB
      }catch(e){
        return res.status(400).render('admin-team-form', { lang: res.locals.lang, member: null, membersByLang: null, error: 'Image could not be processed. Please upload a valid image up to 2 MB.' });
      }
    }
    const groupId = crypto.randomUUID();
    let created = 0;
    for(const l of langs){
      const role = (roles[l]||'').trim();
      const bio  = (bios[l] ||'').trim();
      // create all languages; skip only if totally empty
      if(!role && !bio) continue;
      await db.createTeamMember({ lang: l, group_id: groupId, slug: null, name, role, photo_url, bio, linkedin, facebook, twitter, sort_order });
      created++;
    }
    // Ensure at least current language variant exists even if role/bio are empty
    if(created === 0){
      const atLeastLang = res.locals.lang || 'en';
      await db.createTeamMember({ lang: atLeastLang, group_id: groupId, slug: null, name, role: '', photo_url, bio: '', linkedin, facebook, twitter, sort_order });
      created = 1;
    }
    if(!created){
      // Create current language minimally
      await db.createTeamMember({ lang: res.locals.lang, group_id: groupId, slug: null, name, role: '', photo_url, bio: '', linkedin, facebook, twitter, sort_order });
    }
    res.redirect(`/admin/team?lang=${res.locals.lang}&success=created`);
  } catch (e) {
    return res.status(500).render('admin-team-form', { lang: res.locals.lang, member: null, membersByLang: null, error: e?.message || 'Beklenmeyen bir hata oluştu.' });
  }
});

app.get('/admin/team/:id/edit', basicAuth, async (req,res)=>{
  if(!useDb) return res.status(501).send('Team requires DB backend');
  const member = await db.getTeamMember(req.params.id);
  if(!member) return res.status(404).send('Member not found');
  const membersByLang = { en: null, sk: null, hu: null };
  if(member.group_id){
    for(const l of ['en','sk','hu']){
      const mv = await db.getTeamMemberByGroupAndLang?.(member.group_id, l);
      if(mv) membersByLang[l] = mv;
    }
  } else {
    membersByLang[member.lang] = member;
  }
  res.render('admin-team-form', { lang: res.locals.lang, member, membersByLang });
});

app.post('/admin/team/:id', basicAuth, uploadTeam.single('photo'), async (req,res)=>{
  if(!useDb) return res.status(501).send('Team requires DB backend');
  try {
    const body = req.body || {};
    if (!req.body || typeof req.body !== 'object') {
      try { console.warn('Team update: req.body is undefined or not an object. content-type:', req.headers['content-type']); } catch {}
    }
    const existing = await db.getTeamMember(req.params.id);
    if(!existing){
      return res.status(404).send('Member not found');
    }
    const name = (body.name || '').trim();
    if(!name){
      const member = existing;
      return res.status(400).render('admin-team-form', { lang: res.locals.lang, member, membersByLang: null, error: 'Please enter a name.' });
    }
    const { linkedin, facebook, twitter } = body;
    const sort_order = Number.isInteger(parseInt(body.sort_order, 10)) ? parseInt(body.sort_order, 10) : 0;
    let photo_url = existing?.photo_url || null;
    
    // Handle photo removal
    if(body.remove_photo === '1'){
      if(photo_url){
        try {
          await deleteFile(photo_url);
          console.log('[team] Deleted photo:', photo_url);
        } catch (err) {
          console.warn('[team] Failed to delete photo:', err.message);
        }
      }
      photo_url = '';
    }
    
    // Handle new photo upload
    if(req.file){
      try{
        const processed = await processTeamImage(req.file.buffer, req.file.originalname || name);
        // Delete old photo if exists
        if(photo_url && photo_url !== processed.photo_url){
          try {
            await deleteFile(photo_url);
          } catch (err) {
            console.warn('[team] Failed to delete old photo:', err.message);
          }
        }
        photo_url = processed.photo_url;
      }catch(e){
        const member = existing;
        return res.status(400).render('admin-team-form', { lang: res.locals.lang, member, membersByLang: null, error: 'Image could not be processed. Please upload a valid image up to 2 MB.' });
      }
    }
    // Ensure group id for multi-language
    let groupId = existing.group_id;
    if(!groupId){
      groupId = crypto.randomUUID();
      await db.setTeamGroup(existing.id, groupId);
    }
    // Per-language role/bio updates
    const langs = ['en','sk','hu'];
    const rolesPosted = Object.fromEntries(langs.map(l => [l, (body[`role_${l}`] ?? '').toString().trim()]));
    const biosPosted  = Object.fromEntries(langs.map(l => [l, (body[`bio_${l}`]  ?? '').toString().trim()]));
    const sourceLang = langs.find(l => rolesPosted[l] || biosPosted[l]) || null;
    
    for(const l of langs){
      let mv = null;
      try {
        mv = await db.getTeamMemberByGroupAndLang(groupId, l);
      } catch (err) {
        console.warn(`[team] Failed to get member for lang ${l}:`, err.message);
      }
      
      const existingRoleEmpty = !mv || !mv.role || !mv.role.trim();
      const existingBioEmpty  = !mv || !mv.bio  || !mv.bio.trim();
      let newRole = rolesPosted[l];
      let newBio  = biosPosted[l];
      // If not posted, and existing is empty, replicate from source
      if(!newRole && sourceLang && existingRoleEmpty){ newRole = rolesPosted[sourceLang] || ''; }
      if(!newBio  && sourceLang && existingBioEmpty){  newBio  = biosPosted[sourceLang]  || ''; }

      if(mv){
        console.log(`[team] Updating existing member for lang ${l}:`, mv.id);
        // If nothing to change, keep existing values
        await db.updateTeamMember(mv.id, {
          name,
          role: newRole || mv.role || '',
          photo_url,
          bio: newBio || mv.bio || '',
          linkedin, facebook, twitter, sort_order
        });
      } else {
        // Create missing variant if we have any content (posted or replicated)
        if(newRole || newBio){
          console.log(`[team] Creating new member for lang ${l}`);
          await db.createTeamMember({ lang: l, group_id: groupId, slug: null, name, role: newRole || '', photo_url, bio: newBio || '', linkedin, facebook, twitter, sort_order });
        } else {
          console.log(`[team] Skipping lang ${l} - no role or bio`);
        }
      }
    }
    // Propagate shared fields and photo to group
    console.log('[team] Updating photo for group:', groupId, photo_url);
    await db.updateTeamPhotoForGroup(groupId, photo_url || '');
    console.log('[team] Updating shared fields for group:', groupId);
    await db.updateTeamSharedForGroup(groupId, { name, linkedin, facebook, twitter, sort_order });
    console.log('[team] Redirecting to list...');
    res.redirect(`/admin/team?lang=${res.locals.lang}&success=updated`);
  } catch (e) {
    console.error('[team] Update error:', e);
    const member = await db.getTeamMember(req.params.id).catch(() => null);
    return res.status(500).render('admin-team-form', { lang: res.locals.lang, member, membersByLang: null, error: e?.message || 'Beklenmeyen bir hata oluştu.' });
  }
});

app.post('/admin/team/:id/delete', basicAuth, async (req,res)=>{
  if(!useDb) return res.status(501).send('Team requires DB backend');
  try {
    const base = await db.getTeamMember(req.params.id).catch(() => null);
    if(base?.group_id && typeof db.deleteTeamGroup === 'function'){
      await db.deleteTeamGroup(base.group_id);
    } else {
      await db.deleteTeamMember(req.params.id);
    }
    res.redirect(`/admin/team?lang=${res.locals.lang}&success=deleted`);
  } catch (e) {
    res.redirect(`/admin/team?lang=${res.locals.lang}&error=delete_failed`);
  }
});

// Partners management (DB only)
const uploadPartner = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if(!/^image\//.test(file.mimetype)){
      return cb(null, false);
    }
    cb(null, true);
  },
  limits: { fileSize: 2 * 1024 * 1024 } // 2 MB
});

async function processPartnerLogo(buffer, originalname){
  try {
    const ext = '.png';
    const baseName = safeSlugFilename(path.basename(originalname || 'partner', path.extname(originalname || 'partner')), ext);
    const fileName = `${baseName}--${Date.now()}${ext}`;
    const filePath = `/uploads/partners/${fileName}`;
    
    // Resize logo (300x300, contain with white background)
    const resizedBuffer = await sharp(buffer)
      .resize(300, 300, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .png()
      .toBuffer();
    
    await uploadFile(filePath, resizedBuffer);
    console.log('[partners] Saved logo:', filePath);
    return { logo_url: filePath };
  } catch (err) {
    console.error('[partners] Failed to process logo:', err.message);
    // Return default logo on processing error
    return { logo_url: '/img/default-partner.png' };
  }
}

app.get('/admin/partners', basicAuth, async (req,res)=>{
  if(!useDb) return res.status(501).send('Partners requires DB backend');
  const partners = await db.listPartners();
  const success = req.query.success;
  res.render('admin-partners-list', { partners, lang: res.locals.lang, useDb: true, active: 'partners', success });
});

app.get('/admin/partners/new', basicAuth, async (req,res)=>{
  if(!useDb) return res.status(501).send('Partners requires DB backend');
  res.render('admin-partners-form', { lang: res.locals.lang, useDb: true, active: 'partners', partner: null });
});

app.post('/admin/partners', basicAuth, uploadPartner.single('logo'), async (req,res)=>{
  if(!useDb) return res.status(501).send('Partners requires DB backend');
  try {
    const name = (req.body.name || '').trim();
    const sort_order = parseInt(req.body.sort_order, 10) || 0;
    
    if(!name){
      return res.status(400).render('admin-partners-form', { 
        lang: res.locals.lang, 
        useDb: true, 
        active: 'partners', 
        partner: null, 
        error: 'Please enter a partner name.' 
      });
    }
    
    let logo_url = '/img/default-partner.png'; // Default logo
    if(req.file){
      const processed = await processPartnerLogo(req.file.buffer, req.file.originalname || name);
      logo_url = processed.logo_url;
    }
    
    await db.createPartner({ name, logo_url, sort_order });
    res.redirect(`/admin/partners?lang=${res.locals.lang}&success=created`);
  } catch (e) {
    return res.status(500).render('admin-partners-form', { 
      lang: res.locals.lang, 
      useDb: true, 
      active: 'partners', 
      partner: null, 
      error: e?.message || 'An error occurred.' 
    });
  }
});

app.get('/admin/partners/:id/edit', basicAuth, async (req,res)=>{
  if(!useDb) return res.status(501).send('Partners requires DB backend');
  const partner = await db.getPartner(req.params.id);
  if(!partner) return res.status(404).send('Partner not found');
  res.render('admin-partners-form', { lang: res.locals.lang, useDb: true, active: 'partners', partner });
});

app.post('/admin/partners/:id', basicAuth, uploadPartner.single('logo'), async (req,res)=>{
  if(!useDb) return res.status(501).send('Partners requires DB backend');
  try {
    const existing = await db.getPartner(req.params.id);
    if(!existing) return res.status(404).send('Partner not found');
    
    const name = (req.body.name || '').trim();
    const sort_order = parseInt(req.body.sort_order, 10) || 0;
    
    if(!name){
      return res.status(400).render('admin-partners-form', { 
        lang: res.locals.lang, 
        useDb: true, 
        active: 'partners', 
        partner: existing, 
        error: 'Please enter a partner name.' 
      });
    }
    
    let logo_url = existing.logo_url || '/img/default-partner.png';
    
    // Handle logo removal
    if(req.body.remove_logo === '1'){
      if(logo_url && logo_url !== '/img/default-partner.png'){
        try {
          await deleteFile(logo_url);
          console.log('[partners] Deleted logo:', logo_url);
        } catch (err) {
          console.warn('[partners] Failed to delete logo:', err.message);
        }
      }
      logo_url = '/img/default-partner.png';
    }
    
    // Handle new logo upload
    if(req.file){
      const processed = await processPartnerLogo(req.file.buffer, req.file.originalname || name);
      // Delete old logo if exists and not default
      if(logo_url && logo_url !== processed.logo_url && logo_url !== '/img/default-partner.png'){
        try {
          await deleteFile(logo_url);
        } catch (err) {
          console.warn('[partners] Failed to delete old logo:', err.message);
        }
      }
      logo_url = processed.logo_url;
    }
    
    await db.updatePartner(req.params.id, { name, logo_url, sort_order });
    res.redirect(`/admin/partners?lang=${res.locals.lang}&success=updated`);
  } catch (e) {
    return res.status(500).send(e?.message || 'An error occurred.');
  }
});

app.post('/admin/partners/:id/delete', basicAuth, async (req,res)=>{
  if(!useDb) return res.status(501).send('Partners requires DB backend');
  try {
    const partner = await db.getPartner(req.params.id);
    if(partner?.logo_url){
      try {
        await deleteFile(partner.logo_url);
      } catch (err) {
        console.warn('[partners] Failed to delete logo:', err.message);
      }
    }
    await db.deletePartner(req.params.id);
    res.redirect(`/admin/partners?lang=${res.locals.lang}&success=deleted`);
  } catch (e) {
    res.redirect(`/admin/partners?lang=${res.locals.lang}&error=delete_failed`);
  }
});

// News management (DB only)
app.get('/admin/news', basicAuth, async (req,res)=>{
  if(!useDb) return res.status(501).send('News requires DB backend');
  const news = await db.listNews(res.locals.lang);
  const success = req.query.success;
  res.render('admin-news-list', { news, lang: res.locals.lang, useDb: true, active: 'news', success });
});

app.get('/admin/news/new', basicAuth, async (req,res)=>{
  if(!useDb) return res.status(501).send('News requires DB backend');
  res.render('admin-news-form', { lang: res.locals.lang, useDb: true, active: 'news', news: null });
});

app.post('/admin/news', basicAuth, uploadImages.any(), async (req,res)=>{
  if(!useDb) return res.status(501).send('News requires DB backend');
  const hasMulti = (req.body.title_en||'').trim() || (req.body.title_sk||'').trim() || (req.body.title_hu||'').trim();
  if(!hasMulti){
  return res.status(400).render('admin-news-form', { lang: res.locals.lang, useDb: true, active: 'news', news: null, error: 'Please provide a title for at least one language.' });
  }
  const langs = ['en','sk','hu'];
  const groupId = crypto.randomUUID();
  const { published_at, is_published } = req.body;
  let lastNewsId = null;
  // Collect and replicate missing fields from first provided language
  const titles = { en: (req.body.title_en||'').trim(), sk: (req.body.title_sk||'').trim(), hu: (req.body.title_hu||'').trim() };
  const summaries = { en: (req.body.summary_en||'').trim(), sk: (req.body.summary_sk||'').trim(), hu: (req.body.summary_hu||'').trim() };
  const contents = { en: (req.body.content_en||'').trim(), sk: (req.body.content_sk||'').trim(), hu: (req.body.content_hu||'').trim() };
  const slugsProvided = { en: (req.body.slug_en||'').trim(), sk: (req.body.slug_sk||'').trim(), hu: (req.body.slug_hu||'').trim() };
  const sourceLang = langs.find(l => titles[l]);
  if(sourceLang){
    for(const l of langs){
      if(!titles[l]) titles[l] = titles[sourceLang];
      if(!summaries[l]) summaries[l] = summaries[sourceLang];
      if(!contents[l]) contents[l] = contents[sourceLang];
    }
  }
  for(const l of langs){
    const title = titles[l];
    const summary = summaries[l] || '';
    const content = contents[l] || '';
    const providedSlug = slugsProvided[l] || '';
    const base = providedSlug ? slugify(providedSlug) : slugify(title || 'news');
    const slug = await uniqueNewsSlug(l, base);
    const news = await db.createNews({ lang: l, group_id: groupId, slug, title: title || 'News', summary, content, image_url: null, published_at, is_published });
    lastNewsId = news.id;
  }
    
    // Handle additional images for the last created news (representing the group)
    const filesArr = Array.isArray(req.files) ? req.files : [];
    const additionalFiles = filesArr.filter(f => typeof f.fieldname === 'string' && f.fieldname.startsWith('additional_images'));
    
    if(additionalFiles.length > 0 && lastNewsId) {
      // Upload images to storage
      const imageUrls = [];
      for (const file of additionalFiles) {
        const optimized = await optimizeImageBuffer(file.buffer);
        const filename = generateFilename(file.originalname, 'news');
        const url = await uploadFile(optimized, filename, file.mimetype);
        imageUrls.push(url);
      }
      
      await db.addAdditionalImages('news', lastNewsId, imageUrls);
      const lead = imageUrls[0];
      if(db.updateNewsImageForGroup){
        await db.updateNewsImageForGroup(lastNewsId, lead);
      } else {
        const existing = await db.getNews(lastNewsId);
        await db.updateNews(lastNewsId, { title: existing.title, summary: existing.summary, content: existing.content, slug: existing.slug, published_at: existing.published_at, is_published: existing.is_published, image_url: lead });
      }
    }
    
  return res.redirect(`/admin/news?lang=${res.locals.lang}&success=created`);
});

app.get('/admin/news/:id/edit', basicAuth, async (req,res)=>{
  if(!useDb) return res.status(501).send('News requires DB backend');
  const news = await db.getNews(req.params.id);
  if(!news) return res.status(404).send('News not found');
  const langs = ['en','sk','hu'];
  const newsByLang = { en: null, sk: null, hu: null };
  let additionalImages = [];
  try{
    if(news.group_id){
      for(const l of langs){
        const nv = await db.getNewsByGroupAndLang?.(news.group_id, l);
        newsByLang[l] = nv || null;
      }
    } else {
      newsByLang[news.lang] = news;
    }
    const ownerId = await resolveNewsGalleryOwnerId(news);
    additionalImages = await db.getAdditionalImages('news', ownerId);
  }catch{}
  res.render('admin-news-form', { lang: res.locals.lang, useDb: true, active: 'news', news, newsByLang, additionalImages });
});

app.post('/admin/news/:id', basicAuth, uploadImages.any(), async (req,res)=>{
  if(!useDb) return res.status(501).send('News requires DB backend');
  const base = await db.getNews(req.params.id);
  if(!base) return res.status(404).send('News not found');

  // Ensure grouped editing
  let groupId = base.group_id;
  if(!groupId){
    groupId = crypto.randomUUID();
    await db.setNewsGroup(base.id, groupId);
  }

  // Gallery management: remove selected, add new uploads, update lead image
  try {
    const ownerId = await resolveNewsGalleryOwnerId(base);
    const existing = await db.getAdditionalImages('news', ownerId);
    const removeIdsRaw = req.body.remove_image_ids;
    const removeIds = Array.isArray(removeIdsRaw) ? removeIdsRaw : (removeIdsRaw ? [removeIdsRaw] : []);
    const removeSet = new Set(removeIds.map(id => Number(id)));
    const kept = existing.filter(img => !removeSet.has(Number(img.id)));

    const filesArr = Array.isArray(req.files) ? req.files : [];
    const newFiles = filesArr.filter(f => typeof f.fieldname === 'string' && f.fieldname.startsWith('additional_images'));
    
    // Upload new images to storage
    const newItems = [];
    for (let idx = 0; idx < newFiles.length; idx++) {
      const file = newFiles[idx];
      const optimized = await optimizeImageBuffer(file.buffer);
      const filename = generateFilename(file.originalname, 'news');
      const url = await uploadFile(optimized, filename, file.mimetype);
      newItems.push({ image_url: url, alt_text: '', sort_order: kept.length + idx });
    }

    const finalItems = [
      ...kept.map((img, idx) => ({ image_url: img.image_url, alt_text: img.alt_text || '', sort_order: idx })),
      ...newItems
    ];

    if(db.replaceAdditionalImageItems){
      await db.replaceAdditionalImageItems('news', ownerId, finalItems);
    } else {
      await db.deleteAdditionalImages('news', ownerId);
      if(finalItems.length){
        await db.addAdditionalImages('news', ownerId, finalItems.map(i => i.image_url));
      }
    }

    const selectedLead = (req.body.lead_image_url || '').trim();
    let newLead = selectedLead;
    const leadRemoved = base.image_url && !finalItems.find(i => i.image_url === base.image_url);
    if(!newLead && (leadRemoved || !base.image_url)){
      newLead = finalItems[0]?.image_url || null;
    }
    if(typeof db.updateNewsImageForGroup === 'function'){
      await db.updateNewsImageForGroup(ownerId, newLead || null);
    } else if(newLead !== undefined){
      await db.updateNews(ownerId, { title: base.title, content: base.content, summary: base.summary, slug: base.slug, is_published: base.is_published, published_at: base.published_at, image_url: newLead || null });
    }
  } catch (e) {
    console.error('News gallery update failed', e);
  }

  const langs = ['en','sk','hu'];
  // Collect posted fields per lang
  const posted = Object.fromEntries(langs.map(l => [l, {
    title: (req.body[`title_${l}`] || '').trim(),
    summary: (req.body[`summary_${l}`] || '').trim(),
    content: (req.body[`content_${l}`] || '').trim(),
    slug: (req.body[`slug_${l}`] || '').trim(),
    published_at: (req.body[`published_at_${l}`] || '').trim(),
    is_published_posted: typeof req.body[`is_published_${l}`] !== 'undefined',
    is_published_val: (req.body[`is_published_${l}`] === 'true' || req.body[`is_published_${l}`] === 'on')
  }]));
  const sourceLang = langs.find(l => posted[l].title || posted[l].summary || posted[l].content) || null;
  for(const l of langs){
    const nv = await db.getNewsByGroupAndLang(groupId, l);
    // Compute new values: prefer posted; if missing and existing empty, copy from source
    let newTitle = posted[l].title;
    let newSummary = posted[l].summary;
    let newContent = posted[l].content;
    const existingTitleEmpty = !nv || !nv.title || !nv.title.trim();
    const existingSummaryEmpty = !nv || !nv.summary || !nv.summary.trim();
    const existingContentEmpty = !nv || !nv.content || !nv.content.trim();
    if(sourceLang){
      if(!newTitle && existingTitleEmpty) newTitle = posted[sourceLang].title || null;
      if(!newSummary && existingSummaryEmpty) newSummary = posted[sourceLang].summary || null;
      if(!newContent && existingContentEmpty) newContent = posted[sourceLang].content || null;
    }
    const providedSlug = posted[l].slug;
    if(nv){
      const hasAny = newTitle || newSummary || newContent || providedSlug || posted[l].published_at || posted[l].is_published_posted;
      if(!hasAny) continue;
      await db.updateNews(nv.id, {
        title: newTitle || nv.title,
        summary: (newSummary !== undefined && newSummary !== null && newSummary !== '') ? newSummary : nv.summary,
        content: (newContent !== undefined && newContent !== null && newContent !== '') ? newContent : nv.content,
        slug: providedSlug || nv.slug,
        published_at: posted[l].published_at || nv.published_at,
        is_published: posted[l].is_published_posted ? posted[l].is_published_val : nv.is_published,
        image_url: nv.image_url
      });
    } else {
      const titleToUse = newTitle || (sourceLang ? posted[sourceLang].title : '') || base.title;
      const summaryToUse = (newSummary !== undefined && newSummary !== null && newSummary !== '') ? newSummary : ((sourceLang ? posted[sourceLang].summary : '') || base.summary || '');
      const contentToUse = (newContent !== undefined && newContent !== null && newContent !== '') ? newContent : ((sourceLang ? posted[sourceLang].content : '') || base.content || '');
      if(titleToUse){
        const baseSlug = providedSlug ? slugify(providedSlug) : (base.slug || slugify(titleToUse));
        const slug = await uniqueNewsSlug(l, baseSlug);
        await db.createNews({
          lang: l,
          group_id: groupId,
          slug,
          title: titleToUse,
          summary: summaryToUse,
          content: contentToUse,
          image_url: base.image_url,
          published_at: posted[l].published_at || base.published_at,
          is_published: posted[l].is_published_posted ? posted[l].is_published_val : (base.is_published !== false)
        });
      }
    }
  }

  // Also support single-language fields for backward compatibility
  const { title, summary, content, slug, published_at, is_published } = req.body;
  if(title || summary || content || slug || published_at || typeof is_published !== 'undefined'){
    await db.updateNews(base.id, { 
      title: title || base.title,
      summary: summary || base.summary,
      content: content || base.content,
      slug: slug || base.slug,
      published_at: published_at || base.published_at,
      is_published: typeof is_published !== 'undefined' ? (is_published === 'true' || is_published === 'on') : base.is_published
    });
  }

  res.redirect(`/admin/news?lang=${res.locals.lang}&success=updated`);
});

app.post('/admin/news/:id/delete', basicAuth, async (req,res)=>{
  if(!useDb) return res.status(501).send('News requires DB backend');
  try {
    const base = await db.getNews(req.params.id).catch(() => null);
    if(base?.group_id && typeof db.deleteNewsGroup === 'function'){
      await db.deleteNewsGroup(base.group_id);
    } else {
      await db.deleteNews(req.params.id);
    }
    res.redirect(`/admin/news?lang=${res.locals.lang}&success=deleted`);
  } catch (e) {
    res.redirect(`/admin/news?lang=${res.locals.lang}&error=delete_failed`);
  }
});

// Settings (homepage slider etc.) (DB only)
// Settings landing redirects to slider
app.get('/admin/settings', basicAuth, async (req, res) => {
  return res.redirect(`/admin/settings/slider?lang=${res.locals.lang}`);
});

// Settings: Slider
app.get('/admin/settings/slider', basicAuth, async (req, res) => {
  if(!useDb) return res.status(501).send('Settings require DB backend');
  const cfg_en = await db.getSettings('en');
  const cfg_sk = await db.getSettings('sk');
  const cfg_hu = await db.getSettings('hu');
  const cfgs = {
    en: {
      slider: Array.isArray(cfg_en?.slider) ? cfg_en.slider : [],
      slider_bg_image_url: cfg_en?.slider_bg_image_url || '',
      slider_bg_gallery: Array.isArray(cfg_en?.slider_bg_gallery) ? cfg_en.slider_bg_gallery : [],
      slider_text_align: cfg_en?.slider_text_align || 'center',
      slider_title_color: cfg_en?.slider_title_color || '#ffffff',
      slider_caption_color: cfg_en?.slider_caption_color || '#ffffff'
    },
    sk: {
      slider: Array.isArray(cfg_sk?.slider) ? cfg_sk.slider : [],
      slider_bg_image_url: cfg_sk?.slider_bg_image_url || '',
      slider_bg_gallery: Array.isArray(cfg_sk?.slider_bg_gallery) ? cfg_sk.slider_bg_gallery : (Array.isArray(cfg_en?.slider_bg_gallery) ? cfg_en.slider_bg_gallery : []),
      slider_text_align: cfg_sk?.slider_text_align || (cfg_en?.slider_text_align || 'center'),
      slider_title_color: cfg_sk?.slider_title_color || (cfg_en?.slider_title_color || '#ffffff'),
      slider_caption_color: cfg_sk?.slider_caption_color || (cfg_en?.slider_caption_color || '#ffffff')
    },
    hu: {
      slider: Array.isArray(cfg_hu?.slider) ? cfg_hu.slider : [],
      slider_bg_image_url: cfg_hu?.slider_bg_image_url || '',
      slider_bg_gallery: Array.isArray(cfg_hu?.slider_bg_gallery) ? cfg_hu.slider_bg_gallery : (Array.isArray(cfg_en?.slider_bg_gallery) ? cfg_en.slider_bg_gallery : []),
      slider_text_align: cfg_hu?.slider_text_align || (cfg_en?.slider_text_align || 'center'),
      slider_title_color: cfg_hu?.slider_title_color || (cfg_en?.slider_title_color || '#ffffff'),
      slider_caption_color: cfg_hu?.slider_caption_color || (cfg_en?.slider_caption_color || '#ffffff')
    },
  };
  // If gallery is empty but a selected URL exists, show it in the gallery for convenience
  for (const l of ['en','sk','hu']){
    const c = cfgs[l];
    if (c && (!Array.isArray(c.slider_bg_gallery) || c.slider_bg_gallery.length === 0) && c.slider_bg_image_url){
      c.slider_bg_gallery = [c.slider_bg_image_url];
    }
  }
  return res.render('admin-settings-slider', { cfgs, lang: res.locals.lang, useDb, active: 'settings-slider' });
});

// Settings: Slider save
app.post('/admin/settings/slider', basicAuth, uploadImages.any(), async (req, res) => {
  if(!useDb) return res.status(501).send('Settings require DB backend');
  const langs = ['en','sk','hu'];
  const sliders = { en: [], sk: [], hu: [] };
  // If no slide fields at all are posted (e.g., user removed all slides), clear sliders immediately
  const bodyKeys = Object.keys(req.body || {});
  const hasAnySlideField = bodyKeys.some(k => /^slide\d+_/.test(k));
  const hasAnySlideFile = Array.isArray(req.files) && req.files.some(f => /^slide\d+_/.test(f.fieldname || ''));
  const hasAnyBgField = ('slider_bg_selected' in req.body) || ('slider_bg_existing' in req.body);
  const hasAnyBgFile = Array.isArray(req.files) && req.files.some(f => /^(slider_bg_image|slider_bg_images(\[\])?)$/.test(f.fieldname || ''));
  const hasAnyTextSetting = ('slider_text_align' in req.body) || ('slider_title_color' in req.body) || ('slider_caption_color' in req.body);
  if(!hasAnySlideField && !hasAnySlideFile && !hasAnyBgField && !hasAnyBgFile && !hasAnyTextSetting){
    const [cur_en, cur_sk, cur_hu] = await Promise.all([
      db.getSettings('en').catch(()=>({})) || {},
      db.getSettings('sk').catch(()=>({})) || {},
      db.getSettings('hu').catch(()=>({})) || {}
    ]);
    await Promise.all([
      db.updateSettings('en', { ...cur_en, slider: [] }),
      db.updateSettings('sk', { ...cur_sk, slider: [] }),
      db.updateSettings('hu', { ...cur_hu, slider: [] })
    ]);
    return res.redirect(`/admin/settings/slider?lang=${res.locals.lang}`);
  }
  // Derive indices from posted field names to be resilient to client-side mismatches
  const idxSet = new Set();
  for (const key of Object.keys(req.body || {})){
    const m = key.match(/^slide(\d+)_/);
    if(m) idxSet.add(parseInt(m[1],10));
  }
  let indices = Array.from(idxSet).filter(n => Number.isInteger(n) && n >= 0).sort((a,b)=>a-b);
  // Fallback to slides_count only if we couldn't detect indices
  if(indices.length === 0){
    const count = Math.max(parseInt(req.body.slides_count || '0', 10) || 0, 0);
    indices = Array.from({length: count}, (_,i)=>i);
  }
  // map files by fieldname for quick lookup
  const filesByField = Object.create(null);
  for (const f of (req.files || [])) {
    // Keep last wins for same field name
    filesByField[f.fieldname] = f;
  }
  // Background gallery management
  const cur_en = await db.getSettings('en').catch(()=>({})) || {};
  const cur_sk = await db.getSettings('sk').catch(()=>({})) || {};
  const cur_hu = await db.getSettings('hu').catch(()=>({})) || {};
  let gallery = Array.isArray(cur_en.slider_bg_gallery) ? [...cur_en.slider_bg_gallery] : [];
  // Collect newly uploaded background images (support single and multiple)
  const uploaded = [];
  for (const f of (req.files || [])){
    const fname = f.fieldname || '';
    if (fname === 'slider_bg_image' || fname === 'slider_bg_images' || fname === 'slider_bg_images[]'){
      const optimized = await optimizeImageBuffer(f.buffer);
      const filename = generateFilename(f.originalname, 'slider');
      const url = await uploadFile(optimized, filename, f.mimetype);
      uploaded.push(url);
    }
  }
  if (uploaded.length){
    gallery = gallery.concat(uploaded);
  }
  // Deduplicate gallery while preserving order
  const seen = new Set();
  gallery = gallery.filter(u => { if(!u) return false; if(seen.has(u)) return false; seen.add(u); return true; });
  // Determine selected background
  const postedSelected = (req.body['slider_bg_selected'] || '').trim();
  const postedRadio = (req.body['bg_choice'] || '').trim();
  const globalExistingBg = (req.body['slider_bg_existing'] || '').trim();
  let sliderBgUrl = '';
  const chosen = postedSelected || postedRadio;
  if (chosen && (gallery.includes(chosen) || uploaded.includes(chosen) || /^https?:\/\//i.test(chosen))){
    sliderBgUrl = chosen;
  } else if (uploaded.length){
    sliderBgUrl = uploaded[uploaded.length - 1];
  } else if (globalExistingBg){
    sliderBgUrl = globalExistingBg;
  } else if (cur_en.slider_bg_image_url && gallery.includes(cur_en.slider_bg_image_url)){
    sliderBgUrl = cur_en.slider_bg_image_url;
  } else if (gallery.length){
    sliderBgUrl = gallery[0];
  }
  // Ensure selected is present in gallery for visibility next time
  if (sliderBgUrl && !gallery.includes(sliderBgUrl)){
    gallery.unshift(sliderBgUrl);
  }
  for(const i of indices){
    const link = (req.body[`slide${i}_link`] || '').trim();
    // Gather titles/captions to compute fallbacks across languages
    const titles = {
      en: (req.body[`slide${i}_title_en`] || '').trim(),
      sk: (req.body[`slide${i}_title_sk`] || '').trim(),
      hu: (req.body[`slide${i}_title_hu`] || '').trim(),
    };
    const captions = {
      en: (req.body[`slide${i}_caption_en`] || '').trim(),
      sk: (req.body[`slide${i}_caption_sk`] || '').trim(),
      hu: (req.body[`slide${i}_caption_hu`] || '').trim(),
    };
    // if every field is empty across all langs and no link, skip this slide entirely
    const hasAny = link || titles.en || titles.sk || titles.hu || captions.en || captions.sk || captions.hu;
    if(!hasAny) continue;
    for(const l of langs){
      // Preserve intentionally blank strings from the form (do not override with fallback)
      const title = (typeof titles[l] === 'string') ? titles[l] : '';
      const caption = (typeof captions[l] === 'string') ? captions[l] : '';
      sliders[l].push({ title, caption, link });
    }
  }
  const alignRaw = (req.body.slider_text_align || '').toLowerCase();
  const slider_text_align = ['left','center','right'].includes(alignRaw) ? alignRaw : (cur_en.slider_text_align || 'center');
  const slider_title_color = (req.body.slider_title_color || cur_en.slider_title_color || '#ffffff');
  const slider_caption_color = (req.body.slider_caption_color || cur_en.slider_caption_color || '#ffffff');
  await db.updateSettings('en', { ...cur_en, slider: sliders.en, slider_bg_image_url: sliderBgUrl || cur_en.slider_bg_image_url || '', slider_bg_gallery: gallery, slider_text_align, slider_title_color, slider_caption_color });
  await db.updateSettings('sk', { ...cur_sk, slider: sliders.sk, slider_bg_image_url: sliderBgUrl || cur_sk.slider_bg_image_url || '', slider_bg_gallery: gallery, slider_text_align, slider_title_color, slider_caption_color });
  await db.updateSettings('hu', { ...cur_hu, slider: sliders.hu, slider_bg_image_url: sliderBgUrl || cur_hu.slider_bg_image_url || '', slider_bg_gallery: gallery, slider_text_align, slider_title_color, slider_caption_color });
  res.redirect(`/admin/settings/slider?lang=${res.locals.lang}`);
});

// Delete a background image from the gallery
app.post('/admin/settings/slider/bg/delete', basicAuth, express.json(), async (req, res) => {
  if(!useDb) return res.status(501).send('Settings require DB backend');
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' });
    
    // Retry wrapper for DB operations with timeout recovery
    const withRetry = async (fn, maxRetries = 2) => {
      for (let i = 0; i < maxRetries; i++) {
        try {
          return await fn();
        } catch (err) {
          if (i === maxRetries - 1) throw err;
          if (err.message?.includes('timeout') || err.message?.includes('Connection terminated')) {
            console.warn(`[slider/bg/delete] Retry ${i+1}/${maxRetries} after timeout`);
            await new Promise(r => setTimeout(r, 300));
            continue;
          }
          throw err;
        }
      }
    };
    
    const cur_en = await withRetry(() => db.getSettings('en').catch(()=>({}))) || {};
    let gallery = Array.isArray(cur_en.slider_bg_gallery) ? cur_en.slider_bg_gallery : [];
    const idx = gallery.indexOf(url);
    const langs = ['en','sk','hu'];
    const cfgs = await withRetry(() => Promise.all(langs.map(l => db.getSettings(l).catch(()=>({})))));
    if (idx === -1) {
      // Not in gallery; allow deletion if it's currently selected in any language
      let isSelectedSomewhere = false;
      for (let i=0;i<langs.length;i++){
        const cur = cfgs[i] || {};
        if ((cur.slider_bg_image_url || '') === url) { isSelectedSomewhere = true; break; }
      }
      if (!isSelectedSomewhere) {
        return res.status(404).json({ error: 'not-in-gallery' });
      }
      // Clear selection for all languages where it matches
      for (let i=0;i<langs.length;i++){
        const l = langs[i];
        const cur = cfgs[i] || {};
        const sel = (cur.slider_bg_image_url === url) ? '' : (cur.slider_bg_image_url || '');
        await withRetry(() => db.updateSettings(l, { ...cur, slider_bg_image_url: sel }));
      }
      // Delete file from storage (Blob or local disk)
      try {
        await deleteFile(url);
        console.log('[slider/bg/delete] Deleted from storage:', url);
      } catch (err) {
        console.warn('[slider/bg/delete] Storage delete failed:', err.message);
      }
      return res.json({ ok: true, clearedSelected: true });
    }
    // Remove from gallery and fix selection
    gallery.splice(idx, 1);
    for (let i=0;i<langs.length;i++){
      const l = langs[i];
      const cur = cfgs[i] || {};
      let sel = cur.slider_bg_image_url || '';
      if (sel === url){ sel = gallery[0] || ''; }
      await withRetry(() => db.updateSettings(l, { ...cur, slider_bg_gallery: gallery, slider_bg_image_url: sel }));
    }
    // Delete file from storage (Blob or local disk)
    try {
      await deleteFile(url);
      console.log('[slider/bg/delete] Deleted from storage:', url);
    } catch (err) {
      console.warn('[slider/bg/delete] Storage delete failed:', err.message);
    }
    return res.json({ ok: true, removedFromGallery: true });
  } catch (e) {
    console.error('[slider/bg/delete] Error:', e);
    return res.status(500).json({ error: 'failed', message: e.message });
  }
});

// Migrate local uploads to Vercel Blob Storage (admin utility)
app.post('/admin/migrate-uploads-to-blob', basicAuth, express.json(), async (req, res) => {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({ 
      error: 'BLOB_READ_WRITE_TOKEN not configured',
      message: 'Vercel Blob Storage token is required for migration'
    });
  }

  try {
    console.log('[migrate] Starting upload migration to Blob Storage...');
    
    const report = {
      scanned: 0,
      uploaded: 0,
      failed: 0,
      dbUpdates: 0,
      errors: [],
      startTime: Date.now()
    };

    // Helper: Get all files recursively from local uploads
    const getLocalFiles = () => {
      const files = [];
      const uploadsDir = path.join(__dirname, 'public', 'uploads');
      
      if (!fsSync.existsSync(uploadsDir)) {
        return files;
      }

      const scanDir = (dir, baseDir = dir) => {
        const items = fsSync.readdirSync(dir);
        for (const item of items) {
          if (item === '.gitkeep') continue;
          const fullPath = path.join(dir, item);
          const stat = fsSync.statSync(fullPath);
          
          if (stat.isDirectory()) {
            scanDir(fullPath, baseDir);
          } else {
            const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
            files.push({
              fullPath,
              relativePath,
              size: stat.size,
              oldUrl: `/uploads/${relativePath}`
            });
          }
        }
      };

      scanDir(uploadsDir);
      return files;
    };

    // Helper: Upload file to Blob
    const uploadToBlob = async (file) => {
      const buffer = fsSync.readFileSync(file.fullPath);
      const ext = path.extname(file.relativePath).toLowerCase();
      
      const contentTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.pdf': 'application/pdf',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.xls': 'application/vnd.ms-excel',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      };
      
      const contentType = contentTypes[ext] || 'application/octet-stream';
      return await uploadFile(buffer, file.relativePath, contentType);
    };

    // Helper: Update database URLs
    const updateDatabaseUrls = async (oldUrl, newUrl) => {
      const updates = [];
      
      // 1. Events
      const events = await db.query('SELECT id, data FROM events');
      for (const event of events.rows) {
        const data = event.data || {};
        let changed = false;
        
        if (data.lead_image_url === oldUrl) {
          data.lead_image_url = newUrl;
          changed = true;
        }
        
        if (Array.isArray(data.images)) {
          const idx = data.images.indexOf(oldUrl);
          if (idx !== -1) {
            data.images[idx] = newUrl;
            changed = true;
          }
        }
        
        if (changed) {
          await db.query('UPDATE events SET data = $1 WHERE id = $2', [data, event.id]);
          updates.push(`Event #${event.id}`);
        }
      }
      
      // 2. News
      const news = await db.query('SELECT id, data FROM news');
      for (const article of news.rows) {
        const data = article.data || {};
        let changed = false;
        
        if (data.lead_image_url === oldUrl) {
          data.lead_image_url = newUrl;
          changed = true;
        }
        
        if (Array.isArray(data.images)) {
          const idx = data.images.indexOf(oldUrl);
          if (idx !== -1) {
            data.images[idx] = newUrl;
            changed = true;
          }
        }
        
        if (changed) {
          await db.query('UPDATE news SET data = $1 WHERE id = $2', [data, article.id]);
          updates.push(`News #${article.id}`);
        }
      }
      
      // 3. Themes
      const themes = await db.query('SELECT id, data FROM themes');
      for (const theme of themes.rows) {
        const data = theme.data || {};
        let changed = false;
        
        if (data.lead_image_url === oldUrl) {
          data.lead_image_url = newUrl;
          changed = true;
        }
        
        if (Array.isArray(data.images)) {
          const idx = data.images.indexOf(oldUrl);
          if (idx !== -1) {
            data.images[idx] = newUrl;
            changed = true;
          }
        }
        
        if (changed) {
          await db.query('UPDATE themes SET data = $1 WHERE id = $2', [data, theme.id]);
          updates.push(`Theme #${theme.id}`);
        }
      }
      
      // 4. Team
      const team = await db.query('SELECT id, data FROM team');
      for (const member of team.rows) {
        const data = member.data || {};
        let changed = false;
        
        if (data.photo_url === oldUrl) {
          data.photo_url = newUrl;
          changed = true;
        }
        
        if (data.thumbnail_url === oldUrl) {
          data.thumbnail_url = newUrl;
          changed = true;
        }
        
        if (changed) {
          await db.query('UPDATE team SET data = $1 WHERE id = $2', [data, member.id]);
          updates.push(`Team #${member.id}`);
        }
      }
      
      // 5. Documents
      const docs = await db.query('SELECT id, data FROM documents');
      for (const doc of docs.rows) {
        const data = doc.data || {};
        
        if (data.file_url === oldUrl) {
          data.file_url = newUrl;
          await db.query('UPDATE documents SET data = $1 WHERE id = $2', [data, doc.id]);
          updates.push(`Document #${doc.id}`);
        }
      }
      
      // 6. Pages
      const pages = await db.query('SELECT id, data FROM pages');
      for (const page of pages.rows) {
        const data = page.data || {};
        let changed = false;
        
        if (data.image_url === oldUrl) {
          data.image_url = newUrl;
          changed = true;
        }
        
        if (data.cover_image_url === oldUrl) {
          data.cover_image_url = newUrl;
          changed = true;
        }
        
        if (changed) {
          await db.query('UPDATE pages SET data = $1 WHERE id = $2', [data, page.id]);
          updates.push(`Page #${page.id}`);
        }
      }
      
      // 7. Settings (slider backgrounds)
      const settings = await db.query('SELECT lang, data FROM settings');
      for (const setting of settings.rows) {
        const data = setting.data || {};
        let changed = false;
        
        if (data.slider_bg_image_url === oldUrl) {
          data.slider_bg_image_url = newUrl;
          changed = true;
        }
        
        if (Array.isArray(data.slider_bg_gallery)) {
          const idx = data.slider_bg_gallery.indexOf(oldUrl);
          if (idx !== -1) {
            data.slider_bg_gallery[idx] = newUrl;
            changed = true;
          }
        }
        
        if (changed) {
          await db.query('UPDATE settings SET data = $1 WHERE lang = $2', [data, setting.lang]);
          updates.push(`Settings (${setting.lang})`);
        }
      }
      
      return updates;
    };

    // Main migration logic
    const files = getLocalFiles();
    report.scanned = files.length;
    
    console.log(`[migrate] Found ${files.length} files to migrate`);
    
    if (files.length === 0) {
      return res.json({ 
        success: true, 
        message: 'No local files found to migrate',
        report 
      });
    }

    // Process files with rate limiting
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      try {
        console.log(`[migrate] [${i + 1}/${files.length}] Uploading: ${file.relativePath}`);
        
        // Upload to Blob
        const newUrl = await uploadToBlob(file);
        report.uploaded++;
        
        // Update database
        const updates = await updateDatabaseUrls(file.oldUrl, newUrl);
        report.dbUpdates += updates.length;
        
        console.log(`[migrate] ✓ ${file.relativePath} → ${newUrl} (${updates.length} DB updates)`);
        
        // Rate limiting: 200ms between uploads
        if (i < files.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        
      } catch (err) {
        console.error(`[migrate] ✗ Failed: ${file.relativePath}`, err.message);
        report.failed++;
        report.errors.push({ file: file.relativePath, error: err.message });
      }
    }

    report.duration = ((Date.now() - report.startTime) / 1000).toFixed(1);
    
    console.log('[migrate] Migration completed:', report);
    
    return res.json({ 
      success: true,
      message: `Migrated ${report.uploaded}/${report.scanned} files successfully`,
      report
    });
    
  } catch (err) {
    console.error('[migrate] Migration failed:', err);
    return res.status(500).json({ 
      error: 'Migration failed', 
      message: err.message 
    });
  }
});

// Reset all images - delete from Blob Storage and clear database URLs
app.post('/admin/reset-all-images', basicAuth, express.json(), async (req, res) => {
  try {
    console.log('[reset-images] Starting complete image reset...');
    
    const report = {
      deletedFromBlob: 0,
      clearedFromDb: 0,
      errors: [],
      startTime: Date.now()
    };

    const allUrls = new Set();
    const langs = ['en', 'sk', 'hu'];

    // Collect all image URLs from database
    console.log('[reset-images] Collecting all image URLs from database...');

    // 1. Events (use listEvents for each language)
    for (const lang of langs) {
      const events = await db.listEvents(lang);
      for (const event of events) {
        if (event.image_url) allUrls.add(event.image_url);
      }
    }

    // 2. News (use listNews for each language)
    for (const lang of langs) {
      const news = await db.listNews(lang);
      for (const article of news) {
        if (article.image_url) allUrls.add(article.image_url);
      }
    }

    // 3. Themes (use listThemes for each language)
    for (const lang of langs) {
      const themes = await db.listThemes(lang);
      for (const theme of themes) {
        if (theme.image_url) allUrls.add(theme.image_url);
      }
    }

    // 4. Team (use listTeam for each language)
    for (const lang of langs) {
      const team = await db.listTeam(lang);
      for (const member of team) {
        if (member.photo_url) allUrls.add(member.photo_url);
        if (member.thumbnail_url) allUrls.add(member.thumbnail_url);
      }
    }

    // 5. Documents (use listDocuments for each language)
    for (const lang of langs) {
      const docs = await db.listDocuments(lang);
      for (const doc of docs) {
        if (doc.file_url) allUrls.add(doc.file_url);
      }
    }

    // 6. Pages (use listPages for each language)
    for (const lang of langs) {
      const pages = await db.listPages(lang);
      for (const page of pages) {
        if (page.image_url) allUrls.add(page.image_url);
        if (page.cover_image_url) allUrls.add(page.cover_image_url);
      }
    }

    // 7. Settings (slider backgrounds)
    for (const lang of langs) {
      const cfg = await db.getSettings(lang);
      if (cfg.slider_bg_image_url) allUrls.add(cfg.slider_bg_image_url);
      if (Array.isArray(cfg.slider_bg_gallery)) {
        cfg.slider_bg_gallery.forEach(url => url && allUrls.add(url));
      }
    }

    console.log(`[reset-images] Found ${allUrls.size} unique image URLs`);

    // Delete from Blob Storage
    for (const url of allUrls) {
      try {
        await deleteFile(url);
        report.deletedFromBlob++;
        console.log(`[reset-images] Deleted: ${url}`);
      } catch (err) {
        console.warn(`[reset-images] Failed to delete ${url}:`, err.message);
        report.errors.push({ url, error: err.message });
      }
    }

    // Clear all URLs from database
    console.log('[reset-images] Clearing all image URLs from database...');

    // Collect unique group_ids to avoid duplicates
    const eventGroups = new Set();
    const newsGroups = new Set();
    const themeGroups = new Set();
    const teamGroups = new Set();
    const docGroups = new Set();

    for (const lang of langs) {
      const events = await db.listEvents(lang);
      events.forEach(e => e.group_id && eventGroups.add(e.group_id));
      
      const news = await db.listNews(lang);
      news.forEach(n => n.group_id && newsGroups.add(n.group_id));
      
      const themes = await db.listThemes(lang);
      themes.forEach(t => t.group_id && themeGroups.add(t.group_id));
      
      const team = await db.listTeam(lang);
      team.forEach(m => m.group_id && teamGroups.add(m.group_id));
      
      const docs = await db.listDocuments(lang);
      docs.forEach(d => d.group_id && docGroups.add(d.group_id));
    }

    // Clear Events (unique groups only)
    for (const group_id of eventGroups) {
      await db.updateEventImageForGroup(group_id, '');
      report.clearedFromDb++;
    }

    // Clear News (unique groups only)
    for (const group_id of newsGroups) {
      await db.updateNewsImageForGroup(group_id, '');
      report.clearedFromDb++;
    }

    // Clear Themes (unique groups only)
    for (const group_id of themeGroups) {
      await db.updateThemeImageForGroup(group_id, '');
      report.clearedFromDb++;
    }

    // Clear Team (unique groups only)
    for (const group_id of teamGroups) {
      await db.updateTeamPhotoForGroup(group_id, '');
      report.clearedFromDb++;
    }

    // Clear Documents (unique groups only)
    for (const group_id of docGroups) {
      await db.updateDocumentFileForGroup(group_id, '');
      report.clearedFromDb++;
    }

    // Clear Pages - pages don't have shared image fields, skip for now
    // (Page images are usually unique per language, user can delete manually)

    // Clear Settings (slider backgrounds)
    for (const lang of langs) {
      const cfg = await db.getSettings(lang);
      cfg.slider_bg_image_url = '';
      cfg.slider_bg_gallery = [];
      await db.updateSettings(lang, cfg);
      report.clearedFromDb++;
    }

    report.duration = ((Date.now() - report.startTime) / 1000).toFixed(1);
    
    console.log('[reset-images] Reset completed:', report);
    
    return res.json({
      success: true,
      message: `Reset completed: ${report.deletedFromBlob} files deleted, ${report.clearedFromDb} DB records cleared`,
      report
    });

  } catch (err) {
    console.error('[reset-images] Reset failed:', err);
    return res.status(500).json({
      error: 'Reset failed',
      message: err.message
    });
  }
});

// Clean duplicate events (keep only one per group_id)
app.post('/admin/clean-duplicates', basicAuth, express.json(), async (req, res) => {
  try {
    console.log('[clean-duplicates] Starting duplicate cleanup...');
    
    const report = {
      eventsDeleted: 0,
      newsDeleted: 0,
      themesDeleted: 0,
      teamDeleted: 0,
      docsDeleted: 0,
      startTime: Date.now()
    };

    const langs = ['en', 'sk', 'hu'];

    // Clean Events - keep first of each group_id per language
    for (const lang of langs) {
      const events = await db.listEvents(lang);
      const seen = new Map();
      
      for (const event of events) {
        const key = `${event.group_id || 'null'}_${event.title || 'notitle'}`;
        
        if (!seen.has(key)) {
          seen.set(key, event.id);
        } else {
          // Delete duplicate
          await db.deleteEvent(event.id);
          report.eventsDeleted++;
          console.log(`[clean-duplicates] Deleted duplicate event: ${event.id} (${event.title})`);
        }
      }
    }

    // Clean News
    for (const lang of langs) {
      const news = await db.listNews(lang);
      const seen = new Map();
      
      for (const article of news) {
        const key = `${article.group_id || 'null'}_${article.title || 'notitle'}`;
        
        if (!seen.has(key)) {
          seen.set(key, article.id);
        } else {
          await db.deleteNews(article.id);
          report.newsDeleted++;
          console.log(`[clean-duplicates] Deleted duplicate news: ${article.id} (${article.title})`);
        }
      }
    }

    // Clean Themes
    for (const lang of langs) {
      const themes = await db.listThemes(lang);
      const seen = new Map();
      
      for (const theme of themes) {
        const key = `${theme.group_id || 'null'}_${theme.title || 'notitle'}`;
        
        if (!seen.has(key)) {
          seen.set(key, theme.id);
        } else {
          await db.deleteTheme(theme.id);
          report.themesDeleted++;
          console.log(`[clean-duplicates] Deleted duplicate theme: ${theme.id} (${theme.title})`);
        }
      }
    }

    // Clean Team
    for (const lang of langs) {
      const team = await db.listTeam(lang);
      const seen = new Map();
      
      for (const member of team) {
        const key = `${member.group_id || 'null'}_${member.name || 'noname'}`;
        
        if (!seen.has(key)) {
          seen.set(key, member.id);
        } else {
          await db.deleteTeamMember(member.id);
          report.teamDeleted++;
          console.log(`[clean-duplicates] Deleted duplicate team member: ${member.id} (${member.name})`);
        }
      }
    }

    // Clean Documents
    for (const lang of langs) {
      const docs = await db.listDocuments(lang);
      const seen = new Map();
      
      for (const doc of docs) {
        const key = `${doc.group_id || 'null'}_${doc.title || 'notitle'}`;
        
        if (!seen.has(key)) {
          seen.set(key, doc.id);
        } else {
          await db.deleteDocument(doc.id);
          report.docsDeleted++;
          console.log(`[clean-duplicates] Deleted duplicate document: ${doc.id} (${doc.title})`);
        }
      }
    }

    report.duration = ((Date.now() - report.startTime) / 1000).toFixed(1);
    report.totalDeleted = report.eventsDeleted + report.newsDeleted + report.themesDeleted + report.teamDeleted + report.docsDeleted;
    
    console.log('[clean-duplicates] Cleanup completed:', report);
    
    return res.json({
      success: true,
      message: `Cleanup completed: ${report.totalDeleted} duplicates removed`,
      report
    });

  } catch (err) {
    console.error('[clean-duplicates] Cleanup failed:', err);
    return res.status(500).json({
      error: 'Cleanup failed',
      message: err.message
    });
  }
});
 

// Settings: Contact
app.get('/admin/settings/contact', basicAuth, async (req, res) => {
  if(!useDb) return res.status(501).send('Settings require DB backend');
  const cfg_en = await db.getSettings('en');
  const contact = cfg_en.contact || {};
  res.render('admin-settings-contact', { title: 'Settings › Contact', active: 'settings-contact', lang: res.locals.lang, useDb, contact });
});

app.post('/admin/settings/contact', basicAuth, async (req, res) => {
  if(!useDb) return res.status(501).send('Settings require DB backend');
  const socials = ['facebook','instagram','twitter','linkedin','youtube'];
  const contact = {
    address: (req.body['contact_address'] || '').trim(),
    phone: (req.body['contact_phone'] || '').trim(),
    email: (req.body['contact_email'] || '').trim(),
  };
  for(const s of socials){
    let v = (req.body[`contact_${s}`] || '').trim();
    if(v){
      // Prefix https:// if user omitted scheme
      if(!/^https?:\/\//i.test(v)){
        v = `https://${v}`;
      }
      contact[s] = v;
    }
  }
  // Save the same global contact to all languages for compatibility
  const cur_en = await db.getSettings('en').catch(()=>({})) || {};
  const cur_sk = await db.getSettings('sk').catch(()=>({})) || {};
  const cur_hu = await db.getSettings('hu').catch(()=>({})) || {};
  await db.updateSettings('en', { ...cur_en, contact });
  await db.updateSettings('sk', { ...cur_sk, contact });
  await db.updateSettings('hu', { ...cur_hu, contact });
  res.redirect(`/admin/settings/contact?lang=${res.locals.lang}`);
});

// Settings: GDPR (single record per language, stored as page with slug 'gdpr')
app.get('/admin/settings/gdpr', basicAuth, async (req, res) => {
  if(!useDb) return res.status(501).send('Settings require DB backend');
  const langs = ['en','sk','hu'];
  const pagesByLang = {};
  for(const l of langs){
    pagesByLang[l] = await db.getPage(l, 'gdpr').catch(()=>null) || { title: 'GDPR', content: '' };
  }
  res.render('admin-settings-gdpr', { title: 'Settings › GDPR', active: 'settings-gdpr', lang: res.locals.lang, useDb, pagesByLang });
});

// Settings: Stats / Counters
app.get('/admin/settings/stats', basicAuth, async (req, res) => {
  if(!useDb) return res.status(501).send('Settings require DB backend');
  const cfg = await db.getSettings(res.locals.lang);
  res.render('admin-settings-stats', { cfg, lang: res.locals.lang, useDb, active: 'settings-stats' });
});

app.post('/admin/settings/stats', basicAuth, async (req, res) => {
  if(!useDb) return res.status(501).send('Settings require DB backend');
  const cur_en = await db.getSettings('en').catch(()=>({})) || {};
  const cur_sk = await db.getSettings('sk').catch(()=>({})) || {};
  const cur_hu = await db.getSettings('hu').catch(()=>({})) || {};
  // Parse posted stats: prefer contiguous indices based on stats_count to drop deleted rows reliably
  const count = Math.max(parseInt(req.body.stats_count || '0', 10) || 0, 0);
  const indices = Array.from({ length: count }, (_, i) => i);
  const stats = [];
  for(const i of indices){
    const valueRaw = req.body[`stat${i}_value`];
    const hasValueField = Object.prototype.hasOwnProperty.call(req.body, `stat${i}_value`);
    const valueStr = typeof valueRaw === 'string' ? valueRaw.trim() : '';
    const hasExplicitValue = hasValueField && valueStr !== '';
    const value = hasExplicitValue ? Number(valueStr) : 0;
    const icon = (req.body[`stat${i}_icon`] || '').trim();
    const suffix = (req.body[`stat${i}_suffix`] || '').trim();
    const active = (req.body[`stat${i}_active`] || 'true') === 'true';
    const labels = {
      en: (req.body[`stat${i}_label_en`] || '').trim(),
      sk: (req.body[`stat${i}_label_sk`] || '').trim(),
      hu: (req.body[`stat${i}_label_hu`] || '').trim(),
    };
    const hasAnyLabel = labels.en || labels.sk || labels.hu;
    // Only keep if user explicitly provided any meaningful field for this index
    const keep = hasAnyLabel || icon || suffix || hasExplicitValue;
    if(!keep) continue;
    stats.push({ value: Number.isFinite(value) ? value : 0, icon, suffix, active, labels });
  }
  // Limit to 12 for safety
  const finalStats = stats.slice(0, 12);
  await db.updateSettings('en', { ...cur_en, stats: finalStats });
  await db.updateSettings('sk', { ...cur_sk, stats: finalStats });
  await db.updateSettings('hu', { ...cur_hu, stats: finalStats });
  res.redirect(`/admin/settings/stats?lang=${res.locals.lang}`);
});

app.post('/admin/settings/gdpr', basicAuth, async (req, res) => {
  if(!useDb) return res.status(501).send('Settings require DB backend');
  const langs = ['en','sk','hu'];
  for(const l of langs){
    const contentField = req.body[`content_${l}`];
    const content = (typeof contentField === 'string') ? contentField.trim() : '';
    // Keep title as 'GDPR' in all languages for simplicity
    await db.upsertPage({ lang: l, slug: 'gdpr', title: 'GDPR', content });
  }
  res.redirect(`/admin/settings/gdpr?lang=${res.locals.lang}`);
});

// (removed) Settings: Focus Areas Columns — columns are fixed now

// Admin: Edit core pages (DB only)
const ALLOWED_PAGES = {
  'home': { title: { en: 'Home', sk: 'Domov', hu: 'Főoldal' }, returnPath: '' },
  'about-us': { title: { en: 'About Us', sk: 'O nás', hu: 'Rólunk' }, returnPath: 'page/about-us' },
  'focus-areas': { title: { en: 'Focus Areas', sk: 'Zamerania', hu: 'Fókuszterületek' }, returnPath: 'focus-areas' }
};

app.get('/admin/pages/:slug', basicAuth, async (req, res) => {
  if(!useDb) return res.status(501).send('Pages require DB backend');
  const slug = req.params.slug;
  if (slug === 'focus-areas') {
    return res.redirect(`/admin/focus-areas?lang=${res.locals.lang}`);
  }
  const def = ALLOWED_PAGES[slug];
  if(!def) return res.status(404).send('Page not allowed');
  // Always use multi-language editor
  return res.redirect(`/admin/pages/${slug}/multi?lang=${res.locals.lang}`);
});

// Accept optional image upload for page banner/lead image
app.post('/admin/pages/:slug', basicAuth, uploadImages.any(), async (req, res) => {
  if(!useDb) return res.status(501).send('Pages require DB backend');
  const slug = req.params.slug;
  const def = ALLOWED_PAGES[slug];
  if(!def) return res.status(404).send('Page not allowed');
  const title = (req.body.title || '').trim();
  const content = (req.body.content || '').trim();
  let image_url;
  // Load existing to be able to unlink old file if replaced/removed
  let existingPage = null;
  try { existingPage = await db.getPage(res.locals.lang, slug); } catch {}
  const filesArr = Array.isArray(req.files) ? req.files : [];
  const imageFile = filesArr.find(f => f.fieldname === 'image' && /^image\//.test(f.mimetype));
  if(imageFile){
    // Upload to storage
    const optimized = await optimizeImageBuffer(imageFile.buffer);
    const filename = generateFilename(imageFile.originalname, 'pages');
    image_url = await uploadFile(optimized, filename, imageFile.mimetype);
    
    // If a new file uploaded, remove old image from storage
    const oldUrl = existingPage?.image_url;
    if (oldUrl && typeof oldUrl === 'string'){
      try { await deleteFile(oldUrl); } catch {}
    }
  } else if(req.body.remove_image === '1') {
    image_url = null;
    // If explicitly removed, delete old file from storage
    const oldUrl = existingPage?.image_url;
    if (oldUrl && typeof oldUrl === 'string'){
      try { await deleteFile(oldUrl); } catch {}
    }
  } // else undefined -> keep existing
  await db.upsertPage({ lang: res.locals.lang, slug, title, content, image_url });
  res.redirect(`/admin/pages/${slug}?lang=${res.locals.lang}`);
});

// Multi-language page editor (tabbed) for core pages
app.get('/admin/pages/:slug/multi', basicAuth, async (req,res)=>{
  if(!useDb) return res.status(501).send('Pages require DB backend');
  // Redirect legacy focus-areas page editor to new data-based Focus Areas management
  if (req.params.slug === 'focus-areas') {
    return res.redirect(`/admin/focus-areas?lang=${res.locals.lang}`);
  }
  const slug = req.params.slug;
  const def = ALLOWED_PAGES[slug];
  if(!def) return res.status(404).send('Page not allowed');
  const langs = ['en','sk','hu'];
  const pagesByLang = {};
  for(const l of langs){
    pagesByLang[l] = await db.getPage(l, slug).catch(()=>null) || { title: def.title[l] || def.title.en, content: '', image_url: null };
  }
  // Load items for all languages
  const itemsByLang = { en: [], sk: [], hu: [] };
  try {
    for(const l of langs){
      const p = pagesByLang[l];
      if(p && p.id){
        itemsByLang[l] = await db.getAdditionalImages('page', p.id);
      }
    }
  } catch {}
  const imagesEn = itemsByLang.en || [];
  // Load About Us gallery (EN owner) if applicable
  let galleryItemsEn = [];
  try {
    if (slug === 'about-us' && pagesByLang.en && pagesByLang.en.id) {
      galleryItemsEn = await db.getAdditionalImages('page_gallery', pagesByLang.en.id);
    }
  } catch {}
  res.render('admin-page-form-multi', { slug, pageTitle: def.title[res.locals.lang] || def.title.en, pagesByLang, langs, lang: res.locals.lang, useDb, imagesEn, itemsByLang, galleryItemsEn });
});

app.post('/admin/pages/:slug/multi', basicAuth, uploadImages.any(), async (req,res)=>{
  if(!useDb) return res.status(501).send('Pages require DB backend');
  const slug = req.params.slug;
  const def = ALLOWED_PAGES[slug];
  if(!def) return res.status(404).send('Page not allowed');
  const langs = ['en','sk','hu'];
  for(const l of langs){
    const title = (req.body[`title_${l}`] || '').trim();
    // Preserve existing content if not supplied in the form
    let existingPage = null;
    try { existingPage = await db.getPage(l, slug); } catch {}
    const contentField = req.body[`content_${l}`];
    // About Us & Home: editor hidden, don't wipe content; keep existing
    const content = (slug === 'about-us' || slug === 'home')
      ? (existingPage?.content || '')
      : ((typeof contentField === 'string') ? contentField.trim() : (existingPage?.content || ''));
    let image_url; // undefined -> keep
    await db.upsertPage({ lang: l, slug, title: title || def.title[l] || def.title.en, content, image_url });
  }
  // About Us & Home: exactly 4 sections per language (image + text). Others: keep legacy 4 content-only blocks for SK/HU.
  try {
    if (slug === 'about-us' || slug === 'home'){
      for (const l of langs){
        const pageLang = await db.getPage(l, slug);
        if(!(pageLang && pageLang.id)) continue;
        const existingItems = await db.getAdditionalImages('page', pageLang.id).catch(()=>[]);
        const items = [];
        for (let i = 1; i <= 4; i++){
          const alt_text = (req.body[`about_block_text_${i}_${l}`] || '').trim();
          // Only EN may alter images; SK/HU inherit images from EN in public
          let image_url = undefined; // undefined => keep
          if (l === 'en'){
            if ((slug === 'about-us' || slug === 'home') && (i === 2 || i === 3)){
              // About Us: For sections 2 and 3, force remove image if exists
              image_url = '';
            } else {
              const filesArr = Array.isArray(req.files) ? req.files : [];
              const file = filesArr.find(f => f.fieldname === `about_block_image_${i}_${l}` && /^image\//.test(f.mimetype));
              if (file){
                const optimized = await optimizeImageBuffer(file.buffer);
                const filename = generateFilename(file.originalname, 'pages');
                image_url = await uploadFile(optimized, filename, file.mimetype);
              } else if (req.body[`about_block_remove_image_${i}_${l}`] === '1'){
                image_url = '';
              }
            }
          }
          items.push({ image_url, alt_text, sort_order: i-1 });
        }
        const finalItems = items.map((it, idx)=>{
          const ex = existingItems[idx];
          const url = (typeof it.image_url === 'undefined') ? (ex ? ex.image_url : '') : it.image_url;
          return { image_url: url || '', alt_text: it.alt_text || '', sort_order: idx };
        });
        // Delete replaced/removed old files from storage (EN only)
        if (l === 'en'){
          try {
            for (let i=0;i<4;i++){
              const ex = existingItems[i];
              const cur = items[i];
              if(!ex || !ex.image_url) continue;
              const replaced = (typeof cur.image_url !== 'undefined' && cur.image_url && cur.image_url !== ex.image_url);
              const removed = (cur.image_url === '');
              if (replaced || removed){
                try { await deleteFile(ex.image_url); } catch {}
              }
            }
          } catch {}
        }
        if (typeof db.replaceAdditionalImageItems === 'function'){
          await db.replaceAdditionalImageItems('page', pageLang.id, finalItems);
        } else {
          await db.deleteAdditionalImages('page', pageLang.id);
          await db.addAdditionalImages('page', pageLang.id, finalItems.map(fi=>fi.image_url));
        }
      }
    } else {
      for (const l of ['sk','hu']){
        const pageLang = await db.getPage(l, slug);
        if(!(pageLang && pageLang.id)) continue;
        const items = [];
        for(let i=1;i<=4;i++){
          const alt_text = (req.body[`block_content_${i}_${l}`] || '').trim();
          items.push({ image_url: '', alt_text, sort_order: i-1 });
        }
        const hasAny = items.some(it => it.alt_text);
        if (db.replaceAdditionalImageItems){
          await db.replaceAdditionalImageItems('page', pageLang.id, hasAny ? items : []);
        } else {
          await db.deleteAdditionalImages('page', pageLang.id);
        }
      }
    }
  } catch (e) {
    console.error('Failed to update About Us sections:', e.message);
  }
  res.redirect(`/admin/pages/${slug}/multi?lang=${res.locals.lang}`);
});

// Public themes & team pages
app.get('/themes', async (req, res) => {
  try {
    if(useDb){
      const pages = await db.listPages(res.locals.lang);
      const menu = buildMenu(pages);
      const themes = await db.listThemes(res.locals.lang);
      const cards = themes.map(t => {
      const listImage = t.image_url && String(t.image_url).trim() ? t.image_url : '/img/placeholder-theme.svg';
      return `
      <div class="col-lg-4 col-md-6 mb-4">
        <div class="card bg-light shadow-sm h-100 d-flex flex-column">
          <a href="/themes/${t.slug || t.id}?lang=${res.locals.lang}${t.group_id ? (`&gid=${encodeURIComponent(t.group_id)}`) : ''}">
            <img src="${listImage}" class="card-img-top" alt="${t.title}" style="height:200px; object-fit:cover;">
          </a>
          <div class="card-body d-flex flex-column">
            <h5 class="card-title text-primary mb-2">${t.title}</h5>
            <p class="card-text">${t.description ? t.description.substring(0, 100) + (t.description.length > 100 ? '...' : '') : ''}</p>
            <div class="mt-auto pt-2">
              <a href="/themes/${t.slug || t.id}?lang=${res.locals.lang}${t.group_id ? (`&gid=${encodeURIComponent(t.group_id)}`) : ''}" class="btn btn-primary btn-sm w-100 text-center">
                <i class="fas fa-eye me-1"></i>${res.locals.t('viewDetails')}
              </a>
            </div>
          </div>
        </div>
      </div>`
    }).join('');
    const html = `<div class="row">${cards || `<div class=\"text-muted\">${res.locals.t('noThemesYet')}</div>`}</div>`;
  const shThemes = { kicker: res.locals.t('themesKicker'), heading: res.locals.t('themesHeading'), subheading: '' };
  return res.render('page', { menu, page: { title: res.locals.t('themesTitle'), content: html }, lang: res.locals.lang, slider: null, sectionHeader: shThemes, t: res.locals.t });
  }
  } catch(err) {
    console.error('[app.get /themes] Database error:', err.message);
    return res.status(500).send('Database connection error. Please try again later.');
  }
});

// Focus Areas columns are fixed (no settings UI)
function getFocusAreaColumns(){
  return ['group','field','experts','description','activity_description','type_of_activity'];
}

function focusAreaLabelFactory(t){
  return function(key){
    const map = {
      group: t('fa_group'),
      field: t('fa_field'),
      experts: t('fa_experts'),
      description: t('fa_description'),
      activity_description: t('fa_activity_description'),
      type_of_activity: t('fa_type_of_activity'),
    };
    if(map[key]) return map[key];
    return String(key || '').replace(/_/g, ' ');
  };
}

// Resolve Focus Area variant for current language with fallback
async function resolveFocusAreaVariant(row, lang){
  if(!row || !row.group_id || !db.getFocusAreaByGroupAndLang) return row;
  try{
    const cur = await db.getFocusAreaByGroupAndLang(row.group_id, lang);
    if(cur) return cur;
    const en = await db.getFocusAreaByGroupAndLang(row.group_id, 'en');
    const sk = await db.getFocusAreaByGroupAndLang(row.group_id, 'sk');
    const hu = await db.getFocusAreaByGroupAndLang(row.group_id, 'hu');
    return en || sk || hu || row;
  }catch{ return row; }
}

// Focus Areas public page (table)
app.get('/focus-areas', async (req, res) => {
  try {
    const pages = await db.listPages(res.locals.lang);
    const menu = buildMenu(pages);
    const cols = getFocusAreaColumns();
  const labels = cols.map(focusAreaLabelFactory(res.locals.t));
  // Aggregate across languages and deduplicate by group; prefer current language variant
  let all = [];
  try {
    const [en, sk, hu] = await Promise.all([
      db.listFocusAreas('en').catch(()=>[]),
      db.listFocusAreas('sk').catch(()=>[]),
      db.listFocusAreas('hu').catch(()=>[])
    ]);
    all = [...en, ...sk, ...hu];
  } catch {
    all = await db.listFocusAreas(res.locals.lang).catch(()=>[]) || [];
  }
  const byGroup = new Map();
  for(const r of all){
    const key = r.group_id || `single_${r.id}`;
    if(!byGroup.has(key)) byGroup.set(key, r);
  }
  const bases = Array.from(byGroup.values());
  const rows = await Promise.all(bases.map(b => resolveFocusAreaVariant(b, res.locals.lang)));
  const thead = `<thead><tr>${labels.map(lb=>`<th class="text-uppercase small">${lb}</th>`).join('')}</tr></thead>`;
  const tbody = `<tbody>${rows.map(r=>{
    const f = r.fields || {};
    return `<tr>${cols.map(c=>`<td>${(f[c] ?? '').toString()}</td>`).join('')}</tr>`;
  }).join('')}</tbody>`;
  const tableHtml = `<div class="table-responsive"><table class="table table-striped align-middle focus-areas-table">${thead}${tbody}</table></div>`;
  const shFocus = { kicker: res.locals.t('focusAreasKicker'), heading: res.locals.t('focusAreasHeading'), subheading: '' };
  return res.render('page', { menu, page: { title: res.locals.t('focusAreasTitle'), content: tableHtml }, lang: res.locals.lang, slider: null, sectionHeader: shFocus, t: res.locals.t });
  } catch(err) {
    console.error('[app.get /focus-areas] Database error:', err.message);
    return res.status(500).send('Database connection error. Please try again later.');
  }
});

// Admin: Focus Areas list
app.get('/admin/focus-areas', basicAuth, async (req, res) => {
  const cols = getFocusAreaColumns();
  const labels = cols.map(focusAreaLabelFactory(res.locals.t));
  // Aggregate across languages for admin view and dedupe by group; resolve to current language variant if available
  let all = [];
  try {
    const [en, sk, hu] = await Promise.all([
      db.listFocusAreas('en', true).catch(()=>[]),
      db.listFocusAreas('sk', true).catch(()=>[]),
      db.listFocusAreas('hu', true).catch(()=>[])
    ]);
    all = [...en, ...sk, ...hu];
  } catch {
    all = await db.listFocusAreas(res.locals.lang, true).catch(()=>[]) || [];
  }
  const byGroup = new Map();
  for(const r of all){
    const key = r.group_id || `single_${r.id}`;
    if(!byGroup.has(key)) byGroup.set(key, r);
  }
  const bases = Array.from(byGroup.values());
  const rows = await Promise.all(bases.map(b => resolveFocusAreaVariant(b, res.locals.lang)));
  res.render('admin-focus-areas-list', { title: res.locals.t('focusAreasTitle'), active: 'focus-areas', lang: res.locals.lang, useDb, cols, labels, rows, success: req.query.success || '' });
});

// Admin: New Focus Area form
app.get('/admin/focus-areas/new', basicAuth, async (req, res) => {
  const cols = getFocusAreaColumns();
  const labels = cols.map(focusAreaLabelFactory(res.locals.t));
  const langs = ['en','sk','hu'];
  const rowsByLang = { en: null, sk: null, hu: null };
  res.render('admin-focus-areas-form', { title: 'New Focus Area', active: 'focus-areas', lang: res.locals.lang, useDb, cols, labels, rowsByLang, formAction: `/admin/focus-areas?lang=${res.locals.lang}`, error: '' });
});

app.post('/admin/focus-areas', basicAuth, async (req, res) => {
  const cols = getFocusAreaColumns();
  const langs = ['en','sk','hu'];
  const sort_order = parseInt(req.body.sort_order || '0', 10) || 0;
  const published = (req.body.published === 'on' || req.body.published === 'true');
  const groupId = crypto.randomUUID();
  // Collect posted fields per language
  const fieldsByLang = {};
  const filledLangs = [];
  for(const l of langs){
    const f = {};
    let hasAny = false;
    for(const c of cols){
      const val = (req.body[`${c}_${l}`] || '').trim();
      f[c] = val;
      if(!hasAny && val) hasAny = true;
    }
    fieldsByLang[l] = f;
    if(hasAny) filledLangs.push(l);
  }
  if(filledLangs.length === 0){
    return res.status(400).render('admin-focus-areas-form', { title: 'New Focus Area', active: 'focus-areas', lang: res.locals.lang, useDb, cols, labels: cols.map(focusAreaLabelFactory(res.locals.t)), rowsByLang: { en: null, sk: null, hu: null }, error: 'Please fill at least one language.' });
  }
  const sourceLang = filledLangs[0];
  for(const l of langs){
    const fields = (filledLangs.includes(l)) ? fieldsByLang[l] : fieldsByLang[sourceLang];
    await db.createFocusArea({ lang: l, group_id: groupId, fields, sort_order, published });
  }
  res.redirect(`/admin/focus-areas?lang=${res.locals.lang}&success=created`);
});

// Admin: Edit Focus Area
app.get('/admin/focus-areas/:id/edit', basicAuth, async (req, res) => {
  const cols = getFocusAreaColumns();
  const base = await db.getFocusArea(req.params.id);
  if(!base) return res.status(404).send('Focus area not found');
  const labels = cols.map(focusAreaLabelFactory(res.locals.t));
  const langs = ['en','sk','hu'];
  const rowsByLang = { en: null, sk: null, hu: null };
  if(base.group_id){
    for(const l of langs){
      rowsByLang[l] = await db.getFocusAreaByGroupAndLang?.(base.group_id, l) || null;
    }
  } else {
    rowsByLang[base.lang] = base;
  }
  res.render('admin-focus-areas-form', { title: 'Edit Focus Area', active: 'focus-areas', lang: res.locals.lang, useDb, cols, labels, rowsByLang, baseId: base.id, formAction: `/admin/focus-areas/${base.id}?lang=${res.locals.lang}`, error: '' });
});

app.post('/admin/focus-areas/:id', basicAuth, async (req, res) => {
  const cols = getFocusAreaColumns();
  const base = await db.getFocusArea(req.params.id);
  if(!base) return res.status(404).send('Focus area not found');
  let groupId = base.group_id;
  if(!groupId){
    groupId = crypto.randomUUID();
    await db.setFocusAreaGroup?.(base.id, groupId);
  }
  const langs = ['en','sk','hu'];
  const sort_order = parseInt(req.body.sort_order || String(base.sort_order || 0), 10) || (base.sort_order || 0);
  const published = (req.body.published === 'on' || req.body.published === 'true');
  // Gather posted fields per language and detect a single filled language
  const fieldsByLang = {};
  const filledLangs = [];
  for(const l of langs){
    const existing = await db.getFocusAreaByGroupAndLang?.(groupId, l);
    const f = {};
    let hasAny = false;
    for(const c of cols){
      const val = (req.body[`${c}_${l}`] || '').trim();
      if(val){
        f[c] = val;
        hasAny = true;
      }
    }
    fieldsByLang[l] = { existing, posted: f, hasAny };
    if(hasAny) filledLangs.push(l);
  }
  const sourceLang = filledLangs[0] || null;
  for(const l of langs){
    const { existing, posted, hasAny } = fieldsByLang[l];
    if(existing){
      // Merge with auto-fill: prefer posted; if missing and existing empty, fill from sourceLang posted
      const merged = { ...(existing.fields || {}) };
      for(const c of cols){
        if(Object.prototype.hasOwnProperty.call(posted, c)){
          merged[c] = posted[c];
        } else if (sourceLang && (!merged[c] || String(merged[c]).trim() === '') && Object.prototype.hasOwnProperty.call(fieldsByLang[sourceLang].posted, c)){
          merged[c] = fieldsByLang[sourceLang].posted[c];
        }
      }
      await db.updateFocusArea(existing.id, { fields: merged, sort_order, published });
    } else {
      if(hasAny){
        await db.createFocusArea({ lang: l, group_id: groupId, fields: posted, sort_order, published });
      } else if (sourceLang) {
        // Replicate single-language input to missing languages
        const sourcePosted = fieldsByLang[sourceLang].posted;
        await db.createFocusArea({ lang: l, group_id: groupId, fields: sourcePosted, sort_order, published });
      }
    }
  }
  res.redirect(`/admin/focus-areas?lang=${res.locals.lang}&success=updated`);
});

app.post('/admin/focus-areas/:id/delete', basicAuth, async (req, res) => {
  try{
    const base = await db.getFocusArea(req.params.id);
    if(base && base.group_id && typeof db.deleteFocusAreaGroup === 'function'){
      await db.deleteFocusAreaGroup(base.group_id);
    } else {
      await db.deleteFocusArea(req.params.id);
    }
  }catch(e){
    console.error('Delete focus area failed:', e?.message || e);
  }
  res.redirect(`/admin/focus-areas?lang=${res.locals.lang}&success=deleted`);
});

// Theme detail page (render via shared 'page' layout with gallery)
app.get('/themes/:slug', async (req, res) => {
  try {
    const idOrSlug = req.params.slug;
    const gid = req.query.gid;
    let theme = isNaN(idOrSlug) ? await db.getThemeBySlug(res.locals.lang, idOrSlug) : await db.getTheme(idOrSlug);
  // If gid is provided and we have a base theme with a different group, prefer resolving by gid
  if(gid && typeof db.getThemeByGroupAndLang === 'function'){
    try{
      const cur = await db.getThemeByGroupAndLang(gid, res.locals.lang);
      if(cur) theme = cur;
    }catch{}
  }
  // If not found in current language, try other languages by slug, then resolve to current language via group
  if(!theme && isNaN(idOrSlug)){
    try{
      const langs = ['en','sk','hu'];
      for(const l of langs){
        const th = await db.getThemeBySlug(l, idOrSlug).catch(()=>null);
        if(th){ theme = th; break; }
      }
      if(theme && theme.group_id && typeof db.getThemeByGroupAndLang === 'function'){
        const cur = await db.getThemeByGroupAndLang(theme.group_id, res.locals.lang).catch(()=>null);
        if(cur) theme = cur;
      }
    }catch{}
  }
  if(!theme) {
    return res.status(404).render('page', { 
      menu: [], 
      page: { title: res.locals.t('themeNotFound'), content: '<p>'+res.locals.t('themeNotFound')+'</p>' }, 
      lang: res.locals.lang, 
      slider: null,
      t: res.locals.t 
    });
  }
  // Resolve to current language variant if group exists; fallback to en/sk/hu order
  try{
    if(theme.group_id){
      const cur = await db.getThemeByGroupAndLang?.(theme.group_id, res.locals.lang);
      if(cur){
        theme = cur;
      } else {
        const en = await db.getThemeByGroupAndLang?.(theme.group_id, 'en');
        const sk = await db.getThemeByGroupAndLang?.(theme.group_id, 'sk');
        const hu = await db.getThemeByGroupAndLang?.(theme.group_id, 'hu');
        theme = en || sk || hu || theme;
      }
    }
  } catch {}
  const pages = await db.listPages(res.locals.lang);
  const menu = buildMenu(pages);
  const ownerId = await resolveThemeGalleryOwnerId(theme);
  const additionalImages = await db.getAdditionalImages('theme', ownerId);
  const gallery = (additionalImages && additionalImages.length) ? `
    <div class="mt-4">
      <h3 class="mb-3">${res.locals.t('gallery')}</h3>
      <div class="row g-3">
        ${additionalImages.map((img)=>`
          <div class="col-md-4">
            <a href="${img.image_url}" class="lightbox" data-gallery="theme-${ownerId}">
              <div class="card bg-light">
                <img src="${img.image_url}" class="card-img-top" alt="Theme image" style="height:200px;object-fit:cover;">
              </div>
            </a>
          </div>`).join('')}
      </div>
    </div>` : '';
  const shareUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const encUrl = encodeURIComponent(shareUrl);
  const encTitle = encodeURIComponent(theme.title || 'Theme');
  const share = `
    <div class="mt-4 pt-3 border-top">
      <div class="d-flex align-items-center gap-2 flex-wrap">
  <span class="text-muted me-2">${res.locals.t('share')}</span>
        <a class="btn btn-outline-secondary btn-sm" href="https://www.facebook.com/sharer/sharer.php?u=${encUrl}" target="_blank" rel="noopener" aria-label="Share on Facebook"><i class="fab fa-facebook-f me-1"></i>Facebook</a>
        <a class="btn btn-outline-secondary btn-sm" href="https://twitter.com/intent/tweet?url=${encUrl}&text=${encTitle}" target="_blank" rel="noopener" aria-label="Share on X"><i class="fab fa-x-twitter me-1"></i>Twitter</a>
        <a class="btn btn-outline-secondary btn-sm" href="https://www.linkedin.com/shareArticle?mini=true&url=${encUrl}&title=${encTitle}" target="_blank" rel="noopener" aria-label="Share on LinkedIn"><i class="fab fa-linkedin-in me-1"></i>LinkedIn</a>
        <a class="btn btn-outline-secondary btn-sm" href="https://wa.me/?text=${encTitle}%20${encUrl}" target="_blank" rel="noopener" aria-label="Share on WhatsApp"><i class="fab fa-whatsapp me-1"></i>WhatsApp</a>
  <a class="btn btn-outline-secondary btn-sm copy-link" href="#" data-copy="${shareUrl}" aria-label="Copy link"><i class="fas fa-link me-1"></i>${res.locals.t('copy')}</a>
      </div>
    </div>`;
  const html = `
    <div class="bg-white p-4 rounded">
      <div class="content lead">${theme.description || ''}</div>
      ${gallery}
      ${share}
    </div>`;
  const sh = { kicker: res.locals.t('themeKicker'), heading: theme.title, subheading: '' };
  return res.render('page', { 
    menu, 
    page: { title: '', content: html, image_url: theme.image_url || (additionalImages && additionalImages[0]?.image_url) || '' }, 
    lang: res.locals.lang, 
    slider: null,
    sectionHeader: sh,
    backLink: `/themes?lang=${res.locals.lang}`,
    t: res.locals.t 
  });
  } catch(err) {
    console.error('[app.get /themes/:slug] Database error:', err.message);
    return res.status(500).send('Database connection error. Please try again later.');
  }
});

// Event detail page
app.get('/events/:id', async (req, res) => {
  try {
    const idOrSlug = req.params.id;
    const gid = req.query.gid;
    let event = isNaN(idOrSlug) ? await db.getEventBySlug(res.locals.lang, idOrSlug) : await db.getEvent(idOrSlug);
  if(gid && typeof db.getEventByGroupAndLang === 'function'){
    try{
      const cur = await db.getEventByGroupAndLang(gid, res.locals.lang);
      if(cur) event = cur;
    }catch{}
  }
  // If not found by slug in current language, try other languages to locate the group, then resolve to requested language
  if(!event && isNaN(idOrSlug)){
    try{
      const langs = ['en','sk','hu'];
      for(const l of langs){
        const ev = await db.getEventBySlug(l, idOrSlug).catch(()=>null);
        if(ev){ event = ev; break; }
      }
      if(event && event.group_id && typeof db.getEventByGroupAndLang === 'function'){
        const cur = await db.getEventByGroupAndLang(event.group_id, res.locals.lang).catch(()=>null);
        if(cur) event = cur;
      }
    }catch{}
  }
  if(!event) {
    return res.status(404).render('page', { 
      menu: [], 
      page: { title: res.locals.t('eventNotFound'), content: '<p>'+res.locals.t('eventNotFound')+'</p>' }, 
      lang: res.locals.lang, 
      slider: null,
      t: res.locals.t 
    });
  }
  // Resolve to the current language variant when possible
  try{
    if(event.group_id){
      const cur = await db.getEventByGroupAndLang?.(event.group_id, res.locals.lang);
      if(cur){
        event = cur;
      } else {
        // Fallback order if current language variant is missing
        const en = await db.getEventByGroupAndLang?.(event.group_id, 'en');
        const sk = await db.getEventByGroupAndLang?.(event.group_id, 'sk');
        const hu = await db.getEventByGroupAndLang?.(event.group_id, 'hu');
        event = en || sk || hu || event;
      }
    }
  } catch {}
  const pages = await db.listPages(res.locals.lang);
  const menu = buildMenu(pages);
  const ownerId = await resolveEventGalleryOwnerId(event);
  const additionalImages = await db.getAdditionalImages('event', ownerId);
  const dateBadge = event.event_date ? `<span class="badge bg-primary me-2"><i class="fas fa-calendar me-1"></i>${new Date(event.event_date).toLocaleDateString()}</span>` : '';
  const locBadge = event.location ? `<span class="badge bg-secondary"><i class="fas fa-map-marker-alt me-1"></i>${event.location}</span>` : '';
  const gallery = (additionalImages && additionalImages.length) ? `
    <div class="mt-4">
      <h3 class="mb-3">${res.locals.t('gallery')}</h3>
      <div class="row g-3">
        ${additionalImages.map((img)=>`
          <div class="col-md-4">
            <a href="${img.image_url}" class="lightbox" data-gallery="event-${ownerId}">
              <div class="card bg-light"><img src="${img.image_url}" class="card-img-top" alt="Event image" style="height:200px;object-fit:cover;"></div>
            </a>
          </div>`).join('')}
      </div>
    </div>` : '';
  const shareUrlE = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const encUrlE = encodeURIComponent(shareUrlE);
  const encTitleE = encodeURIComponent(event.title || 'Event');
  const shareE = `
    <div class="mt-4 pt-3 border-top">
      <div class="d-flex align-items-center gap-2 flex-wrap">
  <span class="text-muted me-2">${res.locals.t('share')}</span>
        <a class="btn btn-outline-secondary btn-sm" href="https://www.facebook.com/sharer/sharer.php?u=${encUrlE}" target="_blank" rel="noopener" aria-label="Share on Facebook"><i class="fab fa-facebook-f me-1"></i>Facebook</a>
        <a class="btn btn-outline-secondary btn-sm" href="https://twitter.com/intent/tweet?url=${encUrlE}&text=${encTitleE}" target="_blank" rel="noopener" aria-label="Share on X"><i class="fab fa-x-twitter me-1"></i>Twitter</a>
        <a class="btn btn-outline-secondary btn-sm" href="https://www.linkedin.com/shareArticle?mini=true&url=${encUrlE}&title=${encTitleE}" target="_blank" rel="noopener" aria-label="Share on LinkedIn"><i class="fab fa-linkedin-in me-1"></i>LinkedIn</a>
        <a class="btn btn-outline-secondary btn-sm" href="https://wa.me/?text=${encTitleE}%20${encUrlE}" target="_blank" rel="noopener" aria-label="Share on WhatsApp"><i class="fab fa-whatsapp me-1"></i>WhatsApp</a>
  <a class="btn btn-outline-secondary btn-sm copy-link" href="#" data-copy="${shareUrlE}" aria-label="Copy link"><i class="fas fa-link me-1"></i>${res.locals.t('copy')}</a>
      </div>
    </div>`;
  const html = `
    <div class="bg-white p-4 rounded">
      <div class="mb-3">${dateBadge}${locBadge}</div>
      <div class="content lead">${event.description || ''}</div>
      ${gallery}
      ${shareE}
    </div>`;
  const sh = { kicker: 'EVENT', heading: event.title, subheading: '' };
  return res.render('page', { menu, page: { title: '', content: html, image_url: event.image_url || '' }, lang: res.locals.lang, slider: null, sectionHeader: sh, backLink: `/events?lang=${res.locals.lang}`, t: res.locals.t });
  } catch(err) {
    console.error('[app.get /events/:id] Database error:', err.message);
    return res.status(500).send('Database connection error. Please try again later.');
  }
});


// Helper: resolve team variant for current language with sensible fallback
async function resolveTeamVariant(member, lang){
  if(!member || !member.group_id || !db.getTeamMemberByGroupAndLang) return member;
  try{
    const cur = await db.getTeamMemberByGroupAndLang(member.group_id, lang);
    if(cur) return cur;
    const en = await db.getTeamMemberByGroupAndLang(member.group_id, 'en');
    const sk = await db.getTeamMemberByGroupAndLang(member.group_id, 'sk');
    const hu = await db.getTeamMemberByGroupAndLang(member.group_id, 'hu');
    return en || sk || hu || member;
  }catch{return member;}
}

// Public team listing
app.get('/team', async (req, res) => {
  try {
    const pages = await db.listPages(res.locals.lang);
    const menu = buildMenu(pages);
    // Aggregate team members across languages, then pick per-group variant for current language
    let allMembers = [];
    try {
    const [en, sk, hu] = await Promise.all([
      db.listTeam('en').catch(()=>[]),
      db.listTeam('sk').catch(()=>[]),
      db.listTeam('hu').catch(()=>[])
    ]);
    allMembers = [...en, ...sk, ...hu];
  } catch { allMembers = await db.listTeam(res.locals.lang).catch(()=>[]) || []; }
  // Deduplicate by group (or id when no group)
  const byGroup = new Map();
  for(const m of allMembers){
    const key = m.group_id || `single_${m.id}`;
    if(!byGroup.has(key)) byGroup.set(key, m);
  }
  const bases = Array.from(byGroup.values());
  const cards = (await Promise.all(bases.map(async (mBase) => {
    const m = await resolveTeamVariant(mBase, res.locals.lang);
    const bioText = String(m.bio || '').replace(/<[^>]+>/g, '').trim();
    const bioShort = bioText.length > 100 ? bioText.substring(0, 100) + '...' : bioText;
    const thumb = (m.photo_url || '').replace(/\.jpg$/i, '-thumb.jpg');
    function socialBtn(url, icon){
      if(url && url.trim()){
        return `<a class="btn btn-square btn-warning my-2" href="${url}" target="_blank" rel="noopener" aria-label="${icon.replace('fa-','').replace('fab ','')}"><i class="${icon}"></i></a>`;
      }
      // disabled style when URL missing
      return `<a class="btn btn-square btn-warning my-2 opacity-50" href="#" tabindex="-1" aria-disabled="true" aria-label="${icon.replace('fa-','').replace('fab ','')}"><i class="${icon}"></i></a>`;
    }
    const socials = [
      socialBtn(m.facebook || '', 'fab fa-facebook-f'),
      socialBtn(m.twitter || '', 'fab fa-x-twitter'),
      socialBtn(m.instagram || '', 'fab fa-instagram'),
      socialBtn(m.youtube || '', 'fab fa-youtube'),
      socialBtn(m.linkedin || '', 'fab fa-linkedin-in')
    ].join('');
    const linkId = m.id; // link to resolved variant id
    return `
      <div class="col-md-6 col-lg-4">
        <div class="team-item d-flex flex-column align-items-stretch h-100 p-0" style="background:#fff; box-shadow:0 0 30px rgba(0,0,0,.05); border-radius:12px; overflow:hidden;">
          <div class="d-flex">
            <div class="p-4 d-flex flex-column align-items-center justify-content-center" style="flex:1 1 0;">
              ${m.photo_url ? `<a href="/team/${linkId}?lang=${res.locals.lang}"><img class="img-fluid" src="${thumb}" onerror="this.src='${m.photo_url}'" alt="${m.name}" style="width:180px; height:180px; object-fit:cover; border-radius:8px;"></a>` : `<a href="/team/${linkId}?lang=${res.locals.lang}"><img class="img-fluid" src="/img/placeholder-member.svg" alt="${m.name}" style="width:180px; height:180px; object-fit:cover; border-radius:8px;"></a>`}
            </div>
            <div class="d-flex flex-column justify-content-center align-items-center bg-warning bg-opacity-25 px-3" style="min-width:64px;">
              ${socials}
            </div>
          </div>
          <div class="px-4 pb-4 pt-2">
            <h3 class="mb-1" style="font-size:1.3rem; font-weight:700;"><a href="/team/${linkId}?lang=${res.locals.lang}" class="text-decoration-none text-dark">${m.name}</a></h3>
            <div class="mb-2" style="color:#888; font-size:1rem;">${m.role || ''}</div>
            <div class="small" style="color:#444;">${bioShort}</div>
          </div>
        </div>
      </div>
    `;
  }))).join('');
  const html = `<div class="row g-4">${cards || `<div class=\"text-muted\">${res.locals.t('noTeamYet')}</div>`}</div>`;
  const shTeam = { kicker: res.locals.t('teamKicker'), heading: res.locals.t('teamHeading'), subheading: '' };
  return res.render('page', { menu, page: { title: res.locals.t('team'), content: html }, lang: res.locals.lang, slider: null, sectionHeader: shTeam, t: res.locals.t });
  } catch(err) {
    console.error('[app.get /team] Database error:', err.message);
    return res.status(500).send('Database connection error. Please try again later.');
  }
});

// Public team member detail
app.get('/team/:id', async (req, res) => {
  try {
    const idOrSlug = req.params.id;
    // Try by id, fallback to slug if implemented in DB
    let member = null;
    if(!isNaN(idOrSlug)) {
      member = await db.getTeamMember(idOrSlug);
  } else if(db.getTeamMemberBySlug) {
    // Try current language first
    member = await db.getTeamMemberBySlug(res.locals.lang, idOrSlug);
    if(!member){
      // Fallback: search other languages to find group
      const langs = ['en','sk','hu'];
      for(const l of langs){
        member = await db.getTeamMemberBySlug(l, idOrSlug).catch(()=>null);
        if(member) break;
      }
    }
  }
  const pages = await db.listPages(res.locals.lang);
  const menu = buildMenu(pages);
  if(!member){
    return res.status(404).render('page', { 
      menu, 
      page: { title: res.locals.t('teamNotFound'), content: `<p>${res.locals.t('teamNotFound')}</p>` }, 
      lang: res.locals.lang, 
      slider: null,
      t: res.locals.t
    });
  }
  // Resolve to the current language variant when grouped
  try{
    member = await resolveTeamVariant(member, res.locals.lang);
  } catch {}
  const photo = member.photo_url || '';
  const socials = [
    member.facebook ? `<a class="btn btn-sm btn-outline-primary me-2" href="${member.facebook}" target="_blank" rel="noopener"><i class="fab fa-facebook-f"></i></a>` : '',
    member.twitter ? `<a class="btn btn-sm btn-outline-primary me-2" href="${member.twitter}" target="_blank" rel="noopener"><i class="fab fa-x-twitter"></i></a>` : '',
    member.instagram ? `<a class="btn btn-sm btn-outline-primary me-2" href="${member.instagram}" target="_blank" rel="noopener"><i class="fab fa-instagram"></i></a>` : '',
    member.linkedin ? `<a class="btn btn-sm btn-outline-primary me-2" href="${member.linkedin}" target="_blank" rel="noopener"><i class="fab fa-linkedin-in"></i></a>` : ''
  ].filter(Boolean).join('');
  const html = `
    <div class="bg-white p-4 rounded">
      <div class="row g-4 align-items-start">
        <div class="col-md-4">
          ${photo ? `<a href="${photo}" class="lightbox" data-gallery="team-${member.id}"><img src="${photo}" alt="${member.name}" class="img-fluid rounded w-100" style="object-fit:cover;"></a>` : ''}
        </div>
        <div class="col-md-8">
          <h3 class="mb-1">${member.name}</h3>
          ${member.role ? `<p class="text-muted mb-3">${member.role}</p>` : ''}
          ${socials ? `<div class="mb-3">${socials}</div>` : ''}
          <div class="content lead">${member.bio || ''}</div>
        </div>
      </div>
    </div>`;
  const sh = { kicker: res.locals.t('teamKicker'), heading: member.name, subheading: '' };
  return res.render('page', { menu, page: { title: res.locals.t('team'), content: html, image_url: '' }, lang: res.locals.lang, slider: null, sectionHeader: sh, backLink: `/team?lang=${res.locals.lang}`, t: res.locals.t });
  } catch(err) {
    console.error('[app.get /team/:id] Database error:', err.message);
    return res.status(500).send('Database connection error. Please try again later.');
  }
});

// Partners public page
app.get('/partners', async (req, res) => {
  try {
    const pages = await db.listPages(res.locals.lang);
    const menu = buildMenu(pages);
    const partners = await db.listPartners();
    
    res.render('page', {
      menu,
      slider: null,
      page: {
        title: '',
        slug: 'partners',
        content: `
          <div class="container-xxl py-5">
            <div class="container">
              <div class="text-center mx-auto mb-5 wow fadeInUp" data-wow-delay="0.1s" style="max-width: 500px;">
                <div class="d-inline-block rounded-pill bg-secondary text-primary py-1 px-3 mb-3">${res.locals.t('ourPartners')}</div>
                <h1 class="display-6 mb-5">${res.locals.t('partnersTitle')}</h1>
              </div>
              <div class="row g-4 justify-content-center">
                ${partners.map(p => `
                  <div class="col-lg-3 col-md-4 col-sm-6 wow fadeInUp" data-wow-delay="0.1s">
                    <div class="partner-item text-center p-4" style="background: #fff; border-radius: 10px; box-shadow: 0 0 45px rgba(0,0,0,.08); min-height: 200px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                      ${p.logo_url ? `<img src="${p.logo_url}" alt="${p.name}" style="max-width: 100%; max-height: 150px; object-fit: contain; margin-bottom: 15px;">` : ''}
                      <h5 class="mb-0">${p.name}</h5>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        `
      },
      lang: res.locals.lang,
      t: res.locals.t
    });
  } catch (err) {
    console.error('[app.get /partners] Database error:', err.message);
    return res.status(500).send('Database connection error. Please try again later.');
  }
});

// News public page
app.get('/news', async (req, res) => {
  try {
    const pages = await db.listPages(res.locals.lang);
    const menu = buildMenu(pages);
    const news = await db.listPublishedNews(res.locals.lang);
      const cards = news.map(n => {
        const listImage = n.image_url && String(n.image_url).trim() ? n.image_url : '/img/placeholder-news.svg';
        return `
        <div class="col-lg-6 col-md-12 mb-4">
          <div class="card bg-light shadow-sm h-100 d-flex flex-column">
            <a href="/news/${n.slug || n.id}?lang=${res.locals.lang}">
              <img src="${listImage}" class="card-img-top" alt="${n.title}" style="height: 200px; object-fit: cover;">
            </a>
            <div class="card-body d-flex flex-column">
              <h5 class="card-title text-primary mb-2">${n.title}</h5>
              ${n.published_at ? `<p class="card-text text-muted small"><i class="fas fa-calendar me-1"></i>${new Date(n.published_at).toLocaleDateString()}</p>` : ''}
              <p class="card-text">${n.summary ? n.summary.substring(0, 150) + (n.summary.length > 150 ? '...' : '') : ''}</p>
              <div class="mt-auto pt-2">
                <a href="/news/${n.slug || n.id}?lang=${res.locals.lang}" class="btn btn-primary btn-sm w-100 text-center">
                  <i class="fas fa-eye me-1"></i>${res.locals.t('readMore')}
                </a>
              </div>
            </div>
          </div>
        </div>
      `}).join('');
    const html = `<div class="row">${cards || `<div class=\"text-muted\">${res.locals.t('noNewsYet')}</div>`}</div>`;
  const shNews = { kicker: res.locals.t('newsKicker'), heading: res.locals.t('newsHeading'), subheading: '' };
  return res.render('page', { menu, page: { title: res.locals.t('newsTitle'), content: html }, lang: res.locals.lang, slider: null, sectionHeader: shNews, t: res.locals.t });
  } catch(err) {
    console.error('[app.get /news] Database error:', err.message);
    return res.status(500).send('Database connection error. Please try again later.');
  }
});

// News detail page
app.get('/news/:slug', async (req, res) => {
  try {
    const idOrSlug = req.params.slug;
    let news = isNaN(idOrSlug) ? await db.getNewsBySlug(idOrSlug, res.locals.lang) : await db.getNews(idOrSlug);
  // If not found by slug in current language, try other languages to locate the group, then resolve to requested language
  if(!news && isNaN(idOrSlug)){
    try{
      const langs = ['en','sk','hu'];
      for(const l of langs){
        const n = await db.getNewsBySlug(idOrSlug, l).catch(()=>null);
        if(n){ news = n; break; }
      }
    }catch{}
  }
  if(!news){
    return res.status(404).render('page', { 
      menu: [], 
      page: { title: res.locals.t('newsNotFound'), content: '<p>'+res.locals.t('newsNotFound')+'</p>' }, 
      lang: res.locals.lang, 
      slider: null,
      t: res.locals.t 
    });
  }
  // Resolve to the current language variant when possible (same approach as events)
  try{
    if(news.group_id){
      const cur = await db.getNewsByGroupAndLang?.(news.group_id, res.locals.lang);
      if(cur){
        news = cur;
      } else {
        const en = await db.getNewsByGroupAndLang?.(news.group_id, 'en');
        const sk = await db.getNewsByGroupAndLang?.(news.group_id, 'sk');
        const hu = await db.getNewsByGroupAndLang?.(news.group_id, 'hu');
        news = en || sk || hu || news;
      }
    }
  } catch {}
  const pages = await db.listPages(res.locals.lang);
  const menu = buildMenu(pages);
  const ownerId = await resolveNewsGalleryOwnerId(news);
  const additionalImages = await db.getAdditionalImages('news', ownerId);
  const summary = news.summary ? `<p class="lead mb-3">${news.summary}</p>` : '';
  const gallery = (additionalImages && additionalImages.length) ? `
    <div class="mt-4">
      <h3 class="mb-3">${res.locals.t('gallery')}</h3>
      <div class="row g-3">
        ${additionalImages.map((img)=>`
          <div class="col-md-4">
            <a href="${img.image_url}" class="lightbox" data-gallery="news-${ownerId}">
              <div class="card bg-light"><img src="${img.image_url}" class="card-img-top" alt="News image" style="height:200px;object-fit:cover;"></div>
            </a>
          </div>`).join('')}
      </div>
    </div>` : '';
  const shareUrlN = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const encUrlN = encodeURIComponent(shareUrlN);
  const encTitleN = encodeURIComponent(news.title || 'News');
  const shareN = `
    <div class="mt-4 pt-3 border-top">
      <div class="d-flex align-items-center gap-2 flex-wrap">
  <span class="text-muted me-2">${res.locals.t('share')}</span>
        <a class="btn btn-outline-secondary btn-sm" href="https://www.facebook.com/sharer/sharer.php?u=${encUrlN}" target="_blank" rel="noopener" aria-label="Share on Facebook"><i class="fab fa-facebook-f me-1"></i>Facebook</a>
        <a class="btn btn-outline-secondary btn-sm" href="https://twitter.com/intent/tweet?url=${encUrlN}&text=${encTitleN}" target="_blank" rel="noopener" aria-label="Share on X"><i class="fab fa-x-twitter me-1"></i>Twitter</a>
        <a class="btn btn-outline-secondary btn-sm" href="https://www.linkedin.com/shareArticle?mini=true&url=${encUrlN}&title=${encTitleN}" target="_blank" rel="noopener" aria-label="Share on LinkedIn"><i class="fab fa-linkedin-in me-1"></i>LinkedIn</a>
        <a class="btn btn-outline-secondary btn-sm" href="https://wa.me/?text=${encTitleN}%20${encUrlN}" target="_blank" rel="noopener" aria-label="Share on WhatsApp"><i class="fab fa-whatsapp me-1"></i>WhatsApp</a>
  <a class="btn btn-outline-secondary btn-sm copy-link" href="#" data-copy="${shareUrlN}" aria-label="Copy link"><i class="fas fa-link me-1"></i>${res.locals.t('copy')}</a>
      </div>
    </div>`;
  const html = `
    <div class="bg-white p-4 rounded">
      ${summary}
      <div class="content lead">${news.content || ''}</div>
      ${gallery}
      ${shareN}
    </div>`;
  const sh = { kicker: res.locals.t('newsKicker'), heading: news.title, subheading: '' };
  return res.render('page', { menu, page: { title: '', content: html, image_url: news.image_url || '' }, lang: res.locals.lang, slider: null, sectionHeader: sh, backLink: `/news?lang=${res.locals.lang}`, t: res.locals.t });
  } catch(err) {
    console.error('[app.get /news/:slug] Database error:', err.message);
    return res.status(500).send('Database connection error. Please try again later.');
  }
});

// In serverless environments (e.g., Vercel) we do NOT call listen();
// instead, we export the Express app for the platform to handle requests.
let server;
if (!isServerless) {
  server = app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });

  // Graceful shutdown handlers (only when we own the listener)
  process.on('SIGTERM', () => {
    try { server.close(() => process.exit(0)); } catch { process.exit(0); }
  });
  process.on('SIGINT', () => {
    try { server.close(() => process.exit(0)); } catch { process.exit(0); }
  });

  // Keep the process alive in terminals that auto-close when stdio ends
  if (process.stdin && typeof process.stdin.resume === 'function') {
    try { process.stdin.resume(); } catch {}
  }
}

console.log('[app.js] Module loading COMPLETE, exporting app');
// Export the app for serverless platforms (Vercel, etc.)
export default app;