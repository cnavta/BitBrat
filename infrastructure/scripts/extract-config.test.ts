import { spawnSync } from 'child_process';

describe('extract-config CLI', () => {
  it('emits oauth-flow config merged from architecture.yaml', () => {
    const res = spawnSync('node', ['infrastructure/scripts/extract-config.js', '--service', 'oauth-flow'], {
      encoding: 'utf8',
    });
    if (res.error) {
      throw res.error;
    }
    expect(res.status).toBe(0);
    const json = JSON.parse(res.stdout.trim());
    expect(json.SERVICE_NAME).toBe('oauth-flow');
    expect(json.REGION).toBe('us-central1');
    expect(json.PORT).toBe(3000);
    expect(json.MIN_INSTANCES).toBe(0);
    expect(json.MAX_INSTANCES).toBe(1);
    expect(json.CPU).toBe('1');
    expect(json.MEMORY).toBe('512Mi');
    expect(json.ALLOW_UNAUTH).toBe(true);
    expect(json.ENV_KEYS).toEqual(['LOG_LEVEL','MESSAGE_BUS_DRIVER','NATS_URL','BUS_PREFIX','DISCORD_REDIRECT_URI','DISCORD_OAUTH_SCOPES']);
    expect(json.SECRETS).toEqual(['TWITCH_CLIENT_ID','TWITCH_CLIENT_SECRET','OAUTH_STATE_SECRET','DISCORD_CLIENT_ID','DISCORD_CLIENT_SECRET']);
    expect(json.SECRET_SET_ARG).toBe('TWITCH_CLIENT_ID=TWITCH_CLIENT_ID:latest;TWITCH_CLIENT_SECRET=TWITCH_CLIENT_SECRET:latest;OAUTH_STATE_SECRET=OAUTH_STATE_SECRET:latest;DISCORD_CLIENT_ID=DISCORD_CLIENT_ID:latest;DISCORD_CLIENT_SECRET=DISCORD_CLIENT_SECRET:latest');
  });
});
