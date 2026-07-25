import FleetFlags from './flags';
import { FleetCommand } from '../fleet-command';

describe('oclif Command: fleet flags (Smoke Tests)', () => {
  it('should extend FleetCommand', () => {
    expect(FleetFlags.prototype).toBeInstanceOf(FleetCommand);
  });
  
  it('should have key and value flags', () => {
    expect(FleetFlags.flags.key).toBeDefined();
    expect(FleetFlags.flags.value).toBeDefined();
  });
});
