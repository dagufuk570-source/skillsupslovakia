# Multilingual demo site

This small Express app provides a 3-language (English, Slovak, Hungarian) site with pages:

- Home
- About us
- Themes
- Focus areas
- Events
- Our team
- GDPR
- Contact

How it works:

- Content lives in `content.json`. Edit it via the admin UI at `/admin` or directly in the file.
-- Switch language by adding `?lang=en` (or `sk` or `hu`) to URLs.

Quick start (Windows PowerShell):

```powershell
npm install
# set admin credentials (optional)
$env:ADMIN_USER = 'admin'
$env:ADMIN_PASS = 's3cret'

npm start
# open http://localhost:3000/?lang=en
```

Using PostgreSQL (optional):

- If `DATABASE_URL` (or `PG_CONNECTION`) is set, the app will store/read pages in PostgreSQL instead of `content.json`.
- Example connection string:

```powershell
$env:DATABASE_URL = 'postgresql://skills_user:changeme@127.0.0.1:5432/skillsupslovakia'
```

Import initial content to PostgreSQL:

```powershell
$env:DATABASE_URL = 'postgresql://skills_user:changeme@127.0.0.1:5432/skillsupslovakia'
node .\scripts\import-content-to-postgres.js
```

Admin protection (Basic Auth):

- If `ADMIN_USER` and `ADMIN_PASS` are set, `/admin` and `/admin/save` require HTTP Basic auth.
- If they are not set, admin is open (dev convenience). For production, always configure them via env or a `.env` file.

Backend selection:

- By default, the app uses PostgreSQL if a DB connection env is present; otherwise it falls back to `content.json`.
- Force DB mode even if detection fails: set `FORCE_DB=1`.
- Require DB only and exit if DB is unavailable: set `REQUIRE_DB=1`.
- On startup, the app logs the active backend, e.g.:
	- `Backend: PostgreSQL (connected)` or
	- `Backend: content.json (no DB env)`

	logout yok :D
	:DD
	koymamışım :DD
	.env okuyor. 

## Vercel deployment

This project is configured for Vercel serverless deployment:

- **Build:** Vercel automatically runs `npm install` and builds.
- **Serverless handler:** All routes handled by `api/index.js` (Express app).
- **Static files:** Served from `public/` automatically by Vercel.

### Required environment variables (Vercel dashboard)

Set these in Project Settings > Environment Variables:

- `DATABASE_URL`: PostgreSQL connection string (e.g., Supabase)
  - ⚠️ **IMPORTANT for Supabase:** Use the **Session Pooler** (port 6543), not Direct Connection (port 5432)
  - Example: `postgresql://postgres.xxx:[password]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`
  - Find in: Supabase Dashboard > Settings > Database > Connection Pooling > Connection string (Session mode)
- `DATABASE_SSL=1` (optional; auto-detected for Supabase)
- `ADMIN_USER`, `ADMIN_PASS` (optional; protect `/admin` with Basic Auth)
- SMTP settings (optional; for contact form email):
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
  - `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`, `CONTACT_TO`
- reCAPTCHA (optional; for contact form):
  - `RECAPTCHA_SITE_KEY`, `RECAPTCHA_SECRET`

### Why Session Pooler for Supabase?

Serverless functions (Vercel, AWS Lambda) create new connections on every cold start. Without pooling:
- ❌ Connection timeout errors
- ❌ "Too many connections" errors
- ❌ Slow performance

**Solution:** Use Supabase's **Session Pooler** (port 6543) instead of Direct Connection (port 5432).

### File uploads limitation

⚠️ Vercel serverless has **read-only filesystem**. File uploads (`/admin` image uploads) will NOT work unless you integrate:
- Vercel Blob Storage (recommended)
- Cloudinary
- AWS S3 / DigitalOcean Spaces

For now, pre-existing images in `public/uploads/` (committed to git) will work.

### Deploy workflow

1. Push changes to GitHub (main branch).
2. Vercel auto-deploys on each commit.
3. Check logs at Vercel dashboard > Deployments > [your-deploy] > Function Logs.

### Local testing with Vercel CLI (optional)

```powershell
npm install -g vercel
vercel login
vercel dev
```

This simulates serverless locally and reads `.env` for environment variables.
