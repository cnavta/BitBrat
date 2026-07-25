import FleetDrain from './drain';
import { FleetCommand } from '../fleet-command';

describe('oclif Command: fleet drain (Smoke Tests)', () => {
  it('should extend FleetCommand', () => {
    expect(FleetDrain.prototype).toBeInstanceOf(FleetCommand);
  });
  
  it('should define drain subcommand', () => {
    const command = new FleetDrain([], {} as any);
    expect(command['subcommand']).toBe('drain');
  });
});
