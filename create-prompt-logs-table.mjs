/**
 * Quick script to create prompt_logs table in PostgreSQL
 */
import { PostgresDocumentStore } from './dist/src/common/persistence/postgres-store.js';

async function createPromptLogsTable() {
  const connectionString = process.env.DATABASE_URL || 'postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat';

  const store = new PostgresDocumentStore({
    connectionString,
    poolSize: 5,
  });

  try {
    const client = await store.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS prompt_logs (
          id VARCHAR(255) PRIMARY KEY,
          data JSONB NOT NULL,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_prompt_logs_platform ON prompt_logs((data->>'platform'));
        CREATE INDEX IF NOT EXISTS idx_prompt_logs_model ON prompt_logs((data->>'model'));
        CREATE INDEX IF NOT EXISTS idx_prompt_logs_correlation_id ON prompt_logs((data->>'correlationId'));
        CREATE INDEX IF NOT EXISTS idx_prompt_logs_created_at ON prompt_logs((data->>'createdAt'));
      `);

      console.log('✓ prompt_logs table created successfully');
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

createPromptLogsTable();
