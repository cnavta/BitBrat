#!/usr/bin/env node

const LOKI_URL = 'http://bitbrat.lan:3100';

async function main() {
  console.log('Checking Loki labels...\n');

  // 1. Check if Loki is ready
  try {
    const ready = await fetch(`${LOKI_URL}/ready`);
    console.log(`✓ Loki ready: ${ready.status}`);
  } catch (e) {
    console.error(`✗ Loki not ready: ${e.message}`);
  }

  // 2. List all labels
  try {
    const response = await fetch(`${LOKI_URL}/loki/api/v1/labels`);
    const data = await response.json();
    console.log('\n=== Available Labels ===');
    console.log(data.data);

    // 3. Get values for each label
    for (const label of data.data) {
      const valuesResp = await fetch(`${LOKI_URL}/loki/api/v1/label/${label}/values`);
      const valuesData = await valuesResp.json();
      console.log(`\n${label}:`, valuesData.data.slice(0, 10));
    }
  } catch (e) {
    console.error(`✗ Failed to get labels: ${e.message}`);
  }

  // 4. Try a simple query
  console.log('\n=== Testing Simple Query ===');
  const params = new URLSearchParams({
    query: '{}',
    start: (Date.now() - 3600000) * 1000000,
    end: Date.now() * 1000000,
    limit: '5'
  });

  try {
    const response = await fetch(`${LOKI_URL}/loki/api/v1/query_range?${params}`);
    const data = await response.json();
    console.log(`Status: ${data.status}`);
    console.log(`Result count: ${data.data?.result?.length || 0}`);

    if (data.data?.result?.[0]) {
      console.log('\nFirst stream labels:', data.data.result[0].stream);
      if (data.data.result[0].values?.[0]) {
        console.log('First log line:', data.data.result[0].values[0][1].substring(0, 200));
      }
    }
  } catch (e) {
    console.error(`✗ Query failed: ${e.message}`);
  }
}

main();
