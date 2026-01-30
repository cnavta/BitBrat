import readline from 'readline';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execCmd } from '../orchestration/exec';
import { Logger } from '../orchestration/logger';
import { v4 as uuidv4 } from 'uuid';
import admin from 'firebase-admin';

export interface SetupOptions {
  projectId?: string;
  openaiKey?: string;
  botName?: string;
}

export const updateYaml = (content: string, key: string, value: string) => {
  const regex = new RegExp(`^${key}:.*`, 'm');
  if (regex.test(content)) {
    return content.replace(regex, `${key}: "${value}"`);
  } else {
    const prefix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
    return content + prefix + `${key}: "${value}"\n`;
  }
};

export const updateEnv = (content: string, key: string, value: string) => {
  const regex = new RegExp(`^${key}=.*`, 'm');
  if (regex.test(content)) {
    return content.replace(regex, `${key}=${value}`);
  } else {
    const prefix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
    return content + prefix + `${key}=${value}\n`;
  }
};

export const removeYamlKey = (content: string, key: string) => {
  const regex = new RegExp(`^${key}:.*\\n?`, 'm');
  return content.replace(regex, '');
};

export const replacePlaceholders = (content: string, vars: Record<string, string>) => {
  let result = content;
  for (const [key, value] of Object.entries(vars)) {
    const regex = new RegExp(`%${key}%`, 'g');
    result = result.replace(regex, value);
  }
  return result;
};

export const isAlreadyInitialized = (root: string): string[] => {
  const markers = [
    { path: path.join(root, '.bitbrat.json'), name: '.bitbrat.json' },
    { path: path.join(root, '.secure.local'), name: '.secure.local' },
    { path: path.join(root, 'env', 'local', 'global.yaml'), name: 'env/local/global.yaml' },
  ];
  return markers.filter((m) => fs.existsSync(m.path)).map((m) => m.name);
};

export async function cmdSetup(opts: any, log: Logger) {
  const root = process.cwd();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const ask = (query: string): Promise<string> => new Promise((resolve) => rl.question(query, resolve));

  try {
    log.info({ action: 'setup.start' }, 'Starting BitBrat Platform Setup');
    console.log('\n--- BitBrat Platform Setup ---\n');

    const markers = isAlreadyInitialized(root);
    if (markers.length > 0) {
      console.log('\x1b[33m%s\x1b[0m', 'WARNING: This platform appears to be already initialized.');
      console.log('Detected configuration files:', markers.join(', '));
      const confirm = await ask('\nAre you sure you want to continue and overwrite existing settings? (y/N): ');
      if (confirm.toLowerCase() !== 'y') {
        console.log('Setup aborted.');
        log.info({ action: 'setup.aborted' }, 'User aborted setup due to existing configuration');
        return;
      }
    }

    const projectId = opts.projectId || await ask('GCP Project ID: ');
    if (!projectId) throw new Error('Project ID is required');

    const openaiKey = opts.openaiKey || await ask('OpenAI API Key: ');
    if (!openaiKey) throw new Error('OpenAI API Key is required');

    const botName = opts.botName || await ask('Bot Name (e.g. BitBrat): ');
    if (!botName) throw new Error('Bot Name is required');

    console.log('\n--- Configuration Summary ---');
    console.log(`GCP Project ID: ${projectId}`);
    console.log(`OpenAI API Key: ${openaiKey ? '********' : 'MISSING'}`);
    console.log(`Bot Name:       ${botName}\n`);

    // 1. Persistence
    log.info({ action: 'setup.persist' }, 'Writing configuration files...');
    
    // Ensure env/local exists
    const localEnvDir = path.join(root, 'env', 'local');
    if (!fs.existsSync(localEnvDir)) fs.mkdirSync(localEnvDir, { recursive: true });

    // Update env/local/global.yaml
    const globalYamlPath = path.join(localEnvDir, 'global.yaml');
    let globalYamlContent = fs.existsSync(globalYamlPath) ? fs.readFileSync(globalYamlPath, 'utf8') : '';
    
    globalYamlContent = updateYaml(globalYamlContent, 'PROJECT_ID', projectId);
    globalYamlContent = updateYaml(globalYamlContent, 'BOT_NAME', botName);
    // Clear API_GATEWAY_HOST_PORT from global.yaml to allow deploy-local.sh to auto-assign if there's a collision.
    // brat chat will then dynamically discover the assigned port from Docker.
    globalYamlContent = removeYamlKey(globalYamlContent, 'API_GATEWAY_HOST_PORT');
    fs.writeFileSync(globalYamlPath, globalYamlContent, 'utf8');

    // Update .secure.local
    const secureLocalPath = path.join(root, '.secure.local');
    let secureLocalContent = fs.existsSync(secureLocalPath) ? fs.readFileSync(secureLocalPath, 'utf8') : '';
    
    secureLocalContent = updateEnv(secureLocalContent, 'OPENAI_API_KEY', openaiKey);
    fs.writeFileSync(secureLocalPath, secureLocalContent, 'utf8');

    // 2. Bootstrap Local Environment
    log.info({ action: 'setup.bootstrap' }, 'Bootstrapping local environment (this may take a minute)...');
    console.log('Starting local emulators...');
    // We run deploy-local.sh
    const deployRes = await execCmd('./infrastructure/deploy-local.sh', []);
    if (deployRes.code !== 0) {
      log.error({ action: 'setup.bootstrap.failed', stderr: deployRes.stderr }, 'Local deployment failed');
      throw new Error('Local deployment failed. Check logs.');
    }

    // 3. Wait for Firestore Emulator
    log.info({ action: 'setup.wait-firestore' }, 'Waiting for Firestore emulator...');
    // In a real implementation we'd probe, but deploy-local already probes healthz for some services.
    // However, it might not probe the emulator directly if it's not in the service list.
    // Let's assume it's up if deploy-local finished successfully, but maybe add a small delay or check.
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
    
    // 4. Populate Firestore
    log.info({ action: 'setup.populate' }, 'Populating Firestore with initial data...');
    
    if (!admin.apps.length) {
        admin.initializeApp({ projectId });
    }
    const db = admin.firestore();

    // A. API Gateway Token
    const apiToken = uuidv4();
    const tokenHash = crypto.createHash('sha256').update(apiToken).digest('hex');
    
    await db.collection('gateways/api/tokens').doc(tokenHash).set({
      token_hash: tokenHash,
      uid: 'brat-admin',
      description: 'Initial admin token for chat',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Save token locally for chat CLI and environment
    const bitbratJsonPath = path.join(root, '.bitbrat.json');
    fs.writeFileSync(bitbratJsonPath, JSON.stringify({ apiToken }, null, 2), 'utf8');

    secureLocalContent = updateEnv(secureLocalContent, 'BITBRAT_API_TOKEN', apiToken);
    fs.writeFileSync(secureLocalPath, secureLocalContent, 'utf8');

    // B. Personality
    await db.collection('personalities').doc(botName.toLowerCase()).set({
      name: botName,
      description: `Default personality for ${botName}`,
      instructions: `You are ${botName}, a helpful AI assistant.`
    });

    // C. Rules
    const rulesDir = path.join(root, 'documentation', 'reference', 'setup');
    if (fs.existsSync(rulesDir)) {
      const files = fs.readdirSync(rulesDir).filter(f => f.endsWith('.json'));
      const placeholderVars = {
        PROJECT_ID: projectId,
        BOT_NAME: botName,
        botUsername: botName,
        OPENAI_API_KEY: openaiKey,
        BITBRAT_API_TOKEN: apiToken
      };

      for (const file of files) {
        const filePath = path.join(rulesDir, file);
        let content = fs.readFileSync(filePath, 'utf8');
        
        content = replacePlaceholders(content, placeholderVars);

        const ruleData = JSON.parse(content);
        const ruleId = path.basename(file, '.json');
        await db.collection('configs/routingRules/rules').doc(ruleId).set(ruleData);
      }
    }

    console.log('\n--- Setup Complete! ---');
    console.log(`API Token: ${apiToken}`);
    console.log('You can now start chatting with your bot using:');
    console.log('  npm run brat -- chat');
    
  } catch (err: any) {
    log.error({ action: 'setup.error', error: err.message }, 'Setup failed');
    console.error(`\nError: ${err.message}`);
  } finally {
    rl.close();
  }
}
