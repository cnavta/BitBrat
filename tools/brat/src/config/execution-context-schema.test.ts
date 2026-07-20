import {
  ExecutionContextSchema,
  ExecutionContextsSchema,
  DeploymentSchema,
  GatewayConfigSchema,
  PersistenceConfigSchema,
  EnvOverlayConfigSchema,
} from './execution-context-schema';

describe('ExecutionContextSchema - Sprint 349', () => {
  describe('DeploymentSchema', () => {
    it('accepts valid docker-compose deployment', () => {
      const deployment = {
        type: 'docker-compose',
        docker: {
          host: 'unix:///var/run/docker.sock',
        },
      };
      const result = DeploymentSchema.safeParse(deployment);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('docker-compose');
        expect(result.data.docker?.host).toBe('unix:///var/run/docker.sock');
      }
    });

    it('accepts docker-compose with SSH host and remote config', () => {
      const deployment = {
        type: 'docker-compose',
        docker: {
          host: 'ssh://root@bitbrat.lan',
          remoteDir: '/opt/BitBratPlatform',
          maxConcurrent: 3,
        },
      };
      const result = DeploymentSchema.safeParse(deployment);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.docker?.host).toBe('ssh://root@bitbrat.lan');
        expect(result.data.docker?.remoteDir).toBe('/opt/BitBratPlatform');
        expect(result.data.docker?.maxConcurrent).toBe(3);
      }
    });

    it('accepts valid cloud-run deployment', () => {
      const deployment = {
        type: 'cloud-run',
        gcp: {
          project: 'my-project',
          region: 'us-central1',
        },
      };
      const result = DeploymentSchema.safeParse(deployment);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('cloud-run');
        expect(result.data.gcp?.project).toBe('my-project');
        expect(result.data.gcp?.region).toBe('us-central1');
      }
    });

    it('accepts valid k8s deployment', () => {
      const deployment = {
        type: 'k8s',
        k8s: {
          cluster: 'my-cluster',
          namespace: 'bitbrat',
        },
      };
      const result = DeploymentSchema.safeParse(deployment);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('k8s');
        expect(result.data.k8s?.cluster).toBe('my-cluster');
        expect(result.data.k8s?.namespace).toBe('bitbrat');
      }
    });

    it('fails when docker-compose type has no docker config', () => {
      const deployment = {
        type: 'docker-compose',
      };
      const result = DeploymentSchema.safeParse(deployment);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map(i => i.message);
        expect(messages).toContain('Deployment configuration must include the appropriate sub-config for the specified type');
      }
    });

    it('fails when cloud-run type has no gcp config', () => {
      const deployment = {
        type: 'cloud-run',
      };
      const result = DeploymentSchema.safeParse(deployment);
      expect(result.success).toBe(false);
    });

    it('fails when k8s type has no k8s config', () => {
      const deployment = {
        type: 'k8s',
      };
      const result = DeploymentSchema.safeParse(deployment);
      expect(result.success).toBe(false);
    });
  });

  describe('GatewayConfigSchema', () => {
    it('accepts explicit URL', () => {
      const gateway = {
        url: 'http://bitbrat.lan:3002',
        authToken: '${MCP_AUTH_TOKEN}',
      };
      const result = GatewayConfigSchema.safeParse(gateway);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.url).toBe('http://bitbrat.lan:3002');
        expect(result.data.authToken).toBe('${MCP_AUTH_TOKEN}');
      }
    });

    it('accepts autoDiscover without URL', () => {
      const gateway = {
        autoDiscover: true,
        fallbackPort: 3004,
      };
      const result = GatewayConfigSchema.safeParse(gateway);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.autoDiscover).toBe(true);
        expect(result.data.fallbackPort).toBe(3004);
      }
    });

    it('accepts fallbackPort only', () => {
      const gateway = {
        fallbackPort: 3000,
      };
      const result = GatewayConfigSchema.safeParse(gateway);
      expect(result.success).toBe(true);
    });

    it('fails when no resolution method provided', () => {
      const gateway = {
        authToken: 'some-token',
      };
      const result = GatewayConfigSchema.safeParse(gateway);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map(i => i.message);
        expect(messages).toContain('Gateway config must provide at least one of: url, autoDiscover, or fallbackPort');
      }
    });

    it('accepts all fields together', () => {
      const gateway = {
        url: 'http://example.com',
        authToken: 'token',
        autoDiscover: true,
        fallbackPort: 3000,
      };
      const result = GatewayConfigSchema.safeParse(gateway);
      expect(result.success).toBe(true);
    });
  });

  describe('PersistenceConfigSchema', () => {
    it('accepts postgres with explicit connection', () => {
      const persistence = {
        driver: 'postgres',
        connection: {
          host: 'bitbrat.lan',
          port: 5432,
          database: 'bitbrat',
          username: 'bitbrat',
          password: 'secret',
        },
      };
      const result = PersistenceConfigSchema.safeParse(persistence);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.driver).toBe('postgres');
        expect(result.data.connection?.host).toBe('bitbrat.lan');
        expect(result.data.connection?.port).toBe(5432);
      }
    });

    it('accepts postgres with autoDiscover', () => {
      const persistence = {
        driver: 'postgres',
        autoDiscover: true,
      };
      const result = PersistenceConfigSchema.safeParse(persistence);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.driver).toBe('postgres');
        expect(result.data.autoDiscover).toBe(true);
      }
    });

    it('accepts firestore without connection config', () => {
      const persistence = {
        driver: 'firestore',
      };
      const result = PersistenceConfigSchema.safeParse(persistence);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.driver).toBe('firestore');
      }
    });

    it('accepts firestore with autoDiscover', () => {
      const persistence = {
        driver: 'firestore',
        autoDiscover: true,
      };
      const result = PersistenceConfigSchema.safeParse(persistence);
      expect(result.success).toBe(true);
    });

    it('fails when postgres has neither connection nor autoDiscover', () => {
      const persistence = {
        driver: 'postgres',
      };
      const result = PersistenceConfigSchema.safeParse(persistence);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map(i => i.message);
        expect(messages).toContain('PostgreSQL persistence requires either connection config or autoDiscover');
      }
    });
  });

  describe('EnvOverlayConfigSchema', () => {
    it('accepts overlay config with all fields', () => {
      const overlay = {
        path: 'env/local',
        files: ['global.yaml', 'infra.yaml', '{service}.yaml'],
        secure: '.secure.local',
      };
      const result = EnvOverlayConfigSchema.safeParse(overlay);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.path).toBe('env/local');
        expect(result.data.files).toHaveLength(3);
        expect(result.data.secure).toBe('.secure.local');
      }
    });

    it('accepts overlay config without secure file', () => {
      const overlay = {
        path: 'env/staging',
        files: ['global.yaml'],
      };
      const result = EnvOverlayConfigSchema.safeParse(overlay);
      expect(result.success).toBe(true);
    });

    it('fails when path is missing', () => {
      const overlay = {
        files: ['global.yaml'],
      };
      const result = EnvOverlayConfigSchema.safeParse(overlay);
      expect(result.success).toBe(false);
    });

    it('fails when files array is missing', () => {
      const overlay = {
        path: 'env/local',
      };
      const result = EnvOverlayConfigSchema.safeParse(overlay);
      expect(result.success).toBe(false);
    });
  });

  describe('ExecutionContextSchema', () => {
    it('accepts valid local development context', () => {
      const context = {
        description: 'Local Docker development environment',
        deployment: {
          type: 'docker-compose',
          docker: {
            host: 'unix:///var/run/docker.sock',
          },
        },
        runtime: {
          gateway: {
            autoDiscover: true,
            fallbackPort: 3004,
          },
          persistence: {
            driver: 'firestore',
            autoDiscover: true,
          },
          envOverlay: {
            path: 'env/local',
            files: ['global.yaml', 'infra.yaml', '{service}.yaml'],
            secure: '.secure.local',
          },
        },
        tags: ['development', 'local'],
      };
      const result = ExecutionContextSchema.safeParse(context);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.description).toContain('Local Docker');
        expect(result.data.deployment.type).toBe('docker-compose');
        expect(result.data.runtime.persistence.driver).toBe('firestore');
        expect(result.data.tags).toContain('development');
      }
    });

    it('accepts valid staging context with postgres', () => {
      const context = {
        description: 'Remote staging environment',
        deployment: {
          type: 'docker-compose',
          docker: {
            host: 'ssh://root@bitbrat.lan',
            remoteDir: '/opt/BitBratPlatform',
            maxConcurrent: 3,
          },
        },
        runtime: {
          gateway: {
            url: 'http://bitbrat.lan:3002',
            authToken: '${MCP_AUTH_TOKEN}',
          },
          persistence: {
            driver: 'postgres',
            connection: {
              host: 'bitbrat.lan',
              port: 5432,
              database: 'bitbrat',
              username: 'bitbrat',
              password: 'bitbrat_dev_password',
            },
          },
          envOverlay: {
            path: 'env/staging',
            files: ['global.yaml', 'infra.yaml', '{service}.yaml'],
            secure: '.secure.staging',
          },
        },
        tags: ['staging', 'remote'],
      };
      const result = ExecutionContextSchema.safeParse(context);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.deployment.docker?.host).toBe('ssh://root@bitbrat.lan');
        expect(result.data.runtime.persistence.driver).toBe('postgres');
        expect(result.data.runtime.gateway?.url).toBe('http://bitbrat.lan:3002');
      }
    });

    it('accepts valid cloud-run production context', () => {
      const context = {
        description: 'Production Cloud Run environment',
        deployment: {
          type: 'cloud-run',
          gcp: {
            project: 'my-project',
            region: 'us-central1',
          },
        },
        runtime: {
          gateway: {
            url: 'https://api.bitbrat.ai',
            authToken: '${MCP_AUTH_TOKEN}',
          },
          persistence: {
            driver: 'postgres',
            connection: {
              host: '10.0.0.5',
              port: 5432,
              database: 'bitbrat',
              username: 'bitbrat',
              password: '${PROD_DB_PASSWORD}',
            },
          },
        },
        tags: ['production', 'cloud-run'],
      };
      const result = ExecutionContextSchema.safeParse(context);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.deployment.type).toBe('cloud-run');
        expect(result.data.deployment.gcp?.project).toBe('my-project');
        expect(result.data.tags).toContain('production');
      }
    });

    it('accepts minimal valid context (no description, tags, envOverlay)', () => {
      const context = {
        deployment: {
          type: 'docker-compose',
          docker: {
            host: 'unix:///var/run/docker.sock',
          },
        },
        runtime: {
          gateway: {
            fallbackPort: 3000,
          },
          persistence: {
            driver: 'firestore',
          },
        },
      };
      const result = ExecutionContextSchema.safeParse(context);
      expect(result.success).toBe(true);
    });

    it('fails when deployment is missing', () => {
      const context = {
        runtime: {
          persistence: {
            driver: 'firestore',
          },
        },
      };
      const result = ExecutionContextSchema.safeParse(context);
      expect(result.success).toBe(false);
    });

    it('fails when runtime is missing', () => {
      const context = {
        deployment: {
          type: 'docker-compose',
          docker: {
            host: 'unix:///var/run/docker.sock',
          },
        },
      };
      const result = ExecutionContextSchema.safeParse(context);
      expect(result.success).toBe(false);
    });

    it('fails when persistence is missing', () => {
      const context = {
        deployment: {
          type: 'docker-compose',
          docker: {
            host: 'unix:///var/run/docker.sock',
          },
        },
        runtime: {
          gateway: {
            fallbackPort: 3000,
          },
        },
      };
      const result = ExecutionContextSchema.safeParse(context);
      expect(result.success).toBe(false);
    });
  });

  describe('ExecutionContextsSchema', () => {
    it('accepts valid contexts map', () => {
      const contexts = {
        local: {
          description: 'Local development',
          deployment: {
            type: 'docker-compose',
            docker: {
              host: 'unix:///var/run/docker.sock',
            },
          },
          runtime: {
            gateway: {
              autoDiscover: true,
            },
            persistence: {
              driver: 'firestore',
            },
          },
          tags: ['development'],
        },
        staging: {
          description: 'Staging environment',
          deployment: {
            type: 'docker-compose',
            docker: {
              host: 'ssh://root@staging.local',
            },
          },
          runtime: {
            gateway: {
              url: 'http://staging.local:3000',
            },
            persistence: {
              driver: 'postgres',
              autoDiscover: true,
            },
          },
          tags: ['staging'],
        },
      };
      const result = ExecutionContextsSchema.safeParse(contexts);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(Object.keys(result.data)).toHaveLength(2);
        expect(result.data.local).toBeDefined();
        expect(result.data.staging).toBeDefined();
      }
    });

    it('accepts empty contexts map', () => {
      const contexts = {};
      const result = ExecutionContextsSchema.safeParse(contexts);
      expect(result.success).toBe(true);
    });

    it('fails when any context is invalid', () => {
      const contexts = {
        local: {
          deployment: {
            type: 'docker-compose',
            docker: {
              host: 'unix:///var/run/docker.sock',
            },
          },
          runtime: {
            // Missing persistence (required)
            gateway: {
              fallbackPort: 3000,
            },
          },
        },
      };
      const result = ExecutionContextsSchema.safeParse(contexts);
      expect(result.success).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('accepts context with all optional fields populated', () => {
      const context = {
        description: 'Full featured context',
        deployment: {
          type: 'docker-compose',
          docker: {
            host: 'ssh://root@test.local',
            remoteDir: '/opt/app',
            maxConcurrent: 5,
          },
        },
        runtime: {
          gateway: {
            url: 'http://test.local:3000',
            authToken: 'token',
            autoDiscover: true,
            fallbackPort: 3001,
          },
          persistence: {
            driver: 'postgres',
            autoDiscover: true,
            connection: {
              host: 'test.local',
              port: 5432,
              database: 'test',
              username: 'test',
              password: 'test',
            },
          },
          envOverlay: {
            path: 'env/test',
            files: ['a.yaml', 'b.yaml'],
            secure: '.secure.test',
          },
        },
        tags: ['test', 'full-featured'],
      };
      const result = ExecutionContextSchema.safeParse(context);
      expect(result.success).toBe(true);
    });

    it('rejects invalid deployment type', () => {
      const context = {
        deployment: {
          type: 'invalid-type',
          docker: {
            host: 'unix:///var/run/docker.sock',
          },
        },
        runtime: {
          persistence: {
            driver: 'firestore',
          },
        },
      };
      const result = ExecutionContextSchema.safeParse(context);
      expect(result.success).toBe(false);
    });

    it('rejects invalid persistence driver', () => {
      const context = {
        deployment: {
          type: 'docker-compose',
          docker: {
            host: 'unix:///var/run/docker.sock',
          },
        },
        runtime: {
          persistence: {
            driver: 'mysql',
          },
        },
      };
      const result = ExecutionContextSchema.safeParse(context);
      expect(result.success).toBe(false);
    });
  });
});
