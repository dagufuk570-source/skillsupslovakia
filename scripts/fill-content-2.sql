-- Stock photos for themes / events / hero, a first news item, and the new domain in the GDPR page.
-- The photo files live in public/uploads/stock/ (free Unsplash licence). Safe to run more than once.

-- Themes: one photo per theme, shared by all languages (the original uploads were lost in the hosting move)
UPDATE themes t SET image_url = v.url, updated_at = now()
FROM (VALUES
  ('artificial-intelligence-digital-innovation', '/uploads/stock/theme-ai-digital-innovation.webp'),
  ('climate-action', '/uploads/stock/theme-climate-action.webp'),
  ('green-competences-and-sustainable-development', '/uploads/stock/theme-green-competences.webp'),
  ('ai-xr-a-vr', '/uploads/stock/theme-ai-xr-vr.webp'),
  ('digital-transformation', '/uploads/stock/theme-digital-transformation.webp'),
  ('language-and-intercultural-dialogue', '/uploads/stock/theme-language-dialogue.webp'),
  ('sports-and-games', '/uploads/stock/theme-sports-games.webp'),
  ('ste-a-m-a-inovacie', '/uploads/stock/theme-steam-innovation.webp'),
  ('inkluzia-a-specialne-potreby', '/uploads/stock/theme-inclusion.webp')
) AS v(slug, url)
WHERE t.group_id = (SELECT group_id FROM themes WHERE slug = v.slug AND lang = 'en' LIMIT 1);

-- Events: representative photos
UPDATE events e SET image_url = v.url, updated_at = now()
FROM (VALUES
  ('Climate Action Week%', '/uploads/stock/event-climate-week.webp'),
  ('AI Discovery Day%', '/uploads/stock/event-ai-discovery-day.webp'),
  ('Coding & AI Basics%', '/uploads/stock/event-coding-workshop.webp')
) AS v(title, url)
WHERE e.group_id = (SELECT group_id FROM events WHERE title LIKE v.title AND lang = 'en' LIMIT 1);

-- Hero photos (admin: Settings > Slider > background gallery); different from the photos further down the home page
UPDATE settings SET updated_at = now(), config = jsonb_set(config, '{slider_bg_gallery}',
  '["/uploads/stock/hero-vr-learning.webp", "/uploads/stock/hero-youth-sport.webp", "/uploads/slider/download-3--1761083499384.png"]'::jsonb);

-- First news item, so the list and the detail page have something to show
INSERT INTO news (lang, slug, group_id, title, summary, content, image_url, published_at, is_published)
SELECT v.lang, v.slug, 'news-website-launch-2026', v.title, v.summary, v.content, '/uploads/stock/news-website-launch.webp', now(), true
FROM (VALUES
  ('en', 'our-new-website-is-live', 'Our new website is live',
   'SkillUp Slovakia has a new home online: a faster site in three languages, with our themes, events and team in one place.',
   '<p>We are happy to share that the new SkillUp Slovakia website is online at <strong>skillupslovakia.com</strong>.</p><p>The site is available in English, Slovak and Hungarian. It brings together our themes, focus areas, events and team, and it works well on phones as well as on computers. You can also switch between a light and a dark look.</p><h3>What you can find here</h3><ul><li>Our themes, from climate action to artificial intelligence and inclusion</li><li>Upcoming and past events for schools, teachers and young people</li><li>The people behind our programmes</li><li>Documents and news about our projects</li></ul><p>We will keep adding news from our workshops and partnerships. If your school or organisation would like to work with us, please use the contact page.</p>'),
  ('sk', 'nasa-nova-webova-stranka-je-spustena', 'Naša nová webová stránka je spustená',
   'SkillUp Slovakia má nový domov na internete: rýchlejšiu stránku v troch jazykoch, kde nájdete naše témy, podujatia a tím na jednom mieste.',
   '<p>S radosťou oznamujeme, že nová webová stránka SkillUp Slovakia je dostupná na adrese <strong>skillupslovakia.com</strong>.</p><p>Stránka je k dispozícii v angličtine, slovenčine a maďarčine. Spája naše témy, zamerania, podujatia a tím a dobre sa používa na telefóne aj na počítači. Môžete si tiež zvoliť svetlý alebo tmavý vzhľad.</p><h3>Čo tu nájdete</h3><ul><li>Naše témy, od ochrany klímy cez umelú inteligenciu až po inklúziu</li><li>Pripravované aj uplynulé podujatia pre školy, učiteľov a mladých ľudí</li><li>Ľudí, ktorí stoja za našimi programami</li><li>Dokumenty a novinky o našich projektoch</li></ul><p>Postupne budeme pridávať novinky z našich workshopov a partnerstiev. Ak by vaša škola alebo organizácia chcela s nami spolupracovať, napíšte nám cez kontaktnú stránku.</p>'),
  ('hu', 'elindult-uj-weboldalunk', 'Elindult új weboldalunk',
   'A SkillUp Slovakia új otthonra talált az interneten: gyorsabb, háromnyelvű oldal, ahol témáink, rendezvényeink és csapatunk egy helyen érhetők el.',
   '<p>Örömmel jelentjük, hogy a SkillUp Slovakia új weboldala elérhető a <strong>skillupslovakia.com</strong> címen.</p><p>Az oldal angolul, szlovákul és magyarul olvasható. Egy helyen mutatja be témáinkat, fókuszterületeinket, rendezvényeinket és csapatunkat, és telefonon is kényelmesen használható. Világos és sötét megjelenés között is lehet váltani.</p><h3>Mit talál itt</h3><ul><li>Témáinkat az éghajlatvédelemtől a mesterséges intelligencián át az inklúzióig</li><li>Közelgő és korábbi rendezvényeinket iskoláknak, tanároknak és fiataloknak</li><li>A programjaink mögött álló embereket</li><li>Dokumentumokat és híreket projektjeinkről</li></ul><p>Folyamatosan beszámolunk majd műhelyeinkről és partnerségeinkről. Ha iskolája vagy szervezete szívesen együttműködne velünk, írjon nekünk a kapcsolat oldalon.</p>')
) AS v(lang, slug, title, summary, content)
WHERE NOT EXISTS (SELECT 1 FROM news WHERE group_id = 'news-website-launch-2026');

-- GDPR page: the organisation moved from skillsupslovakia.org to skillupslovakia.com
UPDATE pages SET content = replace(content::text, 'skillsupslovakia.org', 'skillupslovakia.com')::jsonb
WHERE slug = 'gdpr' AND content::text LIKE '%skillsupslovakia.org%';

-- About page: the photo of the mission block was lost in the hosting move
UPDATE additional_images SET image_url = '/uploads/stock/about-mission.webp' WHERE image_url = '/uploads/pages/home-1--1761334803310.png';
