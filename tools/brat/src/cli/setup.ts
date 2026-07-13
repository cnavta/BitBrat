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

async function hasData(db: admin.firestore.Firestore, collectionPath: string): Promise<boolean> {
  try {
    const snap = await db.collection(collectionPath).limit(1).get();
    return !snap.empty;
  } catch (e) {
    return false;
  }
}

async function wipeCollection(db: admin.firestore.Firestore, collectionPath: string) {
  const snap = await db.collection(collectionPath).get();
  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

export const getInitialRoutingRules = (botName: string) => [
  {
    id: 'initial-analysis',
    enabled: true,
    priority: 100,
    description: 'Route initial events to auth, reflex, query-analysis, and event-router for analysis stage',
    logic: JSON.stringify({ "==": [ { "var": "routing.stage" }, "initial" ] }),
    routing: {
      stage: 'analysis',
      slip: [
        { id: 'auth', v: '1', nextTopic: 'internal.auth.v1' },
        { id: 'reflex', v: '1', nextTopic: 'internal.reflex.v1' },
        { id: 'query-analysis', v: '1', nextTopic: 'internal.query.analysis.v1' },
        { id: 'event-router', v: '1', nextTopic: 'internal.enriched.v1' }
      ]
    },
    enrichments: {
    }
  },
  {
    id: 'analysis-reaction-bot',
    enabled: true,
    priority: 50,
    description: `Route bot mentions to LLM bot`,
    logic: JSON.stringify({
      "and": [
        { "==": [ { "var": "routing.stage" }, "analysis" ] },
        { "text_contains": [ { "var": "message.text" }, botName, true ] }
      ]
    }),
    routing: {
      stage: 'reaction',
      slip: [
        { id: 'llm-bot', v: '1', nextTopic: 'internal.llmbot.v1' }
      ]
    },
    enrichments: {
      annotations:[
        {
          id: 'a1',
          kind: 'personality',
          value: botName,
        },
        {
          id: 'a2',
          kind: 'prompt',
          value: 'Create an appropriate answer to user {{username}}\'s latest message.',
        }
      ]
    }
  },
  {
    id: 'analysis-reaction-adventure',
    enabled: true,
    priority: 40,
    description: 'Route !adventure commands to story engine and LLM bot',
    logic: JSON.stringify({
      "and": [
        { "==": [ { "var": "routing.stage" }, "analysis" ] },
        { "re_test": [ { "var": "message.text" }, "^!adventure", "i" ] }
      ]
    }),
    routing: {
      stage: 'reaction',
      slip: [
        { id: 'story-engine', v: '1', nextTopic: 'internal.story.enrich.v1' },
        { id: 'llm-bot', v: '1', nextTopic: 'internal.llmbot.v1' }
      ]
    },
    enrichments: {
      annotations:[
        {
          id: 'a1',
          kind: 'personality',
          value: botName,
        },
        {
          id: 'a2',
          kind: 'prompt',
          value: 'The user is in adventure mode, please react accordingly',
        }
      ]
    }
  },
  {
    id: 'analysis-reaction-cnj',
    enabled: true,
    priority: 100,
    description: `Create a Chuck Norris Joke for the user`,
    logic: JSON.stringify({
      "and": [
        { "==": [ { "var": "routing.stage" }, "analysis" ] },
        { "re_test": [ { "var": "message.text" }, "^cnj", "i" ] }
      ]
    }),
    routing: {
      stage: 'reaction',
      slip: [
        { id: 'llm-bot', v: '1', nextTopic: 'internal.llmbot.v1' }
      ]
    },
    enrichments: {
      annotations:[
        {
          id: 'a1',
          kind: 'prompt',
          value: 'Generate one original Chuck Norris joke. Do not reuse classic structures like roundhouse kicks, counting to infinity, or glaring-atoms tropes. Avoid tech-centric humor unless it’s genuinely unexpected. Explore any domain—nature, mythology, sports, cooking, art, everyday life, or the absurd. Use a fresh comedic structure and keep it under 20 words with a surprising punchline.',
        }
      ]
    }
  },
];

export async function cmdSetup(opts: any, log: Logger) {
  const root = process.cwd();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const ask = (query: string): Promise<string> => new Promise((resolve) => rl.question(query, resolve));
  const askChoice = async (query: string, choices: string[]): Promise<string> => {
    while (true) {
      const answer = await ask(`${query} (${choices.join('/')}): `);
      const choice = answer.toLowerCase();
      if (choices.includes(choice)) return choice;
      console.log(`\nInvalid choice: ${answer}. Please choose from ${choices.join(', ')}.`);
    }
  };
  const askWithDefault = async (query: string, defaultValue: string): Promise<string> => {
    const answer = await ask(`${query} [${defaultValue}]: `);
    return answer || defaultValue;
  };

  try {
    log.info({ action: 'setup.start' }, 'Starting BitBrat Platform Setup');
    console.log('\n--- BitBrat Platform Setup ---\n');

    const markers = isAlreadyInitialized(root);
    if (markers.length > 0) {
      console.log('\x1b[33m%s\x1b[0m', 'WARNING: This platform appears to be already initialized locally.');
      console.log('Detected configuration files:', markers.join(', '));
      const confirm = await ask('\nAre you sure you want to continue and overwrite existing local settings? (y/N): ');
      if (confirm.toLowerCase() !== 'y') {
        console.log('Setup aborted.');
        log.info({ action: 'setup.aborted' }, 'User aborted setup due to existing configuration');
        return;
      }
    }

    // 1. Gathering basic info
    const projectId = opts.projectId || await askWithDefault('GCP Project ID', 'bitbrat-dev');
    const openaiKey = opts.openaiKey || await ask('OpenAI API Key (required): ');
    if (!openaiKey) throw new Error('OpenAI API Key is required');

    const botName = opts.botName || await askWithDefault('Bot Name', 'BitBrat');

    // 2. Personality Setup
    const personalities = [];
    console.log('\n--- Personality Setup ---');
    console.log(`Setting up default personality for ${botName}...`);
    const defaultInstructions = await askWithDefault(`Instructions for ${botName}`, `You are ${botName}, a helpful AI assistant.`);
    const defaultDesc = await askWithDefault(`Description for ${botName}`, `Default personality for ${botName}`);

    personalities.push({
      id: botName.toLowerCase(),
      name: botName,
      text : defaultInstructions,
      description: defaultDesc,
      status: 'active',
      version: 1
    });

    while (true) {
      const addMore = await ask('\nAdd another personality? (y/N): ');
      if (addMore.toLowerCase() !== 'y') break;

      const pName = await ask('Personality Name: ');
      if (!pName) continue;
      const pInstructions = await ask(`Instructions for ${pName}: `);
      const pDesc = await ask(`Description for ${pName}: `);

      personalities.push({
        id: pName.toLowerCase(),
        name: pName,
        text: pInstructions,
        description: pDesc,
        status: 'active',
        version: 1
      });
    }

    // 3. Connect to Firestore and check state
    console.log('\nChecking Firestore emulator...');
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
    if (!admin.apps.length) {
      admin.initializeApp({ projectId });
    }
    const db = admin.firestore();

    const collectionsToCheck = ['personalities', 'mcp_servers', 'configs/routingRules/rules'];
    let existingData = false;
    for (const coll of collectionsToCheck) {
      if (await hasData(db, coll)) {
        existingData = true;
        break;
      }
    }

    if (existingData) {
      console.log('\x1b[33m%s\x1b[0m', '\nWARNING: Existing data detected in Firestore emulator.');
      const choice = await askChoice('Choose action: [a]bort, [w]ipe and continue, [i]gnore and continue', ['a', 'w', 'i']);
      if (choice === 'a') {
        console.log('Setup aborted.');
        return;
      } else if (choice === 'w') {
        console.log('Wiping existing Firestore collections...');
        for (const coll of collectionsToCheck) {
          await wipeCollection(db, coll);
        }
      }
    }

    // 4. Persistence of local files
    log.info({ action: 'setup.persist' }, 'Writing local configuration files...');
    const localEnvDir = path.join(root, 'env', 'local');
    if (!fs.existsSync(localEnvDir)) fs.mkdirSync(localEnvDir, { recursive: true });

    const globalYamlPath = path.join(localEnvDir, 'global.yaml');
    let globalYamlContent = fs.existsSync(globalYamlPath) ? fs.readFileSync(globalYamlPath, 'utf8') : '';
    globalYamlContent = updateYaml(globalYamlContent, 'PROJECT_ID', projectId);
    globalYamlContent = updateYaml(globalYamlContent, 'BOT_NAME', botName);
    globalYamlContent = removeYamlKey(globalYamlContent, 'API_GATEWAY_HOST_PORT');
    fs.writeFileSync(globalYamlPath, globalYamlContent, 'utf8');

    const secureLocalPath = path.join(root, '.secure.local');
    let secureLocalContent = fs.existsSync(secureLocalPath) ? fs.readFileSync(secureLocalPath, 'utf8') : '';
    secureLocalContent = updateEnv(secureLocalContent, 'OPENAI_API_KEY', openaiKey);
    fs.writeFileSync(secureLocalPath, secureLocalContent, 'utf8');

    // 5. Populate Firestore
    log.info({ action: 'setup.populate' }, 'Populating Firestore with initial data...');

    // A. API Gateway Token
    const apiToken = uuidv4();
    const tokenHash = crypto.createHash('sha256').update(apiToken).digest('hex');
    await db.collection('gateways/api/tokens').doc(tokenHash).set({
      token_hash: tokenHash,
      uid: 'brat-admin',
      description: 'Initial admin token for chat',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const bitbratJsonPath = path.join(root, '.bitbrat.json');
    fs.writeFileSync(bitbratJsonPath, JSON.stringify({ apiToken, codeFirstRun: true }, null, 2), 'utf8');
    secureLocalContent = updateEnv(secureLocalContent, 'BITBRAT_API_TOKEN', apiToken);
    fs.writeFileSync(secureLocalPath, secureLocalContent, 'utf8');

    // B. Personalities
    for (const p of personalities) {
      const { id, ...data } = p;
      await db.collection('personalities').doc(id).set({
        ...data,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    // D. Routing Rules
    const routingRules = getInitialRoutingRules(botName);

    for (const rule of routingRules) {
      const { id, ...data } = rule;
      await db.collection('configs/routingRules/rules').doc(id).set({
        ...data,
        metadata: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          updatedBy: 'setup'
        }
      });
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
