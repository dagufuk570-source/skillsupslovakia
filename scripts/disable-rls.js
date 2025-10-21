/**
 * Disable Row Level Security (RLS) on all tables
 * Run this script to fix "RLS has not been enabled" errors
 */

import pkg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Client } = pkg;

const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;

if (!connectionString) {
  console.error('❌ DATABASE_URL not found in environment');
  process.exit(1);
}

console.log('🔧 Disabling Row Level Security on all tables...\n');

const tables = [
  'events',
  'news',
  'themes',
  'team_members',
  'documents',
  'pages',
  'settings',
  'focus_areas',
  'contact_messages'
];

async function disableRLS() {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    for (const table of tables) {
      try {
        // Disable RLS
        await client.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
        console.log(`✅ Disabled RLS on: ${table}`);
      } catch (err) {
        if (err.message.includes('does not exist')) {
          console.log(`⚠️  Table does not exist: ${table} (skipping)`);
        } else if (err.message.includes('permission denied')) {
          console.error(`❌ Permission denied for: ${table}`);
          console.error('   → Try using the Supabase service_role key instead of regular database URL');
        } else {
          console.error(`❌ Failed on ${table}:`, err.message);
        }
      }
    }

    console.log('\n✅ RLS disable completed!');

  } catch (err) {
    console.error('❌ Connection failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

disableRLS();
