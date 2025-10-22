// Storage abstraction layer: Vercel Blob (serverless) or local disk (development)
import { put } from '@vercel/blob';
import path from 'path';
import { fileURLToPath } from 'url';
import fsSync from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Detect environment
const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);

// Storage type can be explicitly set via STORAGE_TYPE env var
// Options: 'blob' or 'disk' (default: auto-detect based on environment)
const storageType = process.env.STORAGE_TYPE || (isServerless ? 'blob' : 'disk');
const useBlob = storageType === 'blob' && process.env.BLOB_READ_WRITE_TOKEN;

console.log('[storage] Environment:', isServerless ? 'Serverless' : 'Traditional server');
console.log('[storage] Storage type:', useBlob ? 'Vercel Blob' : 'Local disk');
console.log('[storage] STORAGE_TYPE env:', process.env.STORAGE_TYPE || '(auto)');

/**
 * Upload a file (buffer or path) to storage
 * @param {Buffer|string} fileData - File buffer or local file path
 * @param {string} filename - Desired filename (e.g., "events/image-123.jpg")
 * @param {string} contentType - MIME type (e.g., "image/jpeg")
 * @returns {Promise<string>} - Public URL of uploaded file
 */
export async function uploadFile(fileData, filename, contentType = 'application/octet-stream') {
  if (useBlob) {
    // Vercel Blob Storage
    try {
      const buffer = Buffer.isBuffer(fileData) 
        ? fileData 
        : fsSync.readFileSync(fileData);
      
      const blob = await put(filename, buffer, {
        access: 'public',
        contentType,
        addRandomSuffix: false // We already add timestamp in filename
      });
      
      console.log('[storage] Uploaded to Blob:', blob.url);
      return blob.url;
    } catch (error) {
      console.error('[storage] Blob upload failed:', error);
      throw error;
    }
  } else {
    // Local disk (development)
    const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
    const fullPath = path.join(uploadsDir, filename);
    const dir = path.dirname(fullPath);
    
    // Ensure directory exists
    if (!fsSync.existsSync(dir)) {
      fsSync.mkdirSync(dir, { recursive: true });
    }
    
    if (Buffer.isBuffer(fileData)) {
      fsSync.writeFileSync(fullPath, fileData);
    } else {
      fsSync.copyFileSync(fileData, fullPath);
    }
    
    const url = `/uploads/${filename}`;
    console.log('[storage] Saved locally:', url);
    return url;
  }
}

/**
 * Delete a file from storage
 * @param {string} urlOrPath - Full URL or relative path (e.g., "/uploads/events/image.jpg" or "https://...")
 */
export async function deleteFile(urlOrPath) {
  if (!urlOrPath) return;
  
  if (useBlob && urlOrPath.startsWith('http')) {
    // Vercel Blob: use del() API
    try {
      const { del } = await import('@vercel/blob');
      await del(urlOrPath);
      console.log('[storage] Deleted from Blob:', urlOrPath);
    } catch (error) {
      console.warn('[storage] Blob delete failed:', error.message);
    }
  } else {
    // Local disk
    try {
      const localPath = urlOrPath.startsWith('/uploads/') 
        ? path.join(__dirname, '..', 'public', urlOrPath)
        : urlOrPath;
      
      if (fsSync.existsSync(localPath)) {
        fsSync.unlinkSync(localPath);
        console.log('[storage] Deleted locally:', localPath);
      }
    } catch (error) {
      console.warn('[storage] Local delete failed:', error.message);
    }
  }
}

export default { uploadFile, deleteFile };
