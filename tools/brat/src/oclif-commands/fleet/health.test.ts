import FleetHealth from './health';
import { FleetCommand } from '../fleet-command';

describe('oclif Command: fleet health (Smoke Tests)', () => {
  it('should extend FleetCommand', () => {
    expect(FleetHealth.prototype).toBeInstanceOf(FleetCommand);
  });
  
  it('should define health subcommand', () => {
    const command = new FleetHealth([], {} as any);
    expect(command['subcommand']).toBe('health');
  });
});
