#!/usr/bin/env node
/**
 * Firestore Upsert CLI (uses Google Default Application Credentials via firebase-admin)
 *
 * Usage:
 *   node dist/tools/firestore-upsert.js <collectionOrDocPath> <json|@/path/file.json|-> [--id <docId>] [--merge]
 *
 * Examples:
 *   # Upsert explicit doc path
 *   npm run firestore:upsert -- configs/routingRules/rules/chat-command "{\"enabled\":true}"
 *
 *   # Upsert into a collection using id from JSON
 *   npm run firestore:upsert -- configs/routingRules/rules "{\"id\":\"chat-command\",\"enabled\":true}"
 *
 *   # Upsert using JSON file
 *   npm run firestore:upsert -- configs/routingRules/rules @./examples/chat-command.json
 *
 *   # Upsert using STDIN (use '-' as the JSON arg)
 *   cat ./examples/chat-command.json | npm run firestore:upsert -- configs/routingRules/rules -
 *   echo '{"id":"chat-command","enabled":true}' | npm run firestore:upsert -- configs/routingRules/rules -
 *
 *   # Upsert using STDIN without '-' (when JSON arg omitted)
 *   cat ./examples/chat-command.json | npm run firestore:upsert -- configs/routingRules/rules
 */
import { getFirestore } from '../src/common/firebase';
import * as fs from 'fs';
import * as path from 'path';

type AnyRecord = Record<string, any>;

function printUsageAndExit(code = 1) {
  console.error(
    'Usage: firestore-upsert <collectionOrDocPath> <json|@/path/file.json|-> [--id <docId>] [--merge]\n' +
      'Example: npm run firestore:upsert -- configs/routingRules/rules/chat-command "{\"enabled\":true}"'
  );
  process.exit(code);
}

function parseArgs(argv: string[]) {
  const args: string[] = [];
  const opts: AnyRecord = { merge: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--id') {
      opts.id = argv[++i];
    } else if (a === '--merge') {
      opts.merge = true;
    } else if (a === '--no-merge') {
      opts.merge = false;
    } else if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (k === 'merge') opts.merge = v !== 'false';
      else opts[k] = v ?? true;
    } else {
      args.push(a);
    }
  }
  if (args.length < 1) printUsageAndExit(2);
  return { pathArg: args[0], jsonArg: args[1], opts };
}

async function readAllStdin(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    try {
      if ((process.stdin as any).setEncoding) process.stdin.setEncoding('utf8');
    } catch {}
    process.stdin.on('data', (chunk) => chunks.push(Buffer.from(String(chunk))));
    process.stdin.on('error', (err) => reject(err));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    // If stdin is already ended (no piped input) and isTTY, resolve empty
    if (process.stdin.isTTY) {
      // give a tick for consistency
      setImmediate(() => resolve(''));
    }
  });
}

async function loadJson(jsonArg?: string): Promise<AnyRecord> {
  let src: string | undefined;
  if (jsonArg === '-' || typeof jsonArg === 'undefined') {
    // Read from stdin
    src = await readAllStdin();
    if (!src || !src.trim()) {
      console.error('No JSON provided. Provide a JSON argument, a file (@file.json), or pipe JSON via STDIN.');
      printUsageAndExit(2);
    }
  } else {
    src = jsonArg;
    if (jsonArg.startsWith('@')) {
      const fp = path.resolve(process.cwd(), jsonArg.slice(1));
      src = fs.readFileSync(fp, 'utf8');
    } else if (fs.existsSync(jsonArg) && fs.statSync(jsonArg).isFile()) {
      const fp = path.resolve(process.cwd(), jsonArg);
      src = fs.readFileSync(fp, 'utf8');
    }
  }
  try {
    return JSON.parse(src);
  } catch (e: any) {
    console.error('Failed to parse JSON document:', e?.message || String(e));
    process.exit(3);
  }
}

function isEven(n: number) {
  return (n & 1) === 0;
}

async function main() {
  const { pathArg, jsonArg, opts } = parseArgs(process.argv.slice(2));
  const data = await loadJson(jsonArg);

  if (!pathArg || typeof pathArg !== 'string') printUsageAndExit(2);
  const segments = pathArg.split('/').filter(Boolean);
  if (segments.length === 0) printUsageAndExit(2);

  const db = getFirestore();

  if (isEven(segments.length)) {
    // Document path provided
    const docRef = db.doc(pathArg);
    await docRef.set(data, { merge: Boolean(opts.merge) });
    const wr = await docRef.get();
    console.log(JSON.stringify({ status: 'ok', path: docRef.path, exists: wr.exists }, null, 2));
    return;
  }

  // Collection path provided → require an id (either via --id or data.id)
  const colRef = db.collection(pathArg);
  const id = (opts.id as string) || (typeof data.id === 'string' ? data.id : undefined);
  if (!id) {
    console.error('Error: collection path provided but no document id found. Supply --id or include an "id" field in JSON.');
    process.exit(4);
  }
  const { id: _ignored, ...docData } = data;
  const docRef = colRef.doc(id);
  await docRef.set(docData, { merge: Boolean(opts.merge) });
  const wr = await docRef.get();
  console.log(JSON.stringify({ status: 'ok', path: docRef.path, exists: wr.exists }, null, 2));
}

main().catch((e) => {
  console.error('Upsert failed:', e?.message || String(e));
  process.exit(1);
});
