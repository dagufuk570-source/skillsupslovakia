import sharp from 'sharp';

const svg = `<svg width="300" height="300">
  <rect width="300" height="300" fill="#f3f3f3"/>
  <text x="150" y="150" font-size="60" fill="#999" text-anchor="middle" dominant-baseline="middle">Partner</text>
</svg>`;

sharp(Buffer.from(svg))
  .png()
  .toFile('public/img/default-partner.png')
  .then(() => console.log('Default partner logo created at public/img/default-partner.png'))
  .catch(err => console.error('Error:', err));
