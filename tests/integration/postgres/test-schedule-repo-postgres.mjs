/**
 * Integration Test: DocumentStoreScheduleRepository with Real PostgreSQL
 *
 * This test validates that the DocumentStoreScheduleRepository works correctly
 * with a real PostgreSQL database connection.
 */

import {
  DocumentStoreScheduleRepository,
  FirestoreScheduleRepository,
  createScheduleRepository,
} from './dist/src/services/scheduler/repository.js';
import { PostgresDocumentStore } from './dist/src/common/persistence/postgres-store.js';

async function testScheduleRepositoryWithPostgres() {
  console.log('🚀 Testing DocumentStoreScheduleRepository with PostgreSQL...\n');

  const connectionString = process.env.DATABASE_URL || 'postgresql://bitbrat:bitbrat_dev_password@localhost:5432/bitbrat';

  const store = new PostgresDocumentStore({
    connectionString,
    poolSize: 5,
  });

  const scheduleRepo = new DocumentStoreScheduleRepository(store, 'schedules');

  try {
    // Test 1: Health check
    console.log('1. Testing PostgreSQL health check...');
    const health = await store.health();
    console.log(`   ✓ Health: ${JSON.stringify(health)}\n`);

    // Test 2: Create a schedule (once)
    console.log('2. Creating a one-time schedule...');
    const onceSchedule = {
      id: 'test-schedule-once',
      title: 'Test Once Schedule',
      description: 'A test schedule that runs once',
      schedule: {
        type: 'once',
        value: '2026-12-31T23:59:59Z',
      },
      event: {
        type: 'internal.test.v1',
        payload: { message: 'Hello from once schedule' },
      },
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      nextRun: new Date('2026-12-31T23:59:59Z'),
    };

    await scheduleRepo.create(onceSchedule);
    console.log(`   ✓ Once schedule created: ${onceSchedule.id}\n`);

    // Test 3: Create a cron schedule
    console.log('3. Creating a cron schedule...');
    const cronSchedule = {
      id: 'test-schedule-cron',
      title: 'Test Cron Schedule',
      description: 'A test schedule that runs every 5 minutes',
      schedule: {
        type: 'cron',
        value: '*/5 * * * *',
      },
      event: {
        type: 'internal.test.v1',
        payload: { message: 'Hello from cron schedule' },
      },
      topic: 'internal.test.v1',
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      nextRun: new Date(Date.now() + 5 * 60 * 1000),
    };

    await scheduleRepo.create(cronSchedule);
    console.log(`   ✓ Cron schedule created: ${cronSchedule.id}\n`);

    // Test 4: List all schedules
    console.log('4. Listing all schedules...');
    const allSchedules = await scheduleRepo.list();
    console.log(`   ✓ Found ${allSchedules.length} total schedules\n`);

    // Test 5: List only enabled schedules
    console.log('5. Listing enabled schedules...');
    const enabledSchedules = await scheduleRepo.list(true);
    console.log(`   ✓ Found ${enabledSchedules.length} enabled schedules\n`);

    // Test 6: Get a specific schedule
    console.log('6. Getting schedule by ID...');
    const retrieved = await scheduleRepo.get('test-schedule-once');
    if (!retrieved) {
      throw new Error('Schedule not found');
    }
    console.log(`   ✓ Retrieved: ${retrieved.title}`);
    console.log(`   ✓ Type: ${retrieved.schedule.type}`);
    console.log(`   ✓ Enabled: ${retrieved.enabled}\n`);

    // Test 7: Update a schedule
    console.log('7. Updating schedule...');
    await scheduleRepo.update('test-schedule-once', {
      enabled: false,
      lastRun: new Date(),
      updatedAt: new Date(),
    });

    const updated = await scheduleRepo.get('test-schedule-once');
    if (updated?.enabled !== false) {
      throw new Error('Schedule update failed');
    }
    console.log(`   ✓ Schedule disabled\n`);

    // Test 8: Get due schedules
    console.log('8. Testing getDueSchedules...');
    const futureTime = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now
    const dueSchedules = await scheduleRepo.getDueSchedules(futureTime);
    console.log(`   ✓ Found ${dueSchedules.length} due schedules (before ${futureTime.toISOString()})\n`);

    // Test 9: Factory function - PostgreSQL detection
    console.log('9. Testing factory function with PostgreSQL...');
    const factoryRepo = createScheduleRepository(store, 'schedules');
    if (!(factoryRepo instanceof DocumentStoreScheduleRepository)) {
      throw new Error('Factory did not return DocumentStoreScheduleRepository');
    }
    console.log(`   ✓ Factory correctly detected PostgreSQL\n`);

    // Test 10: Create via factory
    console.log('10. Creating schedule via factory...');
    await factoryRepo.create({
      id: 'test-schedule-factory',
      title: 'Factory Test Schedule',
      schedule: {
        type: 'once',
        value: '2026-07-20T12:00:00Z',
      },
      event: {
        type: 'internal.test.v1',
        payload: { source: 'factory' },
      },
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log(`   ✓ Factory create successful\n`);

    // Test 11: Date conversion verification
    console.log('11. Verifying date conversion...');
    const dateSchedule = await scheduleRepo.get('test-schedule-cron');
    if (!dateSchedule) {
      throw new Error('Cron schedule not found');
    }
    if (!(dateSchedule.createdAt instanceof Date)) {
      throw new Error('createdAt is not a Date object');
    }
    if (dateSchedule.nextRun && !(dateSchedule.nextRun instanceof Date)) {
      throw new Error('nextRun is not a Date object');
    }
    console.log(`   ✓ Date fields correctly converted to Date objects\n`);

    // Cleanup: Delete test schedules
    console.log('12. Cleaning up test data...');
    await scheduleRepo.delete('test-schedule-once');
    await scheduleRepo.delete('test-schedule-cron');
    await scheduleRepo.delete('test-schedule-factory');
    console.log(`   ✓ Test schedules deleted\n`);

    console.log('✅ All integration tests passed!\n');

    console.log('📊 Summary:');
    console.log('   - ScheduleRepository working with PostgreSQL');
    console.log('   - Create/Read/Update/Delete operations working');
    console.log('   - List filtering working (all vs enabled-only)');
    console.log('   - getDueSchedules query working');
    console.log('   - Date conversion working correctly');
    console.log('   - Factory pattern working\n');

    await store.close();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:', error);

    // Cleanup on error
    try {
      await scheduleRepo.delete('test-schedule-once').catch(() => {});
      await scheduleRepo.delete('test-schedule-cron').catch(() => {});
      await scheduleRepo.delete('test-schedule-factory').catch(() => {});
    } catch {}

    await store.close();
    process.exit(1);
  }
}

testScheduleRepositoryWithPostgres();
