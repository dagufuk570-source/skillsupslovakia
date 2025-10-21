import pkg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pkg;

const ADMIN_DATABASE_URL = process.env.ADMIN_DATABASE_URL || process.env.POSTGRES_ADMIN_URL || '';
const DB_NAME = process.env.DB_NAME || 'skillsupslovakia';
const APP_USER = process.env.DB_USER || 'skills_user';
const APP_PASS = process.env.DB_PASS || 'changeme';

if(!ADMIN_DATABASE_URL){
  console.error('Missing ADMIN_DATABASE_URL (e.g., postgresql://postgres:<password>@127.0.0.1:5432/postgres)');
  process.exit(1);
}

async function ensureDatabase(adminPool, name){
  const r = await adminPool.query('SELECT 1 FROM pg_database WHERE datname=$1', [name]);
  if(r.rowCount === 0){
    console.log(`Creating database ${name}...`);
    const dbIdent = '"' + name.replace(/"/g, '""') + '"';
    await adminPool.query(`CREATE DATABASE ${dbIdent}`);
  } else {
    console.log(`Database ${name} exists.`);
  }
}

async function ensureRole(adminPool, user, pass){
  const r = await adminPool.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [user]);
  if(r.rowCount === 0){
    console.log(`Creating role ${user}...`);
    const userIdent = '"' + user.replace(/"/g, '""') + '"';
    const passLit = '\'' + String(pass).replace(/'/g, "''") + '\'';
    await adminPool.query(`CREATE USER ${userIdent} WITH PASSWORD ${passLit}`);
  } else {
    console.log(`Role ${user} exists. Updating password...`);
    const userIdent = '"' + user.replace(/"/g, '""') + '"';
    const passLit = '\'' + String(pass).replace(/'/g, "''") + '\'';
    await adminPool.query(`ALTER USER ${userIdent} WITH PASSWORD ${passLit}`);
  }
}

async function grantDbAndSchema(adminDbPool){
  console.log('Granting privileges on database and schema public...');
  const dbIdent = '"' + DB_NAME.replace(/"/g, '""') + '"';
  const userIdent = '"' + APP_USER.replace(/"/g, '""') + '"';
  await adminDbPool.query(`GRANT CONNECT, TEMP ON DATABASE ${dbIdent} TO ${userIdent}`);
  await adminDbPool.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${userIdent}`);
  await adminDbPool.query(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${userIdent}`);
  await adminDbPool.query(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${userIdent}`);
  await adminDbPool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${userIdent}`);
  await adminDbPool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${userIdent}`);
}

async function ensurePagesTable(adminDbPool){
  console.log('Ensuring pages table...');
  await adminDbPool.query(`
    CREATE TABLE IF NOT EXISTS pages (
      id SERIAL PRIMARY KEY,
      lang TEXT NOT NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      content JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now(),
      UNIQUE(lang, slug)
    )`);
}

async function main(){
  // Connect to admin db (usually postgres database)
  const adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
  try{
    await adminPool.query('SELECT 1');
  }catch(err){
    console.error('Failed to connect with ADMIN_DATABASE_URL:', err.message);
    process.exit(1);
  }

  await ensureDatabase(adminPool, DB_NAME);
  await ensureRole(adminPool, APP_USER, APP_PASS);

  // Now connect to target DB as admin
    let adminDbUrl;
    try{
      const u = new URL(ADMIN_DATABASE_URL);
      u.pathname = '/' + DB_NAME;
      adminDbUrl = u.toString();
    }catch(err){
      console.error('Invalid ADMIN_DATABASE_URL:', err.message);
      process.exit(1);
    }
  const adminDbPool = new Pool({ connectionString: adminDbUrl });
  try{
    await adminDbPool.query('SELECT 1');
  }catch(err){
    console.error('Failed to connect to target DB:', err.message);
    process.exit(1);
  }

  await grantDbAndSchema(adminDbPool);
  await ensurePagesTable(adminDbPool);

  await adminDbPool.end();
  await adminPool.end();
  console.log('DB setup complete.');
}

main().catch(err=>{ console.error(err); process.exit(1); });
