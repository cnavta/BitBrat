import FleetConfig from './config';
import { FleetCommand } from '../fleet-command';

describe('oclif Command: fleet config (Smoke Tests)', () => {
  it('should extend FleetCommand', () => {
    expect(FleetConfig.prototype).toBeInstanceOf(FleetCommand);
  });
  
  it('should have describe flag', () => {
    expect(FleetConfig.flags.describe).toBeDefined();
  });
});
