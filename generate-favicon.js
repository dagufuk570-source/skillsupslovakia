import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logoPath = join(__dirname, 'public', 'img', 'logo.png');
const faviconDir = join(__dirname, 'public');

async function generateFavicons() {
  try {
    // Generate favicon.ico (32x32)
    await sharp(logoPath)
      .resize(32, 32, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toFile(join(faviconDir, 'favicon-32x32.png'));
    
    console.log('✓ Generated favicon-32x32.png');

    // Generate favicon.ico (16x16)
    await sharp(logoPath)
      .resize(16, 16, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toFile(join(faviconDir, 'favicon-16x16.png'));
    
    console.log('✓ Generated favicon-16x16.png');

    // Generate apple-touch-icon (180x180)
    await sharp(logoPath)
      .resize(180, 180, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toFile(join(faviconDir, 'apple-touch-icon.png'));
    
    console.log('✓ Generated apple-touch-icon.png');

    console.log('\n✅ All favicons generated successfully!');
    console.log('Now run this on the server to use PNG favicon:');
    console.log('scp public/favicon-*.png public/apple-touch-icon.png root@37.148.211.145:/var/www/skillsupslovakia/public/');
  } catch (error) {
    console.error('Error generating favicons:', error);
    process.exit(1);
  }
}

generateFavicons();
