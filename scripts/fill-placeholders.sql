-- Replaces leftover sample content (hero text, counter labels, About page) with real copy in EN / SK / HU.
-- Everything stays editable in the admin. Safe to run more than once.
-- In the hero title, *asterisks* mark the highlighted words.

-- Hero (admin: Settings > Slider)
UPDATE settings SET updated_at = now(), config = jsonb_set(config, '{slider}', '[{"link": "", "title": "Preparing youth and schools for a *green and digital* future", "caption": "We connect education with communities to deliver hands-on impact in sustainability and digital skills."}]'::jsonb) WHERE lang = 'en';
UPDATE settings SET updated_at = now(), config = jsonb_set(config, '{slider}', '[{"link": "", "title": "Pripravujeme mladých ľudí a školy na *zelenú a digitálnu* budúcnosť", "caption": "Prepájame vzdelávanie s komunitami a prinášame praktický dopad v oblasti udržateľnosti a digitálnych zručností."}]'::jsonb) WHERE lang = 'sk';
UPDATE settings SET updated_at = now(), config = jsonb_set(config, '{slider}', '[{"link": "", "title": "Felkészítjük a fiatalokat és az iskolákat a *zöld és digitális* jövőre", "caption": "Összekapcsoljuk az oktatást a közösségekkel, hogy kézzelfogható eredményeket érjünk el a fenntarthatóság és a digitális készségek terén."}]'::jsonb) WHERE lang = 'hu';

-- Counter labels (admin: Settings > Stats); values, icons and order are kept
UPDATE settings SET updated_at = now(), config = jsonb_set(config, '{stats}', (
  SELECT jsonb_agg(jsonb_set(s.item, '{labels}', (ARRAY[
    '{"en": "Projects", "sk": "Projekty", "hu": "Projektek"}',
    '{"en": "Participants", "sk": "Účastníci", "hu": "Résztvevők"}',
    '{"en": "Teachers trained", "sk": "Vyškolení učitelia", "hu": "Képzett tanárok"}',
    '{"en": "Events", "sk": "Podujatia", "hu": "Rendezvények"}'
  ])[s.n::int]::jsonb) ORDER BY s.n)
  FROM jsonb_array_elements(config->'stats') WITH ORDINALITY AS s(item, n)
))
WHERE jsonb_array_length(config->'stats') = 4 AND config->'stats'->0->'labels'->>'hu' = 'Number of projects hu';

-- About page (admin: Pages > About us)
UPDATE pages SET content = to_jsonb('<p>SkillUp Slovakia is a non-profit organisation based in Čierny Brod. We bring learning beyond the classroom and into the community, so that young people and schools can meet the green and digital transition with confidence.</p><p>We combine project-based and inclusive learning with teacher training, youth workshops, and Erasmus+ and European Solidarity Corps opportunities. Our programmes cover climate literacy, the basics of artificial intelligence and data safety, 3D design, energy efficiency and the circular economy.</p><p>We work together with schools, municipalities, NGOs and social enterprises in Slovakia and across Europe. If your school or organisation is looking for a partner, we will be glad to hear from you.</p>'::text)
  WHERE slug = 'about-us' AND lang = 'en' AND content::text LIKE '%About our organization.%';
UPDATE pages SET content = to_jsonb('<p>SkillUp Slovakia je nezisková organizácia so sídlom v Čiernom Brode. Prinášame vzdelávanie z triedy do komunity, aby mladí ľudia a školy zvládli zelenú a digitálnu transformáciu s istotou.</p><p>Spájame projektové a inkluzívne vzdelávanie so vzdelávaním učiteľov, workshopmi pre mládež a príležitosťami v programoch Erasmus+ a Európsky zbor solidarity. Naše programy sa venujú klimatickej gramotnosti, základom umelej inteligencie a bezpečnosti dát, 3D dizajnu, energetickej efektívnosti a obehovému hospodárstvu.</p><p>Spolupracujeme so školami, samosprávami, mimovládnymi organizáciami a sociálnymi podnikmi na Slovensku aj v Európe. Ak vaša škola alebo organizácia hľadá partnera, radi sa vám ozveme.</p>'::text)
  WHERE slug = 'about-us' AND lang = 'sk' AND content::text LIKE '%About our organization.%';
UPDATE pages SET content = to_jsonb('<p>A SkillUp Slovakia feketenyéki (Čierny Brod) székhelyű nonprofit szervezet. A tanulást az osztályteremből a közösségbe visszük, hogy a fiatalok és az iskolák magabiztosan nézzenek szembe a zöld és digitális átállással.</p><p>A projektalapú és befogadó tanulást tanárképzéssel, ifjúsági műhelyekkel, valamint Erasmus+ és Európai Szolidaritási Testület lehetőségekkel ötvözzük. Programjaink témái: klímatudatosság, a mesterséges intelligencia és az adatbiztonság alapjai, 3D tervezés, energiahatékonyság és körforgásos gazdaság.</p><p>Iskolákkal, önkormányzatokkal, civil szervezetekkel és társadalmi vállalkozásokkal dolgozunk együtt Szlovákiában és Európa-szerte. Ha iskolája vagy szervezete partnert keres, örömmel várjuk jelentkezését.</p>'::text)
  WHERE slug = 'about-us' AND lang = 'hu' AND content::text LIKE '%About our organization.%';
