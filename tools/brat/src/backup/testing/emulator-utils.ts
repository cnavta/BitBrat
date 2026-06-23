import net from 'net';

/**
 * Default emulator endpoint for tests. Honors FIRESTORE_EMULATOR_HOST when already set (e.g. by
 * validate_deliverable.sh / CI), otherwise falls back to the local default port used by the
 * platform's docker stack (8080) — overridable via BRAT_TEST_EMULATOR_HOST.
 */
export const TEST_EMULATOR_HOST =
  process.env.BRAT_TEST_EMULATOR_HOST ||
  process.env.FIRESTORE_EMULATOR_HOST ||
  '127.0.0.1:8080';

/** Quick TCP reachability probe so emulator-dependent tests can gracefully skip when no runtime. */
export function isEmulatorReachable(hostPort = TEST_EMULATOR_HOST, timeoutMs = 750): Promise<boolean> {
  return new Promise((resolve) => {
    const [host, portStr] = hostPort.split(':');
    const port = Number(portStr || 8080);
    const socket = new net.Socket();
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host || '127.0.0.1');
  });
}
