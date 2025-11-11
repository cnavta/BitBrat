export class BratError extends Error {
  category: string;
  constructor(message: string, category = 'Unknown') {
    super(message);
    this.name = this.constructor.name;
    this.category = category;
  }
}

export class ConfigurationError extends BratError {
  constructor(message: string) {
    super(message, 'Configuration');
  }
}

export class DependencyError extends BratError {
  constructor(message: string) {
    super(message, 'Dependency');
  }
}

export class PermissionError extends BratError {
  constructor(message: string) {
    super(message, 'Permission');
  }
}

export class ResourceStateError extends BratError {
  constructor(message: string) {
    super(message, 'ResourceState');
  }
}

export function exitCodeForError(err: unknown): number {
  if (err instanceof ConfigurationError) return 2;
  if (err instanceof DependencyError) return 3;
  if (err instanceof PermissionError) return 4;
  if (err instanceof ResourceStateError) return 5;
  return 1;
}
