import FleetLog from './log';
import { FleetCommand } from '../fleet-command';

describe('oclif Command: fleet log (Smoke Tests)', () => {
  it('should extend FleetCommand', () => {
    expect(FleetLog.prototype).toBeInstanceOf(FleetCommand);
  });
  
  it('should have level flag with options', () => {
    expect(FleetLog.flags.level).toBeDefined();
    expect((FleetLog.flags.level as any).options).toContain('debug');
  });
});
