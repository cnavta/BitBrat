Firestore Upsert CLI (GDAC)

Purpose
- Upsert a JSON document into Firestore using Google Default Application Credentials (ADC/GDAC) via firebase-admin. Uses merge semantics by default.

Build
- The CLI is compiled with the main TypeScript build: npm run build

Usage
- npm run firestore:upsert -- <collectionOrDocPath> <json|@/path/file.json|-> [--id <docId>] [--merge|--no-merge]

Examples
- Upsert explicit document path:
  - npm run firestore:upsert -- configs/routingRules/rules/chat-command "{\"enabled\":true}"

- Upsert into a collection using id inside JSON:
  - npm run firestore:upsert -- configs/routingRules/rules "{\"id\":\"chat-command\",\"enabled\":true}"

- Upsert using a JSON file:
  - npm run firestore:upsert -- configs/routingRules/rules @./examples/chat-command.json

- Upsert using STDIN (use '-' as JSON arg):
  - cat ./examples/chat-command.json | npm run firestore:upsert -- configs/routingRules/rules -
  - echo '{"id":"chat-command","enabled":true}' | npm run firestore:upsert -- configs/routingRules/rules -

- Upsert using STDIN without '-' (omit JSON arg):
  - cat ./examples/chat-command.json | npm run firestore:upsert -- configs/routingRules/rules

Notes
- When a collection path is provided, an id is required either via --id or an "id" field in the JSON payload.
- Merge is enabled by default. Use --no-merge to replace the document.
- Authentication is taken from GDAC (e.g., GOOGLE_APPLICATION_CREDENTIALS, gcloud auth, or Workload Identity).
