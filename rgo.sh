#!/bin/bash
set -e


ENV=dev
PROJECT_ID="bitbrat-local"


npm install
npm run build
npm test
npm run brat -- doctor
npm run brat -- config validate
npm run brat -- docker up --env staging --target staging