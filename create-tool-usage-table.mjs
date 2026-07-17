/**
 * Quick script to create tool_usage table in PostgreSQL
 */
import { PostgresDocumentStore } from './dist/src/common/persistence/postgres-store.js';

async function createToolUsageTable() {
  const connectionString = process.env.DATABASE_URL || 'postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat';

  const store = new PostgresDocumentStore({
    connectionString,
    poolSize: 5,
  });

  try {
    const client = await store.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS tool_usage (
          id VARCHAR(255) PRIMARY KEY,
          data JSONB NOT NULL,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_tool_usage_ts ON tool_usage((data->>'ts'));
        CREATE INDEX IF NOT EXISTS idx_tool_usage_tool ON tool_usage((data->>'tool'));
        CREATE INDEX IF NOT EXISTS idx_tool_usage_server ON tool_usage((data->>'server'));
        CREATE INDEX IF NOT EXISTS idx_tool_usage_status ON tool_usage((data->>'status'));
        CREATE INDEX IF NOT EXISTS idx_tool_usage_correlation_id ON tool_usage((data->>'correlationId'));
      `);

      console.log('✓ tool_usage table created successfully');
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

createToolUsageTable();
