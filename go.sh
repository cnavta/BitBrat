#!/bin/bash
set -e


ENV=dev
PROJECT_ID="bitbrat-local"


npm install
npm run build
npm test
npm run brat -- doctor
npm run brat -- config validate
npm run brat -- apis enable --env $ENV --project-id $PROJECT_ID
npm run brat -- infra plan network --env $ENV --project-id $PROJECT_ID --dry-run    # typically no-op if network is shared or already applied
npm run brat -- infra apply network --env $ENV --project-id $PROJECT_ID
npm run brat -- infra plan connectors --env $ENV --project-id $PROJECT_ID --dry-run
npm run brat -- infra apply connectors --env $ENV --project-id $PROJECT_ID
npm run brat -- infra plan lb --env $ENV --project-id $PROJECT_ID --dry-run
npm run brat -- infra apply lb --env $ENV --project-id $PROJECT_ID                 # URL map import is skipped automatically in prod
npm run brat -- lb urlmap render --env $ENV --project-id $PROJECT_ID
npm run brat -- lb urlmap import --env $ENV --project-id $PROJECT_ID --dry-run     # review drift
npm run brat -- lb urlmap import --env $ENV --project-id $PROJECT_ID               # apply if acceptable
npm run brat -- deploy services --env $ENV --project-id $PROJECT_ID --concurrency 2
