/**
 * SeevoraVoice - Database Migration Script
 * Migrates local dashboard/data/db.json into production Supabase PostgreSQL.
 *
 * Usage: node scripts/migrate-to-supabase.js
 */
'use strict';

const path = require('path');
const core = require('../lib/core');
core.loadEnv();
const dbSupabase = require('../lib/db-supabase');

async function main() {
  console.log('====================================================');
  console.log('SeevoraVoice: Migrating db.json to Supabase PostgreSQL');
  console.log('====================================================');

  if (!dbSupabase.isConfigured()) {
    console.error('Error: Supabase is not configured in .env (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing).');
    process.exit(1);
  }

  const localDb = core.db();
  console.log(`Found ${localDb.tenants.length} tenants, ${localDb.users.length} users, ${localDb.agents.length} agents, ${localDb.wallets.length} wallets, ${(localDb.callRecordings || []).length} recordings.`);

  const result = await dbSupabase.migrateAllFromLocalDb(localDb);
  if (result.success) {
    console.log('\nMigration complete! PostgreSQL database is now populated.');
    console.log('Stats:', result.stats);
  } else {
    console.error('Migration failed:', result.reason);
  }
}

main().catch((err) => {
  console.error('Unhandled migration error:', err);
  process.exit(1);
});
