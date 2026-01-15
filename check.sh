# 1) Sanity checks
npm run build
npm run brat -- doctor

# 2) Set your project and (optionally) remote state bucket
# export GOOGLE_APPLICATION_CREDENTIALS=/path/to/your/local-terraform.json
export PROJECT_ID="your-project-id"
export CI=false
# Optional remote state:
# export BITBRAT_TF_BACKEND_BUCKET=bitbrat-tfstate-dev


# 3) Safe preview
npm run brat -- infra plan network --env=dev --project-id "$PROJECT_ID"
npm run brat -- infra plan lb --env=dev --project-id "$PROJECT_ID"

# 4) Apply (must be local; not in CI; no --dry-run)
npm run brat -- infra apply network --env=dev --project-id "$PROJECT_ID"
npm run brat -- infra apply lb --env=dev --project-id "$PROJECT_ID"

# 5) Inspect outputs
cat infrastructure/cdktf/out/network/outputs.json
