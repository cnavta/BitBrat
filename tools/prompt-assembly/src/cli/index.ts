#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { assemble } from "../../../..//src/common/prompt-assembly/assemble";
import { openaiAdapter } from "../../../..//src/common/prompt-assembly/adapters/openai";
import { googleAdapter } from "../../../..//src/common/prompt-assembly/adapters/google";
import type { AssemblerConfig, PromptSpec } from "../../../..//src/common/prompt-assembly/types";

type Provider = "none" | "openai" | "google";

interface Args {
  spec?: string;
  stdin?: boolean;
  provider: Provider;
  showEmptySections?: boolean;
  headingLevel?: 1 | 2 | 3;
  renderMode?: "summary" | "transcript" | "both";
  out?: string;
  maxTotalChars?: number;
  capSystemPrompt?: number;
  capIdentity?: number;
  capRequestingUser?: number;
  capConstraints?: number;
  capTask?: number;
  capInput?: number;
  help?: boolean;
  version?: boolean;
}

function printHelp() {
  const help = `
prompt-assembly – Thin CLI for assembling LLM prompts

Usage:
  prompt-assembly --spec spec.json [--provider openai|google|none] [--out out.txt]
  cat spec.json | prompt-assembly --stdin --provider openai

Options:
  --spec <file>             Path to JSON file containing PromptSpec
  --stdin                   Read PromptSpec JSON from stdin
  --provider <p>            Provider mapping: openai | google | none (default: none)
  --render-mode <m>         Conversation state rendering: summary | transcript | both (default: summary)
  --show-empty-sections     Render notes for empty optional sections (default: true)
  --heading-level <n>       Heading level: 1|2|3 (default: 2)
  --max-total-chars <n>     Hard cap on total characters (optional)
  --cap-systemPrompt <n>    Per-section cap for System Prompt (optional)
  --cap-identity <n>        Per-section cap for Identity (optional)
  --cap-requestingUser <n>  Per-section cap for Requesting User (optional)
  --cap-constraints <n>     Per-section cap for Constraints (optional)
  --cap-task <n>            Per-section cap for Task (optional)
  --cap-input <n>           Per-section cap for Input (optional)
  --out <file>              Write output to file instead of stdout
  --help                    Show this help
  --version                 Show version
`;
  console.log(help.trim());
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { provider: "none" } as Args;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--spec":
        args.spec = next();
        break;
      case "--stdin":
        args.stdin = true;
        break;
      case "--provider":
        args.provider = (next() as Provider) ?? "none";
        break;
      case "--render-mode":
        args.renderMode = next() as any;
        break;
      case "--show-empty-sections":
        args.showEmptySections = true;
        break;
      case "--heading-level":
        args.headingLevel = Number(next()) as 1 | 2 | 3;
        break;
      case "--out":
        args.out = next();
        break;
      case "--max-total-chars":
        args.maxTotalChars = Number(next());
        break;
      case "--cap-systemPrompt":
        args.capSystemPrompt = Number(next());
        break;
      case "--cap-identity":
        args.capIdentity = Number(next());
        break;
      case "--cap-requestingUser":
        args.capRequestingUser = Number(next());
        break;
      case "--cap-constraints":
        args.capConstraints = Number(next());
        break;
      case "--cap-task":
        args.capTask = Number(next());
        break;
      case "--cap-input":
        args.capInput = Number(next());
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--version":
      case "-v":
        args.version = true;
        break;
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

function readSpecFromFile(file: string): any {
  const p = path.resolve(process.cwd(), file);
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw);
}

async function main() {
  try {
    const args = parseArgs(process.argv);
    if (args.help) {
      printHelp();
      process.exit(0);
    }
    if (args.version) {
      // Lazy read version from package.json
      const pkgPath = path.resolve(__dirname, "../../../../package.json");
      const raw = fs.readFileSync(pkgPath, "utf8");
      const pkg = JSON.parse(raw);
      console.log(pkg.version || "0.0.0");
      process.exit(0);
    }

    let specObj: PromptSpec | undefined;
    if (args.stdin) {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");
      specObj = JSON.parse(raw);
    } else if (args.spec) {
      specObj = readSpecFromFile(args.spec) as PromptSpec;
    } else {
      console.error("Error: Provide --spec <file> or --stdin");
      printHelp();
      process.exit(2);
    }

    // Optional override of conversationState.renderMode from CLI
    if (args.renderMode) {
      const rm = args.renderMode;
      if (rm !== "summary" && rm !== "transcript" && rm !== "both") {
        console.error(`Error: Invalid --render-mode: ${rm}`);
        process.exit(2);
      }
      specObj = {
        ...specObj,
        conversationState: {
          ...(specObj?.conversationState ?? {}),
          renderMode: rm,
        },
      } as PromptSpec;
    }

    const cfg: AssemblerConfig = {
      showEmptySections: args.showEmptySections ?? true,
      headingLevel: (args.headingLevel as 1 | 2 | 3) ?? 2,
      maxTotalChars: args.maxTotalChars,
      sectionCaps: {
        systemPrompt: args.capSystemPrompt,
        identity: args.capIdentity,
        requestingUser: args.capRequestingUser,
        constraints: args.capConstraints,
        task: args.capTask,
        input: args.capInput,
      },
    };

    const assembled = assemble(specObj!, cfg);

    let output: string;
    switch (args.provider) {
      case "openai": {
        const payload = openaiAdapter(assembled);
        output = JSON.stringify(payload, null, 2);
        break;
      }
      case "google": {
        const payload = googleAdapter(assembled);
        output = JSON.stringify(payload, null, 2);
        break;
      }
      case "none":
      default:
        output = assembled.text;
        break;
    }

    if (args.out) {
      fs.writeFileSync(path.resolve(process.cwd(), args.out), output, "utf8");
    } else {
      process.stdout.write(output + "\n");
    }
  } catch (err: any) {
    console.error("prompt-assembly error:", err?.message || String(err));
    process.exit(1);
  }
}

void main();
