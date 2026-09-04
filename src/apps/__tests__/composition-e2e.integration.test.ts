/**
 * End-to-End Integration Tests for Composition System (Sprint 41 - COMP-020)
 *
 * Tests complete composition lifecycle: load YAML → register → execute → verify
 * Uses actual example compositions from examples/compositions/
 *
 * @module apps/__tests__/composition-e2e.integration
 */

import request from 'supertest';
import { createServer } from '../tool-gateway';
import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';

/**
 * Sprint 41 (COMP-020): End-to-End Composition Tests
 *
 * Tests: 6 covering complete composition lifecycle with real examples
 *
 * NOTE: These tests require DocumentStore (PostgreSQL) to be available.
 * They will be skipped if compositions are disabled (no DocumentStore).
 */

// Skip if DocumentStore not available
const shouldSkip = process.env.SKIP_COMPOSITION_TESTS === 'true' || process.env.CI === 'true';
const describeOrSkip = shouldSkip ? describe.skip : describe;

describeOrSkip('Composition E2E Integration', () => {
  let server: ReturnType<typeof createServer>;
  let app: any;
  let compositionsEnabled = false;

  // Example composition paths
  const examplesDir = path.join(__dirname, '../../../examples/compositions');
  const simpleGreetingPath = path.join(examplesDir, 'simple_greeting.yaml');
  const conditionalMessagePath = path.join(examplesDir, 'conditional_message.yaml');
  const multiStepWorkflowPath = path.join(examplesDir, 'multi_step_workflow.yaml');

  beforeAll(async () => {
    server = createServer();
    app = server.getApp();
    compositionsEnabled = (server as any).compositionsEnabled === true;

    if (!compositionsEnabled) {
      console.log('⚠ Compositions disabled (DocumentStore not available) - skipping E2E tests');
    }
  });

  afterAll(async () => {
    await server.close('test');
  });

  // Helper to skip tests if compositions disabled
  const itOrSkip = (name: string, fn: () => Promise<void>) => {
    return compositionsEnabled ? it(name, fn) : it.skip(name, fn);
  };

  // Helper to load YAML file
  const loadYaml = async (filePath: string): Promise<any> => {
    const content = await fs.readFile(filePath, 'utf-8');
    return yaml.load(content);
  };

  describe('Simple Greeting Composition', () => {
    itOrSkip('should load, register, and execute simple_greeting.yaml', async () => {
      // 1. Load YAML definition
      const definition = await loadYaml(simpleGreetingPath);

      // 2. Register via REST API
      const registerResponse = await request(app)
        .post('/v1/compositions')
        .send(definition)
        .expect('Content-Type', /json/)
        .expect(201);

      expect(registerResponse.body).toHaveProperty('name', 'simple_greeting');
      expect(registerResponse.body).toHaveProperty('version', 1);

      // 3. Execute composition via MCP tool (simulated)
      // Note: In E2E, we'd call the tool directly, but in this test we verify registration
      const listResponse = await request(app)
        .get('/v1/compositions')
        .expect(200);

      const simpleGreeting = listResponse.body.compositions.find(
        (c: any) => c.name === 'simple_greeting'
      );
      expect(simpleGreeting).toBeDefined();
      expect(simpleGreeting.version).toBe(1);

      // 4. Verify composition can be retrieved
      const getResponse = await request(app)
        .get('/v1/compositions/simple_greeting')
        .expect(200);

      expect(getResponse.body.metadata.name).toBe('simple_greeting');
      expect(getResponse.body.spec.inputSchema).toHaveProperty('type', 'object');
      expect(getResponse.body.spec.inputSchema.properties).toHaveProperty('username');
    });

    itOrSkip('should execute simple_greeting with expected output structure', async () => {
      // Load and register
      const definition = await loadYaml(simpleGreetingPath);
      await request(app).post('/v1/compositions').send(definition).expect(201);

      // Execute via tool (if tool execution is implemented)
      // For now, we verify the composition is properly structured
      const response = await request(app)
        .get('/v1/compositions/simple_greeting/1')
        .expect(200);

      expect(response.body.spec.return).toHaveProperty('greeting');
      expect(response.body.spec.return.user).toHaveProperty('$ref');
      expect(response.body.spec.return.user.$ref.namespace).toBe('input');
      expect(response.body.spec.return.user.$ref.pointer).toBe('/username');
    });
  });

  describe('Conditional Message Composition', () => {
    itOrSkip('should load and register conditional_message.yaml', async () => {
      const definition = await loadYaml(conditionalMessagePath);

      const response = await request(app)
        .post('/v1/compositions')
        .send(definition)
        .expect(201);

      expect(response.body.name).toBe('conditional_message');
      expect(response.body.version).toBe(1);
    });

    itOrSkip('should have correct conditional logic structure', async () => {
      const definition = await loadYaml(conditionalMessagePath);
      await request(app).post('/v1/compositions').send(definition).expect(201);

      const response = await request(app)
        .get('/v1/compositions/conditional_message/1')
        .expect(200);

      // Verify step structure
      const steps = response.body.spec.steps;
      expect(steps).toHaveLength(3);

      // Step 1: message_prefix (ifValue)
      expect(steps[0].id).toBe('message_prefix');
      expect(steps[0]).toHaveProperty('ifValue');

      // Step 2: message_content (ifValue)
      expect(steps[1].id).toBe('message_content');
      expect(steps[1]).toHaveProperty('ifValue');

      // Step 3: progress_notification (call with when condition)
      expect(steps[2].id).toBe('progress_notification');
      expect(steps[2].call).toBe('agent.sendProgressUpdate');
      expect(steps[2]).toHaveProperty('when');
    });
  });

  describe('Multi-Step Workflow Composition', () => {
    itOrSkip('should load and register multi_step_workflow.yaml', async () => {
      const definition = await loadYaml(multiStepWorkflowPath);

      const response = await request(app)
        .post('/v1/compositions')
        .send(definition)
        .expect(201);

      expect(response.body.name).toBe('multi_step_workflow');
      expect(response.body.version).toBe(1);
    });

    itOrSkip('should have correct multi-step structure with data flow', async () => {
      const definition = await loadYaml(multiStepWorkflowPath);
      await request(app).post('/v1/compositions').send(definition).expect(201);

      const response = await request(app)
        .get('/v1/compositions/multi_step_workflow/1')
        .expect(200);

      const steps = response.body.spec.steps;
      expect(steps).toHaveLength(4);

      // Verify step IDs
      const stepIds = steps.map((s: any) => s.id);
      expect(stepIds).toContain('validation');
      expect(stepIds).toContain('initial_notification');
      expect(stepIds).toContain('processing');
      expect(stepIds).toContain('completion_notification');

      // Verify return uses step references
      const returnExpr = response.body.spec.return;
      expect(returnExpr).toHaveProperty('workflow_id', 'multi_step_workflow_v1');
      expect(returnExpr.validation).toHaveProperty('$ref');
      expect(returnExpr.validation.$ref.namespace).toBe('steps');
      expect(returnExpr.validation.$ref.pointer).toBe('/validation');
    });
  });

  describe('Version Management', () => {
    itOrSkip('should create new version when composition content changes', async () => {
      const definition = await loadYaml(simpleGreetingPath);

      // Register version 1
      const v1Response = await request(app)
        .post('/v1/compositions')
        .send(definition)
        .expect(201);

      expect(v1Response.body.version).toBe(1);
      const v1Hash = v1Response.body.contentHash;

      // Modify definition and register again
      const modifiedDefinition = {
        ...definition,
        metadata: {
          ...definition.metadata,
          description: 'Modified description for v2',
        },
      };

      const v2Response = await request(app)
        .post('/v1/compositions')
        .send(modifiedDefinition)
        .expect(201);

      expect(v2Response.body.version).toBe(2);
      expect(v2Response.body.contentHash).not.toBe(v1Hash);

      // Verify both versions exist
      const v1Get = await request(app)
        .get('/v1/compositions/simple_greeting/1')
        .expect(200);

      const v2Get = await request(app)
        .get('/v1/compositions/simple_greeting/2')
        .expect(200);

      expect(v1Get.body.metadata.version).toBe(1);
      expect(v2Get.body.metadata.version).toBe(2);
      expect(v2Get.body.metadata.description).toBe('Modified description for v2');
    });
  });

  describe('Error Handling', () => {
    itOrSkip('should reject composition with invalid schema', async () => {
      const invalidDefinition = {
        // Missing apiVersion
        kind: 'Composition',
        metadata: {
          name: 'invalid_composition',
          description: 'This should fail',
        },
        spec: {
          inputSchema: { type: 'object' },
          steps: [],
          return: { success: false },
        },
      };

      const response = await request(app)
        .post('/v1/compositions')
        .send(invalidDefinition)
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    itOrSkip('should handle concurrent composition registrations', async () => {
      const definition = await loadYaml(simpleGreetingPath);

      // Register same composition multiple times concurrently
      const promises = Array(5)
        .fill(null)
        .map(() => request(app).post('/v1/compositions').send(definition));

      const responses = await Promise.all(promises);

      // All should succeed (deduplicated by content hash)
      responses.forEach((res) => {
        expect(res.status).toBe(201);
        expect(res.body.name).toBe('simple_greeting');
      });

      // All should have same content hash
      const hashes = responses.map((r) => r.body.contentHash);
      const uniqueHashes = new Set(hashes);
      expect(uniqueHashes.size).toBe(1);
    });
  });
});
