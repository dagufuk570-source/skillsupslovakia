import { updateSettings } from '../db/postgres.js';

const slider = [
  { image_url: '/slider-sample.svg', title: 'Welcome', caption: 'Explore our themes and events', link: '' }
];

for (const lang of ['en','sk','hu']) {
  await updateSettings(lang, { slider });
  console.log(`Seeded slider for ${lang}`);
}

console.log('Done');
