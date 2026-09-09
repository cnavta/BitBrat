#!/usr/bin/env node

/**
 * Test script to diagnose Loki query issues
 *
 * This script will:
 * 1. Check Loki connectivity
 * 2. List all available labels
 * 3. Test various LogQL queries to find what labels exist
 * 4. Query for the specific error we know exists
 */

const LOKI_URL = 'http://bitbrat.lan:3100';

async function testLokiConnectivity() {
  console.log('\n=== Testing Loki Connectivity ===');
  try {
    const response = await fetch(`${LOKI_URL}/ready`);
    console.log(`✓ Loki is ready: ${response.ok}`);
    return response.ok;
  } catch (error) {
    console.error(`✗ Loki connection failed: ${error.message}`);
    return false;
  }
}

async function listLabelNames() {
  console.log('\n=== Listing Label Names ===');
  try {
    const response = await fetch(`${LOKI_URL}/loki/api/v1/labels`);
    const data = await response.json();
    console.log('Available labels:', data.data);
    return data.data;
  } catch (error) {
    console.error(`✗ Failed to list labels: ${error.message}`);
    return [];
  }
}

async function listLabelValues(labelName) {
  console.log(`\n=== Listing Values for Label: ${labelName} ===`);
  try {
    const response = await fetch(`${LOKI_URL}/loki/api/v1/label/${labelName}/values`);
    const data = await response.json();
    console.log(`Values for ${labelName}:`, data.data);
    return data.data;
  } catch (error) {
    console.error(`✗ Failed to list label values: ${error.message}`);
    return [];
  }
}

async function queryLoki(query, description) {
  console.log(`\n=== Testing Query: ${description} ===`);
  console.log(`Query: ${query}`);

  const params = new URLSearchParams({
    query: query,
    start: (Date.now() - 3600000) * 1000000, // 1 hour ago in nanoseconds
    end: Date.now() * 1000000, // now in nanoseconds
    limit: '10',
    direction: 'backward'
  });

  try {
    const url = `${LOKI_URL}/loki/api/v1/query_range?${params.toString()}`;
    console.log(`URL: ${url}`);

    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'success') {
      console.error(`✗ Query failed: ${data.status}`);
      console.error('Error:', JSON.stringify(data, null, 2));
      return null;
    }

    const resultCount = data.data.result.length;
    const entryCount = data.data.result.reduce((sum, stream) => sum + stream.values.length, 0);

    console.log(`✓ Query succeeded: ${resultCount} streams, ${entryCount} entries`);

    // Show first few entries
    if (entryCount > 0) {
      console.log('\nSample entries:');
      for (let i = 0; i < Math.min(3, data.data.result.length); i++) {
        const stream = data.data.result[i];
        console.log(`\nStream ${i + 1} labels:`, stream.stream);
        if (stream.values.length > 0) {
          const [timestamp, logLine] = stream.values[0];
          console.log(`  First entry: ${logLine.substring(0, 200)}...`);
        }
      }
    }

    return data;
  } catch (error) {
    console.error(`✗ Query failed: ${error.message}`);
    return null;
  }
}

async function main() {
  console.log('Loki Diagnostic Tool');
  console.log(`Target: ${LOKI_URL}`);

  // 1. Test connectivity
  const isReady = await testLokiConnectivity();
  if (!isReady) {
    console.error('\n✗ Cannot proceed - Loki is not accessible');
    process.exit(1);
  }

  // 2. List all labels
  const labels = await listLabelNames();

  // 3. Get values for important labels
  if (labels.includes('service')) {
    await listLabelValues('service');
  }
  if (labels.includes('level')) {
    await listLabelValues('level');
  }
  if (labels.includes('correlationId')) {
    await listLabelValues('correlationId');
  }

  // 4. Test various queries

  // Query 1: All logs
  await queryLoki('{}', 'All logs (no filters)');

  // Query 2: By service (if it exists)
  if (labels.includes('service')) {
    await queryLoki('{service="tool-gateway"}', 'Logs for tool-gateway service');
  }

  // Query 3: By level (if it exists)
  if (labels.includes('level')) {
    await queryLoki('{level="error"}', 'Error level logs');
    await queryLoki('{level=~"error|warn"}', 'Error or warn level logs');
  }

  // Query 4: Combined filters
  if (labels.includes('service') && labels.includes('level')) {
    await queryLoki('{service="tool-gateway",level="error"}', 'tool-gateway errors');
  }

  // Query 5: Search for the specific error message
  await queryLoki('{} |= "tool_gateway.composition.execute.failed"', 'Search for composition error message');

  // Query 6: Search for correlationId from the example
  await queryLoki('{correlationId="5c86d19f-f25d-49b0-b8f9-b6fae1a34b52"}', 'Search by specific correlationId');

  console.log('\n=== Diagnostic Complete ===');
}

main().catch(console.error);
