import { Logger, redactSecrets } from './logging';

describe('redactSecrets', () => {
  it('redacts values for sensitive keys', () => {
    const input = {
      OPENAI_API_KEY: 'sk-abc1234567890xyz1234',
      twitchClientSecret: 'supersecretvalue123456',
      normal: 'hello',
    } as any;
    const out = redactSecrets(input) as any;
    expect(out.OPENAI_API_KEY).not.toBe(input.OPENAI_API_KEY);
    expect(out.OPENAI_API_KEY.startsWith('sk-')).toBe(true);
    expect(out.OPENAI_API_KEY.endsWith('1234')).toBe(true);
    expect(out.twitchClientSecret).not.toBe(input.twitchClientSecret);
    expect(out.normal).toBe('hello');
  });

  it('redacts nested objects and arrays', () => {
    const input = {
      auth: {
        token: 'abcdEFGHijklMNOP12345678',
      },
      list: [ { password: 'fooBarBaz123456' }, 'ok' ],
    };
    const out = redactSecrets(input) as any;
    expect(out.auth.token).not.toBe('abcdEFGHijklMNOP12345678');
    expect(out.list[0].password).not.toBe('fooBarBaz123456');
    expect(out.list[1]).toBe('ok');
  });

  it('redacts values that look like secrets even if key is not sensitive', () => {
    const input = { something: 'sk-1234567890abcdef123456' };
    const out = redactSecrets(input) as any;
    expect(out.something).not.toBe(input.something);
  });
});

describe('Logger redaction integration', () => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const originalDebug = console.debug;

  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    console.debug = originalDebug;
  });

  it('masks sensitive context fields in output', () => {
    Logger.setServiceName('test');
    const logger = new Logger('info');
    let line = '';
    console.log = (s: any) => { line = String(s); };

    logger.info('test_message', { password: 'supersecret', note: 'keep' });
    expect(line).toBeTruthy();
    const obj = JSON.parse(line);
    expect(obj.msg).toBe('test_message');
    expect(obj.password).not.toBe('supersecret');
    expect(obj.note).toBe('keep');
  });
});


describe('Logger severity mapping for Cloud Logging', () => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const originalDebug = console.debug;

  beforeEach(() => {
    // no-op
  });
  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    console.debug = originalDebug;
  });

  it('emits severity field with correct mapping', () => {
    Logger.setServiceName('test');
    const logger = new Logger('debug');
    let got: any[] = [];
    console.error = (s: any) => { got.push(JSON.parse(String(s))); };
    console.warn = (s: any) => { got.push(JSON.parse(String(s))); };
    console.log = (s: any) => { got.push(JSON.parse(String(s))); };
    console.debug = (s: any) => { got.push(JSON.parse(String(s))); };

    logger.error('e1');
    logger.warn('w1');
    logger.info('i1');
    logger.debug('d1');

    const sev = got.map(o => o.severity);
    expect(sev).toEqual(['ERROR','WARNING','INFO','DEBUG']);
  });
});
