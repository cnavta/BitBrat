/**
 * Quick script to create api_tokens table in PostgreSQL
 */
import { PostgresDocumentStore } from './dist/src/common/persistence/postgres-store.js';

async function createApiTokensTable() {
  const connectionString = process.env.DATABASE_URL || 'postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat';

  const store = new PostgresDocumentStore({
    connectionString,
    poolSize: 5,
  });

  try {
    const client = await store.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS api_tokens (
          id VARCHAR(255) PRIMARY KEY,
          data JSONB NOT NULL,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_api_tokens_uid ON api_tokens((data->>'uid'));
        CREATE INDEX IF NOT EXISTS idx_api_tokens_expires_at ON api_tokens((data->>'expires_at'));
        CREATE INDEX IF NOT EXISTS idx_api_tokens_last_used_at ON api_tokens((data->>'last_used_at'));
      `);

      console.log('✓ api_tokens table created successfully');
    } finally {
      client.release();
    }

    await store.close();
    process.exit(0);
  } catch (error) {
    console.error('Failed to create table:', error);
    await store.close();
    process.exit(1);
  }
}

createApiTokensTable();
