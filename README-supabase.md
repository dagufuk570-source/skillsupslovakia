# Migrate to Supabase (Step by Step)

This guide shows how to move your local PostgreSQL data to Supabase and run the app against Supabase.

## 0) Prerequisites
- Supabase project ready (Project Settings → Database → Connection string)
- Your local DB running (C:\PostgresDataClean) and accessible at `postgresql://skills_user:changeme@localhost:5432/skillsupslovakia`

## 1) Configure environment
Edit `.env` and add:
```
SOURCE_DATABASE_URL=postgresql://skills_user:changeme@localhost:5432/skillsupslovakia
TARGET_DATABASE_URL=postgresql://postgres:YOUR_SUPABASE_PASSWORD@db.YOURPROJECT.supabase.co:5432/postgres
DATABASE_SSL=1
```
Notes:
- If your Supabase password contains special characters (like `,`), URL-encode them. Examples:
  - `,` → `%2C`
  - `[` → `%5B`, `]` → `%5D`
  - `@` → `%40`
- Do NOT keep bracket placeholders from docs. Use the raw password value (URL-encoded).

## 2) Run migration
```powershell
npm run db:migrate:supabase
```
What it does:
- Creates tables/indexes in Supabase if missing.
- Copies data from local tables: pages, themes, events, news, team_members, documents, additional_images, settings.

Troubleshooting:
- "Source DB not reachable: The server does not support SSL connections" → Local DB doesn’t use SSL. The script already disables SSL for `localhost`/`127.0.0.1`. Ensure your `SOURCE_DATABASE_URL` host is `localhost` or `127.0.0.1`.
- "Target DB not reachable: getaddrinfo ENOTFOUND ...supabase.co" → DNS/Network issue. Ensure internet access and that Windows can resolve the host. If nslookup returns only IPv6 (AAAA) and your network blocks IPv6, enable IPv6 on the adapter or use another network/VPN.

## 3) Point the app to Supabase
Set:
```
DATABASE_URL=postgresql://postgres:YOUR_SUPABASE_PASSWORD@db.YOURPROJECT.supabase.co:5432/postgres
DATABASE_SSL=1
REQUIRE_DB=1
```
Then start:
```powershell
npm start
```

## 4) Verify
- Visit `/` and `/admin?lang=en`
- Multi-language editor: `/admin/pages/about-us/multi?lang=en`

## Optional: Alternative migration via pg_dump/psql
If outbound connections are blocked or IPv6 is required:
```powershell
# Export local
& "C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe" -h localhost -U skills_user -d skillsupslovakia -F c -f dump_local.backup

# Restore into Supabase
& "C:\\Program Files\\PostgreSQL\\18\\bin\\pg_restore.exe" -h db.YOURPROJECT.supabase.co -U postgres -d postgres -c dump_local.backup
```
Note: You may need to create tables beforehand or adjust roles/privileges. For simple schemas, the included migration script is easier.

## Security
- Keep your Supabase password secret. Avoid committing `.env`.
- If using Windows, you can use `%APPDATA%\\postgresql\\pgpass.conf` to avoid interactive password prompts for psql.
