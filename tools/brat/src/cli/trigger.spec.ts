import { cmdTrigger } from './index';

jest.mock('../providers/gcp/cloudbuild-triggers', () => ({
  createTrigger: jest.fn(async (_projectId: string, _spec: any, _dry: boolean) => ({ action: 'created' })),
  updateTrigger: jest.fn(async (_projectId: string, _spec: any, _dry: boolean) => ({ action: 'updated' })),
  deleteTrigger: jest.fn(async (_projectId: string, _name: string, _dry: boolean) => ({ action: 'deleted' })),
}));

describe('CLI trigger commands', () => {
  const flags = { projectId: 'p', env: 'prod', dryRun: true } as any;

  let logSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit ${code}`); }) as any);
  });
  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('creates trigger with required flags', async () => {
    await cmdTrigger('create', flags, ['--name=foo', '--repo=o/r', '--branch=main', '--config=cloudbuild.yaml']);
    const { createTrigger } = require('../providers/gcp/cloudbuild-triggers');
    expect(createTrigger).toHaveBeenCalled();
  });

  it('updates trigger', async () => {
    await cmdTrigger('update', flags, ['--name=foo', '--repo=o/r', '--branch=main', '--config=cloudbuild.yaml']);
    const { updateTrigger } = require('../providers/gcp/cloudbuild-triggers');
    expect(updateTrigger).toHaveBeenCalled();
  });

  it('deletes trigger', async () => {
    await cmdTrigger('delete', flags, ['--name=foo']);
    const { deleteTrigger } = require('../providers/gcp/cloudbuild-triggers');
    expect(deleteTrigger).toHaveBeenCalled();
  });

  it('errors when name missing', async () => {
    await expect(cmdTrigger('delete', flags, [])).rejects.toThrow(/exit 2/);
  });
});
