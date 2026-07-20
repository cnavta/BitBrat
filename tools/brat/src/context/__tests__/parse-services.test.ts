/**
 * Sprint 352: Tests for parse-services module
 * Story S1.1: Parse architecture.yaml for Active Services
 */

import { parseActiveServices, getActiveServicesArray, getAllRequiredEnvVars, getAllRequiredSecrets } from '../parse-services';
import * as path from 'path';

describe('parse-services', () => {
  const repoRoot = path.join(__dirname, '../../../../..');

  describe('parseActiveServices', () => {
    it('should parse active services from architecture.yaml', () => {
      const services = parseActiveServices(repoRoot);

      expect(services.size).toBeGreaterThan(0);
      expect(services instanceof Map).toBe(true);
    });

    it('should only include services with active: true', () => {
      const services = parseActiveServices(repoRoot);

      for (const [name, svc] of services.entries()) {
        expect(svc.active).toBe(true);
      }
    });

    it('should extract required env vars and secrets', () => {
      const services = parseActiveServices(repoRoot);

      // Find llm-bot service (we know it has env vars and secrets)
      const llmBot = services.get('llm-bot');

      if (llmBot) {
        expect(Array.isArray(llmBot.envKeys)).toBe(true);
        expect(Array.isArray(llmBot.secrets)).toBe(true);
        expect(llmBot.secrets.length).toBeGreaterThan(0); // Should have OPENAI_API_KEY
      }
    });

    it('should extract service metadata correctly', () => {
      const services = parseActiveServices(repoRoot);

      // Check a known service structure
      for (const [name, svc] of services.entries()) {
        expect(svc.name).toBe(name);
        expect(svc.active).toBe(true);
        expect(['platform', 'domain']).toContain(svc.category);
        expect(['core', 'gateway', 'llm', 'mcp-server']).toContain(svc.profile);
        expect(svc.kind).toBeDefined();
        expect(svc.entry).toBeDefined();
      }
    });
  });

  describe('getActiveServicesArray', () => {
    it('should return an array of services', () => {
      const services = getActiveServicesArray(repoRoot);

      expect(Array.isArray(services)).toBe(true);
      expect(services.length).toBeGreaterThan(0);
    });
  });

  describe('getAllRequiredEnvVars', () => {
    it('should collect all unique env vars', () => {
      const envVars = getAllRequiredEnvVars(repoRoot);

      expect(envVars instanceof Set).toBe(true);
      expect(envVars.size).toBeGreaterThan(0);
    });
  });

  describe('getAllRequiredSecrets', () => {
    it('should collect all unique secrets', () => {
      const secrets = getAllRequiredSecrets(repoRoot);

      expect(secrets instanceof Set).toBe(true);
      expect(secrets.size).toBeGreaterThan(0);

      // Should include common secrets
      // (Only check if we know they exist in architecture.yaml)
    });
  });
});
