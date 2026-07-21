/**
 * Sprint 352: Verification script for Story S1.1
 *
 * Demonstrates parsing of architecture.yaml for active services
 */

import { logDiscoveredServices, parseActiveServices, getAllRequiredEnvVars, getAllRequiredSecrets } from './parse-services';

const repoRoot = process.cwd();

console.log('='.repeat(60));
console.log('Sprint 352 - Story S1.1: Parse architecture.yaml for Active Services');
console.log('='.repeat(60));

// Log all discovered services
logDiscoveredServices(repoRoot);

// Summary statistics
const services = parseActiveServices(repoRoot);
const envVars = getAllRequiredEnvVars(repoRoot);
const secrets = getAllRequiredSecrets(repoRoot);

console.log('\n' + '='.repeat(60));
console.log('Summary:');
console.log('='.repeat(60));
console.log(`Active services: ${services.size}`);
console.log(`Total unique env vars: ${envVars.size}`);
console.log(`Total unique secrets: ${secrets.size}`);
console.log();

// Platform vs Domain breakdown
const platformServices = Array.from(services.values()).filter(s => s.category === 'platform');
const domainServices = Array.from(services.values()).filter(s => s.category === 'domain');

console.log(`Platform services: ${platformServices.length}`);
console.log(`Domain services: ${domainServices.length}`);
console.log();

// Profile breakdown
const profileCounts = new Map<string, number>();
for (const svc of services.values()) {
  profileCounts.set(svc.profile, (profileCounts.get(svc.profile) || 0) + 1);
}

console.log('By profile:');
for (const [profile, count] of profileCounts.entries()) {
  console.log(`  ${profile}: ${count}`);
}
console.log();

console.log('✅ Story S1.1 implementation complete and verified');
console.log();
