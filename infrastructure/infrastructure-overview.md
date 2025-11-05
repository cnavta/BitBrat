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
