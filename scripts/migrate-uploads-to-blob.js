/**
 * Migrate local uploads to Vercel Blob Storage and update database URLs
 * 
 * This script:
 * 1. Scans public/uploads/ for all files
 * 2. Uploads each to Vercel Blob Storage
 * 3. Updates database records (events, news, themes, team, documents, pages, settings)
 * 4. Generates a report of migrated files
 */

import { uploadFile } from '../lib/storage.js';
import * as db from '../db/postgres.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
const dryRun = process.argv.includes('--dry-run');

console.log('🚀 Starting migration to Vercel Blob Storage...');
console.log(`📁 Uploads directory: ${uploadsDir}`);
console.log(`🔍 Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE (will update DB)'}\n`);

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('❌ BLOB_READ_WRITE_TOKEN not found in environment variables!');
  console.error('   Please set it in .env or environment before running this script.');
  process.exit(1);
}

// Get all files recursively
function getFilesRecursive(dir, baseDir = dir) {
  const files = [];
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    if (item === '.gitkeep') continue;
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      files.push(...getFilesRecursive(fullPath, baseDir));
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
  
  return files;
}

// Upload file to Blob Storage
async function uploadToBlob(file) {
  try {
    const buffer = fs.readFileSync(file.fullPath);
    const ext = path.extname(file.relativePath).toLowerCase();
    
    // Determine content type
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
    
    // Upload with original filename structure
    const blobUrl = await uploadFile(buffer, file.relativePath, contentType);
    
    console.log(`  ✅ ${file.relativePath} → ${blobUrl}`);
    
    return blobUrl;
  } catch (err) {
    console.error(`  ❌ Failed to upload ${file.relativePath}:`, err.message);
    return null;
  }
}

// Update database references
async function updateDatabaseUrls(oldUrl, newUrl) {
  const updates = [];
  
  try {
    // 1. Events (lead_image_url, images array)
    const events = await db.query('SELECT id, data FROM events');
    for (const event of events.rows) {
      const data = event.data || {};
      let changed = false;
      
      if (data.lead_image_url === oldUrl) {
        data.lead_image_url = newUrl;
        changed = true;
      }
      
      if (Array.isArray(data.images)) {
        data.images = data.images.map(img => img === oldUrl ? newUrl : img);
        if (data.images.includes(newUrl)) changed = true;
      }
      
      if (changed) {
        await db.query('UPDATE events SET data = $1 WHERE id = $2', [data, event.id]);
        updates.push(`Event #${event.id}`);
      }
    }
    
    // 2. News (lead_image_url, images array)
    const news = await db.query('SELECT id, data FROM news');
    for (const article of news.rows) {
      const data = article.data || {};
      let changed = false;
      
      if (data.lead_image_url === oldUrl) {
        data.lead_image_url = newUrl;
        changed = true;
      }
      
      if (Array.isArray(data.images)) {
        data.images = data.images.map(img => img === oldUrl ? newUrl : img);
        if (data.images.includes(newUrl)) changed = true;
      }
      
      if (changed) {
        await db.query('UPDATE news SET data = $1 WHERE id = $2', [data, article.id]);
        updates.push(`News #${article.id}`);
      }
    }
    
    // 3. Themes (lead_image_url, images array)
    const themes = await db.query('SELECT id, data FROM themes');
    for (const theme of themes.rows) {
      const data = theme.data || {};
      let changed = false;
      
      if (data.lead_image_url === oldUrl) {
        data.lead_image_url = newUrl;
        changed = true;
      }
      
      if (Array.isArray(data.images)) {
        data.images = data.images.map(img => img === oldUrl ? newUrl : img);
        if (data.images.includes(newUrl)) changed = true;
      }
      
      if (changed) {
        await db.query('UPDATE themes SET data = $1 WHERE id = $2', [data, theme.id]);
        updates.push(`Theme #${theme.id}`);
      }
    }
    
    // 4. Team (photo_url, thumbnail_url)
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
    
    // 5. Documents (file_url)
    const docs = await db.query('SELECT id, data FROM documents');
    for (const doc of docs.rows) {
      const data = doc.data || {};
      let changed = false;
      
      if (data.file_url === oldUrl) {
        data.file_url = newUrl;
        changed = true;
      }
      
      if (changed) {
        await db.query('UPDATE documents SET data = $1 WHERE id = $2', [data, doc.id]);
        updates.push(`Document #${doc.id}`);
      }
    }
    
    // 6. Pages (image_url, cover_image_url)
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
    
    // 7. Settings (slider_bg_image_url, slider_bg_gallery)
    const settings = await db.query('SELECT lang, data FROM settings');
    for (const setting of settings.rows) {
      const data = setting.data || {};
      let changed = false;
      
      if (data.slider_bg_image_url === oldUrl) {
        data.slider_bg_image_url = newUrl;
        changed = true;
      }
      
      if (Array.isArray(data.slider_bg_gallery)) {
        data.slider_bg_gallery = data.slider_bg_gallery.map(img => img === oldUrl ? newUrl : img);
        if (data.slider_bg_gallery.includes(newUrl)) changed = true;
      }
      
      if (changed) {
        await db.query('UPDATE settings SET data = $1 WHERE lang = $2', [data, setting.lang]);
        updates.push(`Settings (${setting.lang})`);
      }
    }
    
  } catch (err) {
    console.error(`  ⚠️  DB update error for ${oldUrl}:`, err.message);
  }
  
  return updates;
}

// Main migration
async function migrate() {
  try {
    // Ensure DB connection
    await db.ping();
    console.log('✅ Database connected\n');
    
    // Get all files
    const files = getFilesRecursive(uploadsDir);
    console.log(`📊 Found ${files.length} files to migrate\n`);
    
    if (files.length === 0) {
      console.log('✅ No files to migrate');
      return;
    }
    
    const report = {
      total: files.length,
      uploaded: 0,
      failed: 0,
      dbUpdates: 0,
      startTime: Date.now()
    };
    
    // Process files one by one
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      console.log(`[${i + 1}/${files.length}] Processing: ${file.relativePath}`);
      
      if (dryRun) {
        console.log(`  🔍 DRY RUN: Would upload ${file.oldUrl}`);
        continue;
      }
      
      // Upload to Blob
      const newUrl = await uploadToBlob(file);
      
      if (!newUrl) {
        report.failed++;
        continue;
      }
      
      report.uploaded++;
      
      // Update database references
      const updates = await updateDatabaseUrls(file.oldUrl, newUrl);
      report.dbUpdates += updates.length;
      
      if (updates.length > 0) {
        console.log(`  📝 Updated ${updates.length} DB records: ${updates.join(', ')}`);
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    const duration = ((Date.now() - report.startTime) / 1000).toFixed(1);
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ Migration completed!');
    console.log('='.repeat(60));
    console.log(`📊 Total files: ${report.total}`);
    console.log(`✅ Uploaded: ${report.uploaded}`);
    console.log(`❌ Failed: ${report.failed}`);
    console.log(`📝 DB updates: ${report.dbUpdates}`);
    console.log(`⏱️  Duration: ${duration}s`);
    console.log('='.repeat(60));
    
    if (dryRun) {
      console.log('\n💡 This was a DRY RUN - no changes were made');
      console.log('   Run without --dry-run to perform actual migration');
    }
    
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await db.end();
  }
}

migrate();
