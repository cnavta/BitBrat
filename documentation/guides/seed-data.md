# Guide: Managing Seed Data

To test the platform locally or in a fresh environment, you often need to load initial configuration, rules, and state into the database (Firestore). This process is referred to as "seeding".

## 1. Initial Seeding via `brat setup`

For a new local installation, the **`brat setup`** command is the primary way to seed the platform. It automatically populates Firestore with:

- **Admin API Tokens**: Required for CLI tools like `brat chat`.
- **Default Personalities**: The bot identities you configure during setup.
- **Bootstraps Rules**: A set of base rules that enable core platform flows (Analysis -> Reaction).

If you need to reset these to a clean state, you can run `npm run brat -- setup` again and choose the **wipe** option when prompted.

## 2. The Firestore Upsert Tool

For adding specific rules (like custom commands) or updating existing data without a full reset, use the specialized Firestore upsert tool.

```bash
npm run firestore:upsert -- <path> <data> [--id <id>] [--merge]
```

- `<path>`: The Firestore collection or document path (e.g., `configs/routingRules/rules`).
- `<data>`: The JSON data to upsert. Can be a literal JSON string, a file path prefixed with `@` (e.g., `@./file.json`), or `-` to read from STDIN.
- `--id`: Optional. The document ID. If omitted, the tool looks for an `id` field in the JSON or uses the last part of the path if it points to a document.
- `--merge`: Enabled by default. Merges the new data with existing document fields. Use `--no-merge` to overwrite.

## 3. Loading Reference Rules

The repository contains several reference rules in `documentation/reference/setup/` that you can use to seed your platform.

### Example: Loading the !lurk command

The `!lurk` command is a classic example of an Event Router rule. To load it:

```bash
npm run firestore:upsert -- configs/routingRules/rules @documentation/reference/setup/lurk_command_rule.json
```

### Example: Loading multiple rules

You can load all provided reference rules using a simple loop in your terminal:

```bash
for rule in documentation/reference/setup/*.json; do
  npm run firestore:upsert -- configs/routingRules/rules "@$rule"
done
```

## 3. Verifying Seeded Data

After running the upsert commands, you can verify that the rules are loaded by:

1.  **Checking the Firestore Emulator UI**: If running locally, visit `http://localhost:4000/firestore` (default port).
2.  **Using `brat chat`**: Send a message like `!lurk` in the chat to see if the platform reacts as expected.
3.  **Brat Doctor**: Run `npm run brat -- doctor` to ensure the core configurations are correctly detected.

## 4. Custom Seed Data

You can create your own seed data by following the JSON format of the reference rules. 

- **Rules**: Should be placed in `configs/routingRules/rules`.
- **Global Config**: Should be placed in `configs/platform/globals/default`.

For more information on the Rule format, see the [Event Router & Rules](../concepts/event-router-rules.md) concept guide.
