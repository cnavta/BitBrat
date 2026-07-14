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
git clone https://github.com/cnavta/BitBrat.git
cd BitBrat
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
- **OpenAI API Key**: Required for the default OpenAI provider. **You can leave this blank** if you plan to run fully offline with a local model (see below).
- **Bot Name**: The display name for your BitBrat bot.

### Offline / Local-LLM mode (no OpenAI key)

To try the platform without any paid API, run a local [Ollama](https://ollama.com) server and select it
via environment variables (read by `llm-bot` and `query-analyzer`):

```bash
ollama pull llama3 && ollama serve     # serves http://localhost:11434

export LLM_PROVIDER=ollama
export LLM_MODEL=llama3
export LLM_BASE_URL=http://localhost:11434   # http://host.docker.internal:11434 from Docker
```

No `LLM_API_KEY` is needed for Ollama. See the README [Offline / Local-LLM Quickstart](../../README.md#offline--local-llm-quickstart-no-openai-key) for the full hello-world-agent walkthrough.

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

## 5.5 (Recommended) Explore with AI Assistance

Before starting the full Docker stack, explore BitBrat with AI-powered assistance:

```bash
npm run brat -- code
```

If you have Claude Code, Aider, or another supported agent installed, this will:
- Automatically configure the agent with BitBrat project context
- Provide a guided introduction to the platform on first run
- Help you understand the architecture before diving into setup

**First-time users**: The agent will explain the platform concepts interactively.

**Developers**: Use it to explore code, understand flows, or get help implementing features.

See [Coding with brat code](../guides/coding-with-brat-code.md) for installation and usage.

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

### Understanding the Platform

BitBrat offers **two execution paths** in the Act stage:
- **Reflex (Deterministic)**: Pattern-match and execute tools in <150ms, no LLM overhead — perfect for repeated behaviors like chat commands
- **LLM-Based**: Full AI reasoning with tool selection, 2-10 seconds — for novel situations and complex responses

Both paths share the same infrastructure and tool ecosystem. See [Platform Flow Overview](../concepts/platform-flow.md) for details.

### Learn More

- **[Coding with brat code](../guides/coding-with-brat-code.md)**: Explore BitBrat with AI-powered coding assistance.
- [Platform Flow Overview](../concepts/platform-flow.md): Understand the agent loop and dual execution paths.
- [Managing Seed Data](../guides/seed-data.md): Learn how to load initial rules and state.
- [Brat Chat Introduction](../tools/brat.md#brat-chat): Start interacting with your bot locally.
- [Creating your first command](../tutorials/lurk-command.md): A step-by-step tutorial.
- [Choosing Platform vs Domain](../guides/choosing-platform-vs-domain.md): Decision framework for extending the platform.
