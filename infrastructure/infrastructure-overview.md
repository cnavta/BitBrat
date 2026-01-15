# Infrastructure

## Overview
The BitBrat platform fully embraces containerization, IoC, and cloud native technologies. As such the basic deployable unit of the platform is a container. All deployable code is organized into Bounded Contexts and microservices, with each Bounded Context in a separate container, hosting one or more microservices. Bounded Contexts communicate with each other through asynchronous messaging patterns.

Common infrastructure such as databases, message brokers, and caching are provided by the Cloud platform being deployed to. BitBrat IaC is responsible for provisioning, configuring, and managing these common infrastructure components.

## Organization
All IaC and infrastructure configuration is located in the `infrastructure` directory. There are two main scripts in this directory:
- `deploy-local.sh` - Deploys the BitBrat platform to a local Docker environment
- `deploy-cloud.sh` - Deploys the BitBrat platform to a cloud environment

These two scripts serve as single points of entry for deploying the BitBrat platform. All IaC and infrastructure operations are executed from these scripts.

Each target cloud environment has its own subdirectory in the `infrastructure` directory. Each subdirectory contains the IaC and infrastructure configuration for that target cloud environment.

## Implementation
This project targets these platforms for deployment:
 - Docker Compose for local execution
 - Google Cloud for cloud execution

### Docker Compose
Local execution uses Docker Compose to run the BitBrat Platform. It uses a local NATS instace for messaging and a containerized Firebase Emulator for Firestore access.

All health check endpoints and HTTP paths exposed by services listed in the architecture.yaml should be exposed by default locally.

Important: All scripts and npm commands must be run from the repository root. Running from subdirectories is unsupported and guarded against in scripts. Docker Compose mounts the repository root into containers (as /workspace) and scripts will fail fast if executed outside the repo root.

Note: Service include files must reference env_file: .env.local (project-directory relative). Docker Compose resolves env_file paths from the project directory, not from the include file location.

### Google Cloud Platform
Cloud execution uses Cloud Run for services, PubSub for messaging, and Firestore for persistence. Cloud Build is used for the actual IaC definition and execution.

Multiple cloud environments are supported by via different GCP projects. Production is the bitbrat-prod project. Each environment must have a custom VPC that all code is deployed in. A Global External Application Load Balancer provides external access to select services. And internal regional load balancer and and internal Cloud DNS zone provide internal routing to services.

To map external paths to internal services, an advanced URL Map is created based off of the load balancer and service definitions in the architecture.yaml file

## Configuration
All configuration is passed as environment variables. 

### Non-secure configuration
Non-secure configuration per environment is stored in the ./env directory. Within it is a directory per environment, with individual YAML files per deployable unit. There is also a global.yaml that defines environment variables that should be passed to all deployments.

### Secure configuration
All local secure configuration must be stored in the ./.secure.local file. This file must NEVER be committed.

Example ./.secure.local (absolute path, no quotes, no export):
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/your-sa-key.json

Notes:
- Use an absolute path (no ~).
- Do not wrap the path in quotes and do not prefix with export
- Avoid spaces in the path (Docker bind mounts may fail)

During npm run local:
- .secure.local is merged into .env.local
- Docker Compose mounts the host file at /var/secrets/google-app-creds.json
- Containers set GOOGLE_APPLICATION_CREDENTIALS=/var/secrets/google-app-creds.json

All cloud secure configuration must be stored in GCP Secrets Manager and mapped to deployed artifacts as environment variables.