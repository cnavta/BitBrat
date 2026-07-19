/**
 * Quick script to create reflexes table
 */
import { PostgresDocumentStore } from './src/common/persistence/postgres-store';

async function createReflexesTable() {
  const connectionString = process.env.DATABASE_URL || 'postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat';

  const store = new PostgresDocumentStore({
    connectionString,
    poolSize: 5,
  });

  try {
    // Execute SQL to create the table
    const client = await (store as any).pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS reflexes (
          id VARCHAR(255) PRIMARY KEY,
          data JSONB NOT NULL,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_reflexes_active ON reflexes((data->>'active'));
        CREATE INDEX IF NOT EXISTS idx_reflexes_priority ON reflexes(((data->>'priority')::INT));
      `);

      console.log('✓ reflexes table created successfully');
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

createReflexesTable();
