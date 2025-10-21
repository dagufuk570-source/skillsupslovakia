#!/usr/bin/env node
import 'dotenv/config';
import { Client } from 'pg';

const url = process.env.DATABASE_URL;
if(!url){
  console.log('wait-for-db: no DATABASE_URL set, skipping');
  process.exit(0);
}

const timeoutMs = parseInt(process.env.WAIT_FOR_DB_TIMEOUT_MS || '30000', 10);
const intervalMs = 1000;
const start = Date.now();

function makeClient(){
  const cfg = { connectionString: url };
  try{
    const host = new URL(url).hostname || '';
    const hasSslParam = /[?&](sslmode|ssl)=/i.test(url);
    if(host.includes('supabase.co') && !hasSslParam){
      cfg.ssl = { rejectUnauthorized: false };
    }
  }catch{}
  if(process.env.DATABASE_SSL === '1' && !cfg.ssl){
    cfg.ssl = { rejectUnauthorized: false };
  }
  return new Client(cfg);
}

async function tryConnect(){
  const client = makeClient();
  // Prevent unhandled 'error' events from crashing the process if the DB drops connection
  try {
    client.on('error', (e) => {
      try { console.error('wait-for-db client error:', e?.message || e); } catch {}
    });
  } catch {}
  try {
    await client.connect();
    await client.query('SELECT 1');
    await client.end();
    return true;
  } catch (e){
    console.error('wait-for-db error:', e.message);
    try { await client.end(); } catch {}
    return false;
  }
}

(async () => {
  while(Date.now() - start < timeoutMs){
    const ok = await tryConnect();
    if(ok){
      console.log('wait-for-db: ready');
      process.exit(0);
    }
    console.log('wait-for-db: waiting...');
    await new Promise(r=>setTimeout(r, intervalMs));
  }
  console.error('wait-for-db: timeout after '+timeoutMs+'ms');
  process.exit(1);
})();
