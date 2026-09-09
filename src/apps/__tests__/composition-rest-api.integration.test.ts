/**
 * Integration Tests for Composition REST API (Sprint 41 - COMP-017)
 *
 * Tests composition management REST API endpoints end-to-end.
 * Covers registration, retrieval, deletion, versioning, and error handling.
 *
 * @module apps/__tests__/composition-rest-api.integration
 */

import request from 'supertest';
import { createServer } from '../tool-gateway';
import type { CompositionDefinition } from '../../common/composition/types';

/**
 * Sprint 41 (COMP-017): REST API Integration Tests
 *
 * Tests: 9 covering all composition management endpoints
 *
 * NOTE: These tests require DocumentStore (PostgreSQL) to be available.
 * They will be skipped if compositions are disabled (no DocumentStore).
 */

// Skip if DocumentStore not available (similar to claim-check Redis tests)
const shouldSkip = process.env.SKIP_COMPOSITION_TESTS === 'true' || process.env.CI === 'true';
const describeOrSkip = shouldSkip ? describe.skip : describe;

describeOrSkip('Composition REST API Integration', () => {
  let server: ReturnType<typeof createServer>;
  let app: any;
  let compositionsEnabled = false;

  beforeAll(async () => {
    server = createServer();
    app = server.getApp();

    // Check if compositions are actually enabled
    compositionsEnabled = (server as any).compositionsEnabled === true;

    if (!compositionsEnabled) {
      console.log('⚠ Compositions disabled (DocumentStore not available) - skipping integration tests');
    }
  });

  afterAll(async () => {
    await server.close('test');
  });

  // Helper to skip test if compositions disabled
  const itOrSkip = (name: string, fn: () => Promise<void>) => {
    return compositionsEnabled ? it(name, fn) : it.skip(name, fn);
  };

  // Helper to create minimal composition definition
  const createTestComposition = (name: string, version?: number): CompositionDefinition => ({
    apiVersion: 'mcp-compose/v1',
    kind: 'Composition',
    metadata: {
      name,
      description: `Test composition: ${name}`,
    },
    spec: {
      inputSchema: {
        type: 'object',
        properties: {
          input: { type: 'string' },
        },
      },
      steps: [
        {
          id: 'step1',
          call: 'agent.sendProgressUpdate',
          with: { message: 'test', emoji: '🔄' },
        },
      ],
      return: { success: true },
    },
  });

  describe('POST /v1/compositions - Register new composition', () => {
    itOrSkip('should register a new composition successfully', async () => {
      const definition = createTestComposition('test_register_composition');

      const response = await request(app)
        .post('/v1/compositions')
        .send(definition)
        .expect('Content-Type', /json/)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('name', 'test_register_composition');
      expect(response.body).toHaveProperty('version', 1);
      expect(response.body).toHaveProperty('contentHash');
    });

    itOrSkip('should detect duplicate compositions by content hash', async () => {
      const definition = createTestComposition('test_duplicate_composition');

      // Register once
      const response1 = await request(app)
        .post('/v1/compositions')
        .send(definition)
        .expect(201);

      // Register again with same content
      const response2 = await request(app)
        .post('/v1/compositions')
        .send(definition)
        .expect(201);

      // Should return same composition (deduplicated)
      expect(response1.body.id).toBe(response2.body.id);
      expect(response1.body.contentHash).toBe(response2.body.contentHash);
    });

    itOrSkip('should reject invalid composition definitions', async () => {
      const invalidDefinition = {
        // Missing apiVersion
        kind: 'Composition',
        metadata: { name: 'invalid' },
        spec: {},
      };

      await request(app)
        .post('/v1/compositions')
        .send(invalidDefinition)
        .expect(400);
    });
  });

  describe('GET /v1/compositions - List all compositions', () => {
    itOrSkip('should list all registered compositions', async () => {
      // Register a couple of compositions
      await request(app)
        .post('/v1/compositions')
        .send(createTestComposition('test_list_comp_1'))
        .expect(201);

      await request(app)
        .post('/v1/compositions')
        .send(createTestComposition('test_list_comp_2'))
        .expect(201);

      const response = await request(app)
        .get('/v1/compositions')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('compositions');
      expect(Array.isArray(response.body.compositions)).toBe(true);
      expect(response.body.compositions.length).toBeGreaterThanOrEqual(2);

      // Check that each composition has required fields
      response.body.compositions.forEach((comp: any) => {
        expect(comp).toHaveProperty('id');
        expect(comp).toHaveProperty('name');
        expect(comp).toHaveProperty('version');
        expect(comp).toHaveProperty('contentHash');
        expect(comp).toHaveProperty('createdAt');
        expect(comp).toHaveProperty('updatedAt');
      });
    });
  });

  describe('GET /v1/compositions/:name - Get latest version', () => {
    itOrSkip('should retrieve latest version of a composition', async () => {
      const name = 'test_get_latest_composition';

      // Register version 1
      await request(app)
        .post('/v1/compositions')
        .send(createTestComposition(name))
        .expect(201);

      // Register version 2 (modified content)
      const def2 = createTestComposition(name);
      def2.metadata.description = 'Updated description'; // Change content
      await request(app)
        .post('/v1/compositions')
        .send(def2)
        .expect(201);

      // Retrieve latest version
      const response = await request(app)
        .get(`/v1/compositions/${name}`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('metadata');
      expect(response.body.metadata).toHaveProperty('name', name);
      expect(response.body.metadata).toHaveProperty('version', 2); // Should be v2
    });

    itOrSkip('should return 404 for non-existent composition', async () => {
      await request(app)
        .get('/v1/compositions/nonexistent_composition')
        .expect(404);
    });
  });

  describe('GET /v1/compositions/:name/:version - Get specific version', () => {
    itOrSkip('should retrieve a specific version of a composition', async () => {
      const name = 'test_get_version_composition';

      // Register version 1
      await request(app)
        .post('/v1/compositions')
        .send(createTestComposition(name))
        .expect(201);

      // Register version 2
      const def2 = createTestComposition(name);
      def2.metadata.description = 'Updated for v2';
      await request(app)
        .post('/v1/compositions')
        .send(def2)
        .expect(201);

      // Retrieve version 1 specifically
      const response = await request(app)
        .get(`/v1/compositions/${name}/1`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('metadata');
      expect(response.body.metadata).toHaveProperty('version', 1);
      expect(response.body.metadata).toHaveProperty('description', `Test composition: ${name}`);
    });

    itOrSkip('should return 400 for invalid version number', async () => {
      await request(app)
        .get('/v1/compositions/test_composition/invalid')
        .expect(400);
    });
  });

  describe('DELETE /v1/compositions/:name/:version - Delete composition', () => {
    itOrSkip('should delete a specific version of a composition', async () => {
      const name = 'test_delete_composition';

      // Register composition
      await request(app)
        .post('/v1/compositions')
        .send(createTestComposition(name))
        .expect(201);

      // Delete version 1
      await request(app)
        .delete(`/v1/compositions/${name}/1`)
        .expect(204);

      // Verify it's deleted
      await request(app)
        .get(`/v1/compositions/${name}/1`)
        .expect(404);
    });

    itOrSkip('should return error when deleting non-existent composition', async () => {
      await request(app)
        .delete('/v1/compositions/nonexistent/1')
        .expect(500); // RegistryError should result in 500
    });
  });

  describe('GET /v1/compositions/stats - Get registry statistics', () => {
    itOrSkip('should return registry statistics', async () => {
      // Register a few compositions
      await request(app)
        .post('/v1/compositions')
        .send(createTestComposition('test_stats_comp_1'))
        .expect(201);

      await request(app)
        .post('/v1/compositions')
        .send(createTestComposition('test_stats_comp_2'))
        .expect(201);

      const response = await request(app)
        .get('/v1/compositions/stats')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('totalCompositions');
      expect(response.body).toHaveProperty('totalVersions');
      expect(response.body).toHaveProperty('compositionsByName');
      expect(typeof response.body.totalCompositions).toBe('number');
      expect(typeof response.body.totalVersions).toBe('number');
      expect(typeof response.body.compositionsByName).toBe('object');
    });
  });

  describe('Feature flag disabled behavior', () => {
    itOrSkip('should return 503 when compositions are disabled', async () => {
      // Create server with compositions disabled
      const originalEnv = process.env.ENABLE_COMPOSITIONS;
      process.env.ENABLE_COMPOSITIONS = 'false';

      const disabledServer = createServer();
      const disabledApp = disabledServer.getApp();

      const definition = createTestComposition('test_disabled');

      await request(disabledApp)
        .post('/v1/compositions')
        .send(definition)
        .expect(503);

      await request(disabledApp)
        .get('/v1/compositions')
        .expect(503);

      await request(disabledApp)
        .get('/v1/compositions/test/1')
        .expect(503);

      await request(disabledApp)
        .delete('/v1/compositions/test/1')
        .expect(503);

      await request(disabledApp)
        .get('/v1/compositions/stats')
        .expect(503);

      process.env.ENABLE_COMPOSITIONS = originalEnv;
      await disabledServer.close('test');
    });
  });
});
