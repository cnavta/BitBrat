# Guide: Managing Seed Data

To test the platform locally or in a fresh environment, you often need to load initial configuration, rules, and state into the database (PostgreSQL or Firestore for legacy deployments). This process is referred to as "seeding".

## 1. Initial Seeding via `brat setup`

For a new local installation, the **`brat setup`** command is the primary way to seed the platform.

### PostgreSQL Seeding (Default)

When using PostgreSQL (default persistence backend), `brat setup` automatically:

- **Creates Schema**: Runs migrations from `infrastructure/postgres/migrations/` to set up tables
- **Admin API Tokens**: Inserts required tokens for CLI tools like `brat chat`
- **Default Personalities**: Inserts bot identities you configure during setup
- **Bootstrap Rules**: Inserts base rules that enable core platform flows (Analysis → Reaction)

**Reset/Wipe:** To reset to a clean state with PostgreSQL, you can:
1. Drop and recreate the database
2. Re-run migrations: `npm run brat -- setup`
3. Choose the **wipe** option when prompted

See [PostgreSQL Setup Guide](./postgres-setup.md) for database management details.

### Firestore Seeding (Legacy)

For legacy Firestore deployments, `brat setup` populates the Firestore emulator with:

- **Admin API Tokens**: Required for CLI tools
- **Default Personalities**: Bot identities
- **Bootstrap Rules**: Base Event Router rules

**Reset/Wipe:** Run `npm run brat -- setup` and choose the **wipe** option when prompted.

## 2. Adding Custom Data

### PostgreSQL (Default)

For PostgreSQL deployments, you can add custom data using:

1. **SQL Scripts**: Direct SQL inserts/updates
   ```bash
   psql $DATABASE_URL -c "INSERT INTO routing_rules (id, priority, enabled, logic, routing) VALUES (...)"
   ```

2. **Migrations**: Create a new migration file in `infrastructure/postgres/migrations/`
   ```sql
   -- File: infrastructure/postgres/migrations/004_custom_rules.sql
   INSERT INTO routing_rules (id, priority, enabled, description, logic, routing)
   VALUES ('lurk-command', 100, true, 'Handle !lurk command', '{"and": [...]}', '{"slip": [...]}');
   ```

3. **Application Code**: Use the DocumentStore API
   ```typescript
   await documentStore.set('configs/routingRules/rules', 'lurk-command', ruleData);
   ```

See [PostgreSQL Setup Guide](./postgres-setup.md) for detailed database operations.

### Firestore (Legacy)

For legacy Firestore deployments, use the specialized Firestore upsert tool:

```bash
npm run firestore:upsert -- <path> <data> [--id <id>] [--merge]
```

- `<path>`: The Firestore collection or document path (e.g., `configs/routingRules/rules`).
- `<data>`: The JSON data to upsert. Can be a literal JSON string, a file path prefixed with `@` (e.g., `@./file.json`), or `-` to read from STDIN.
- `--id`: Optional. The document ID. If omitted, the tool looks for an `id` field in the JSON or uses the last part of the path if it points to a document.
- `--merge`: Enabled by default. Merges the new data with existing document fields. Use `--no-merge` to overwrite.

## 3. Loading Reference Rules

The repository contains several reference rules in `documentation/reference/setup/` that you can use to seed your platform.

### PostgreSQL: Loading Reference Rules

```bash
# Load a single rule using SQL
psql $DATABASE_URL < documentation/reference/setup/lurk_command_rule.sql

# Or use the DocumentStore API via application code
# (Recommended for production)
```

### Firestore: Loading Reference Rules (Legacy)

```bash
# Load the !lurk command
npm run firestore:upsert -- configs/routingRules/rules @documentation/reference/setup/lurk_command_rule.json

# Load all reference rules
for rule in documentation/reference/setup/*.json; do
  npm run firestore:upsert -- configs/routingRules/rules "@$rule"
done
```

## 4. Verifying Seeded Data

After seeding, verify that the data is loaded correctly:

### PostgreSQL

```bash
# Check routing rules
psql $DATABASE_URL -c "SELECT id, priority, enabled, description FROM routing_rules ORDER BY priority;"

# Check personalities
psql $DATABASE_URL -c "SELECT id, name, active FROM personalities;"

# Check admin tokens
psql $DATABASE_URL -c "SELECT id, name, scopes FROM auth_tokens WHERE active = true;"
```

### Firestore (Legacy)

1. **Firestore Emulator UI**: Visit `http://localhost:4000/firestore` (default port)
2. **Browse Collections**: Navigate to `configs/routingRules/rules`

### Platform-Agnostic Verification

- **Using `brat chat`**: Send a message like `!lurk` to test if rules are working
- **Brat Doctor**: Run `npm run brat -- doctor` to verify core configurations

## 5. Custom Seed Data

You can create your own seed data by following the reference formats.

### Data Structure

- **Rules**: Collection `configs/routingRules/rules`
- **Personalities**: Collection `personalities`
- **Global Config**: Collection `configs/platform/globals`
- **Auth Tokens**: Collection `auth_tokens`

### Rule Format

For detailed rule format, see [Event Router & Rules](../concepts/event-router-rules.md).

**Example Rule Structure:**
```json
{
  "id": "my-custom-rule",
  "priority": 100,
  "enabled": true,
  "description": "My custom command",
  "logic": {
    "and": [
      { "===": [{ "var": "message.text" }, "!mycommand"] }
    ]
  },
  "routing": {
    "slip": [
      { "id": "reflex", "nextTopic": "internal.reflex.v1" }
    ]
  }
}
```

See [PostgreSQL Setup Guide](./postgres-setup.md) for schema details and migration management.
