import { Client } from 'pg';

async function testConnection() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat'
  });

  try {
    console.log('Connecting to PostgreSQL...');
    await client.connect();
    console.log('✓ Connected successfully');

    const res = await client.query('SELECT NOW()');
    console.log('✓ Query executed:', res.rows[0]);

    await client.end();
    console.log('✓ Connection closed');
  } catch (error) {
    console.error('✗ Error:', error);
    process.exit(1);
  }
}

testConnection();
