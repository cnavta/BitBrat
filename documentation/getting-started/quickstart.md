# Quickstart: Local Platform Setup

This guide will help you get the BitBrat Platform running on your local machine for development and testing.

## 1. Prerequisites

Before you begin, ensure you have the following tools installed:

- **Node.js**: Version 24.x or higher.
- **Docker**: Desktop or Engine with Docker Compose support.
- **Google Cloud SDK (gcloud)**: Required for interaction with GCP services (even when running locally, some configs depend on GCP project structure).
- **Git**: To clone and manage the repository.

## 2. Clone the Repository

```bash
git clone https://github.com/BitBrat/BitBratPlatform.git
cd BitBratPlatform
```

## 3. Install Dependencies

Install the project dependencies using `npm`:

```bash
npm install
```

## 4. Platform Initialization

The `brat` CLI tool provides a `setup` command that guides you through the initial configuration.

```bash
npm run brat -- setup
```

During this process, you will be prompted for:
- **GCP Project ID**: Your Google Cloud project identifier.
- **OpenAI API Key**: Required for LLM-powered features.
- **Bot Name**: The display name for your BitBrat bot.

### What Setup Does
The setup command performs several critical initialization steps:
1.  **Configuration Files**: Creates `.bitbrat.json` (admin credentials), `.secure.local` (secrets), and `env/local/global.yaml` (environment variables).
2.  **Admin Token**: Generates a unique API token for local administration and saves it to `.bitbrat.json`.
3.  **Initial Seeding**: Automatically populates the local Firestore emulator with:
    - **Personalities**: Sets up the default bot personality you defined.
    - **Core Rules**: Bootstraps the [Event Router](../concepts/event-router-rules.md) with base rules for analysis and bot mentions.
    - **Security**: Sets up initial authentication tokens in Firestore.

## 5. Health Check

Use the `doctor` command to verify that your environment is correctly configured and all prerequisites are met.

```bash
npm run brat -- doctor
```

Look for all "PASS" results. If any check fails, the tool will provide guidance on how to fix the issue.

## 6. Running the Platform

Once setup is complete and `doctor` reports no issues, you can start the platform using Docker Compose:

```bash
npm run local
```

This will pull the necessary images and start the core microservices. You can view the logs using:

```bash
npm run local:logs
```

## 7. Next Steps

- [Managing Seed Data](../guides/seed-data.md): Learn how to load initial rules and state.
- [Brat Chat Introduction](../tools/brat.md#brat-chat): Start interacting with your bot locally.
- [Creating your first command](../tutorials/lurk-command.md): A step-by-step tutorial.
