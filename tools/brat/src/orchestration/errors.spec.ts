import { ConfigurationError, DependencyError, PermissionError, ResourceStateError, exitCodeForError } from './errors';

describe('exitCodeForError', () => {
  it('maps ConfigurationError to 2', () => {
    expect(exitCodeForError(new ConfigurationError('x'))).toBe(2);
  });
  it('maps DependencyError to 3', () => {
    expect(exitCodeForError(new DependencyError('x'))).toBe(3);
  });
  it('maps PermissionError to 4', () => {
    expect(exitCodeForError(new PermissionError('x'))).toBe(4);
  });
  it('maps ResourceStateError to 5', () => {
    expect(exitCodeForError(new ResourceStateError('x'))).toBe(5);
  });
  it('defaults others to 1', () => {
    expect(exitCodeForError(new Error('x'))).toBe(1);
  });
});
