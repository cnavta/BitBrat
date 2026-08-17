#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/../.." && pwd)
SPRINT_DIR=$(cd "$(dirname "$0")" && pwd)

echo "Validating planning deliverables for sprint-132-a13b2f..."

required_files=(
  "${SPRINT_DIR}/sprint-manifest.yaml"
  "${SPRINT_DIR}/implementation-plan.md"
  "${SPRINT_DIR}/backlog.yaml"
)

for f in "${required_files[@]}"; do
  if [ ! -f "$f" ]; then
    echo "Missing required file: $f" >&2
    exit 1
  else
    echo "Found: $f"
  fi
done

echo "Parsing YAML files to ensure validity..."
node -e '
const fs = require("fs");
const yaml = require("js-yaml");
function check(p){
  const txt = fs.readFileSync(p, "utf8");
  const obj = yaml.load(txt);
  if(!obj) throw new Error("YAML parsed to null for "+p);
}
const files = process.argv.slice(2);
files.forEach(check);
console.log("YAML parse OK");
' "${SPRINT_DIR}/sprint-manifest.yaml" "${SPRINT_DIR}/backlog.yaml"

echo "All planning validations passed."
