#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# validate_deliverable.sh — sprint-323-49faff (Evaluator & Agent-Framework Readiness)
#
# Validates this sprint's deliverables. Logically passable per AGENTS.md §2.6:
# it parses architecture.yaml, validates it against the newly shipped JSON schema
# via `brat config validate`, link-checks the new/changed docs, and asserts that
# no scratch artifacts remain tracked. Run from the repository root.
# -----------------------------------------------------------------------------

# Resolve repo root (two levels up from this script: planning/sprint-323-49faff/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

# Make common local node/npm locations discoverable.
export PATH="$PATH:/opt/homebrew/bin"

echo "🔧 Installing dependencies..."
# npm ci   # assume the environment already has node_modules for this local tooling task

echo "🧱 Building project..."
npm run build

echo "🧪 Running config-schema unit tests..."
npx jest tools/brat/src/config

echo "🔎 Validating architecture.yaml (Zod + shipped JSON schema)..."
node dist/tools/brat/src/cli/index.js config validate

echo "🧾 Asserting version reconciliation (package.json == architecture.yaml == 0.7.0)..."
node -e '
const fs = require("fs");
const yaml = require("js-yaml");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const arch = yaml.load(fs.readFileSync("architecture.yaml", "utf8")).project.version;
if (pkg !== arch) { console.error(`Version mismatch: package.json=${pkg} architecture.yaml=${arch}`); process.exit(1); }
if (pkg !== "0.7.0") { console.error(`Expected version 0.7.0, found ${pkg}`); process.exit(1); }
console.log(`   ✅ version=${pkg} consistent`);
'

echo "🧹 Asserting scratch artifacts are NOT tracked..."
for f in dummy-creds.json route.json test.json validation_output.txt; do
  if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    echo "❌ Scratch artifact is still tracked: $f" >&2
    exit 1
  fi
  if ! git check-ignore "$f" >/dev/null 2>&1; then
    echo "❌ Scratch artifact is not git-ignored: $f" >&2
    exit 1
  fi
done
echo "   ✅ scratch artifacts untracked and ignored"

echo "🔗 Link-checking new/changed docs (relative links resolve to real files)..."
node -e '
const fs = require("fs");
const path = require("path");
const docs = [
  "README.md",
  "CHANGELOG.md",
  "SECURITY.md",
  "assets/architecture-overview.md",
  "documentation/getting-started/quickstart.md",
  "documentation/getting-started/evaluating-bitbrat.md",
];
let failed = 0;
const linkRe = /\[[^\]]*\]\(([^)]+)\)/g;
for (const doc of docs) {
  if (!fs.existsSync(doc)) { console.error("Missing doc: " + doc); failed++; continue; }
  const txt = fs.readFileSync(doc, "utf8");
  let m;
  while ((m = linkRe.exec(txt)) !== null) {
    let target = m[1].trim();
    if (/^(https?:|mailto:|#)/.test(target)) continue;   // external or in-page anchor
    target = target.split("#")[0];                        // strip section anchor
    if (!target) continue;
    const resolved = path.join(path.dirname(doc), target);
    if (!fs.existsSync(resolved)) {
      console.error(`Broken link in ${doc}: ${m[1]} -> ${resolved}`);
      failed++;
    }
  }
}
if (failed > 0) { console.error(`❌ ${failed} broken link(s)`); process.exit(1); }
console.log("   ✅ all relative doc links resolve");
'

echo "🔐 Dependency audit summary (informational; non-breaking remediation applied this sprint)..."
npm audit --json 2>/dev/null | node -e '
let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
  try { const v=JSON.parse(s).metadata.vulnerabilities;
    console.log(`   audit: total=${v.total} critical=${v.critical} high=${v.high} moderate=${v.moderate} low=${v.low}`);
  } catch(e){ console.log("   audit summary unavailable"); }
});' || true

echo "✅ Validation complete."
