// Storage layer: files live on the server's disk under public/uploads and are
// served by Nginx/Express at /uploads/... (Hetzner server, no Vercel Blob).
import path from 'path';
import { fileURLToPath } from 'url';
import fsSync from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');

/**
 * Save a file (buffer or local path) under public/uploads
 * @param {Buffer|string} fileData - File buffer or local file path
 * @param {string} filename - Relative name, e.g. "events/image-123.jpg"
 * @returns {Promise<string>} - Public URL path, e.g. "/uploads/events/image-123.jpg"
 */
export async function uploadFile(fileData, filename) {
  const fullPath = path.join(uploadsDir, filename);
  if (!fullPath.startsWith(uploadsDir + path.sep)) {
    throw new Error('Invalid upload path');
  }
  fsSync.mkdirSync(path.dirname(fullPath), { recursive: true });
  if (Buffer.isBuffer(fileData)) {
    fsSync.writeFileSync(fullPath, fileData);
  } else if (path.resolve(fileData) !== fullPath) {
    fsSync.copyFileSync(fileData, fullPath);
  }
  return `/uploads/${filename.split(path.sep).join('/')}`;
}

/**
 * Delete a file previously saved by uploadFile()
 * @param {string} urlOrPath - "/uploads/..." path (other URLs are ignored)
 */
export async function deleteFile(urlOrPath) {
  if (!urlOrPath || !urlOrPath.startsWith('/uploads/')) return;
  const localPath = path.join(__dirname, '..', 'public', urlOrPath);
  if (!localPath.startsWith(uploadsDir + path.sep)) return;
  try {
    if (fsSync.existsSync(localPath)) fsSync.unlinkSync(localPath);
  } catch (error) {
    console.warn('[storage] Local delete failed:', error.message);
  }
}

export default { uploadFile, deleteFile };
