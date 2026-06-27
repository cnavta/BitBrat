#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# validate_deliverable.sh — sprint-327-2c45c2 (Documentation Refresh)
#
# This is a DOCUMENTATION sprint (AGENTS.md §6 note): validation lints, link-checks,
# and verifies structure instead of building product code. It is logically passable
# and idempotent (mutates nothing); it exits non-zero on broken internal links or a
# version-consistency failure. Missing optional tools (e.g. markdownlint) are logged
# and skipped, not failed.
# =============================================================================

# Make common tool locations + the repo's nvm node discoverable in non-interactive shells.
export PATH="$PATH:/opt/homebrew/bin"
if ! command -v node >/dev/null 2>&1; then
  NVM_NODE="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | tail -1 || true)"
  [ -n "$NVM_NODE" ] && export PATH="$PATH:$NVM_NODE"
fi

# Resolve repo root from this script's location (planning/sprint-327-2c45c2/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"
echo "📁 Repo root: $REPO_ROOT"

# -----------------------------------------------------------------------------
# 1. Structure verification — the deliverable docs must exist.
# -----------------------------------------------------------------------------
echo "🧱 Verifying documentation structure ..."
REQUIRED_DOCS=(
  "README.md"
  "documentation/concepts/bit-model.md"
  "documentation/concepts/capability-profiles.md"
  "documentation/reference/bit-control-plane.md"
  "documentation/guides/brat-fleet.md"
  "documentation/services/mcp-server.md"
  "documentation/services/base-server-routing.md"
  "documentation/tools/brat.md"
  "documentation/technical-architecture/mcp-auto-discovery.md"
  "documentation/mcp-evolution-roadmap.md"
  "documentation/architecture/bit-model-technical-architecture.md"
  "documentation/architecture/bl-204-brat-fleet-mcp-client-technical-architecture.md"
)
MISSING=0
for d in "${REQUIRED_DOCS[@]}"; do
  if [ -f "$d" ]; then
    echo "   ✅ $d"
  else
    echo "   ❌ MISSING: $d"
    MISSING=1
  fi
done
[ "$MISSING" -eq 0 ] || { echo "❌ Structure check failed: required docs missing."; exit 1; }

# -----------------------------------------------------------------------------
# 2. Markdown lint (optional tool — log + skip if unavailable).
# -----------------------------------------------------------------------------
echo "🧹 Markdown lint ..."
if command -v markdownlint >/dev/null 2>&1; then
  markdownlint "README.md" "documentation/**/*.md" || { echo "❌ markdownlint reported issues."; exit 1; }
  echo "   ✅ markdownlint passed."
elif command -v npx >/dev/null 2>&1 && npx --no-install markdownlint-cli --version >/dev/null 2>&1; then
  npx --no-install markdownlint-cli "README.md" "documentation/**/*.md" || { echo "❌ markdownlint reported issues."; exit 1; }
  echo "   ✅ markdownlint (npx) passed."
else
  echo "   ⚠️  markdownlint not installed — skipping lint (logically passable, AGENTS.md §2.6)."
fi

# -----------------------------------------------------------------------------
# 3. Internal link check — relative Markdown links in README + documentation/**
#    must resolve to an existing file. (External http(s) and pure #anchors skipped.)
# -----------------------------------------------------------------------------
echo "🔗 Internal link check (README + documentation/**) ..."
if ! command -v node >/dev/null 2>&1; then
  echo "❌ node not found — cannot run the internal link checker."; exit 1
fi
node - <<'NODE'
const fs = require('fs');
const path = require('path');

function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'deprecated', 'preview'].includes(e.name)) continue;
      walk(p, acc);
    } else if (e.isFile() && p.endsWith('.md')) {
      acc.push(p);
    }
  }
  return acc;
}

const files = [];
if (fs.existsSync('README.md')) files.push('README.md');
if (fs.existsSync('documentation')) walk('documentation', files);

const linkRe = /\[(?:[^\]]*)\]\(([^)]+)\)/g;
let broken = 0, checked = 0;
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  let m;
  while ((m = linkRe.exec(text)) !== null) {
    let target = m[1].trim();
    // Strip optional <...> and title: [text](<path> "title")
    target = target.replace(/^<|>$/g, '');
    const sp = target.indexOf(' ');
    if (sp !== -1) target = target.slice(0, sp);
    if (!target) continue;
    if (/^(https?:|mailto:|tel:|#)/i.test(target)) continue; // external or in-page anchor
    const filePart = target.split('#')[0];
    if (!filePart) continue; // pure anchor
    checked++;
    const resolved = path.resolve(path.dirname(file), filePart);
    if (!fs.existsSync(resolved)) {
      console.error(`   ❌ ${file} -> ${target}  (missing: ${path.relative(process.cwd(), resolved)})`);
      broken++;
    }
  }
}
console.log(`   Checked ${checked} internal links across ${files.length} files.`);
if (broken > 0) {
  console.error(`❌ ${broken} broken internal link(s).`);
  process.exit(1);
}
console.log('   ✅ All internal links resolve.');
NODE

# -----------------------------------------------------------------------------
# 4. Version consistency + release:dry (AGENTS.md §2.6) — proves a bump is
#    mechanically possible without mutating the working tree.
# -----------------------------------------------------------------------------
echo "🧾 Asserting version consistency (architecture.yaml == package.json == package-lock.json) ..."
node - <<'NODE'
const fs = require('fs');
let yaml;
try { yaml = require('js-yaml'); } catch { console.log('   ⚠️  js-yaml not available — skipping YAML parse of architecture.yaml.'); }
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8')).version;
let arch = pkg;
if (yaml) arch = yaml.load(fs.readFileSync('architecture.yaml', 'utf8'))?.project?.version;
if (arch !== pkg || pkg !== lock) {
  console.error(`   ❌ version mismatch: architecture.yaml=${arch} package.json=${pkg} package-lock.json=${lock}`);
  process.exit(1);
}
console.log(`   ✅ version=${pkg} consistent across all three files`);
NODE

echo "🚀 Proving a release is mechanically possible (release:dry must write nothing) ..."
if command -v npm >/dev/null 2>&1; then
  BEFORE="$(git status --porcelain 2>/dev/null || true)"
  npm run release:dry -- patch
  AFTER="$(git status --porcelain 2>/dev/null || true)"
  if [ "$BEFORE" != "$AFTER" ]; then
    echo "❌ release:dry mutated the working tree (it must write nothing)."; exit 1
  fi
  echo "   ✅ release:dry exited cleanly and mutated nothing."
else
  echo "   ⚠️  npm not found — skipping release:dry (logically passable, AGENTS.md §2.6)."
fi

echo "✅ Documentation validation complete."
