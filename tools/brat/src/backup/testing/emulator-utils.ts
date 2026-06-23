import http from 'http';

/**
 * Default emulator endpoint for tests. Honors FIRESTORE_EMULATOR_HOST when already set (e.g. by
 * validate_deliverable.sh / CI), otherwise falls back to the local default port used by the
 * platform's docker stack (8080) — overridable via BRAT_TEST_EMULATOR_HOST.
 */
export const TEST_EMULATOR_HOST =
  process.env.BRAT_TEST_EMULATOR_HOST ||
  process.env.FIRESTORE_EMULATOR_HOST ||
  '127.0.0.1:8080';

/**
 * Reachability probe that confirms a *Firestore emulator* is actually listening — not merely that
 * something holds the TCP port. A bare TCP connect is unsafe here: an unrelated process (e.g. an
 * nginx reverse proxy on :8080) would accept the connection, the probe would report "reachable",
 * and the emulator-dependent tests would then issue real Firestore operations that hang against a
 * non-Firestore endpoint until the Jest timeout fires.
 *
 * The Firestore emulator answers `GET /` on its HTTP port with `200 OK` (body "Ok"). We require a
 * 2xx response here; anything else (connection refused, timeout, 5xx from a foreign server such as
 * nginx's 502) is treated as "not reachable" so the tests skip cleanly instead of timing out.
 */
export function isEmulatorReachable(hostPort = TEST_EMULATOR_HOST, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const [host, portStr] = hostPort.split(':');
    const port = Number(portStr || 8080);
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const req = http.request(
      { host: host || '127.0.0.1', port, path: '/', method: 'GET', timeout: timeoutMs },
      (res) => {
        const ok = !!res.statusCode && res.statusCode >= 200 && res.statusCode < 300;
        // Drain so the socket can close promptly.
        res.resume();
        res.once('end', () => done(ok));
        res.once('error', () => done(false));
      },
    );
    req.once('timeout', () => {
      req.destroy();
      done(false);
    });
    req.once('error', () => done(false));
    req.end();
  });
}
