# Runbook: Query Analyzer

This runbook covers the operational aspects of the `query-analyzer` service, including setup, deployment, and troubleshooting.

## Local Development Setup

The `query-analyzer` defaults to using a local **Ollama** instance. It can also be configured to use **OpenAI**.

### Ollama Setup (Default)

The service expects an Ollama instance with the `llama3` model.

#### 1. Start the stack
```bash
npm run local -- --service-name query-analyzer
```
This will start the Node.js app and the Ollama sidecar container.

#### 2. Pull the model (First time only)
The Ollama container starts empty. You must manually pull the Llama model:
```bash
docker exec ollama ollama pull llama3
```
Verification:
```bash
docker exec ollama ollama list
```

### OpenAI Setup

To use OpenAI instead of local Ollama:

1. Set `LLM_PROVIDER=openai`.
2. Set `LLM_MODEL=gpt-4o-mini`.
3. Provide `OPENAI_API_KEY` in your environment.

## Cloud Deployment

The service is deployed to **Google Cloud Run** using a multi-container (sidecar) configuration.

### Deployment Command
```bash
# Deploys the service with the Ollama sidecar
./infrastructure/deploy-cloud.sh --apply --service-name query-analyzer --cb-config cloudbuild.query-analyzer.yaml
```

### Resource Requirements
- **CPU**: 8 vCPUs (shared across containers).
- **Memory**: 16GiB (shared across containers).
- **Billing**: Must use `instance-based` billing to ensure the model stays in memory for low-latency responses.

## Troubleshooting

### Error: `LLM Provider Error`
Check the logs for detailed error messages. Common issues include:
- **Connection Refused (Ollama)**: `OLLAMA_HOST` is incorrect or the sidecar is not running.
- **Not Found (Ollama)**: The model specified in `LLM_MODEL` is not available in the Ollama instance. Run `ollama pull <model_name>` inside the Ollama container.
- **Invalid API Key (OpenAI)**: `OPENAI_API_KEY` is missing or incorrect.
- **Timeout**: The model is too large for the allocated CPU/Memory, or the first-time initialization is slow.

### High Latency
Llama-3 8B inference time can vary.
- **Local**: Ensure you have enough RAM and CPU. If using a Mac with M-series chips, GPU acceleration should be automatic in Docker if configured.
- **Cloud**: Verify that the Cloud Run service has at least 8 vCPUs and is using instance-based billing. Cold starts will be significantly slower if the model needs to be re-loaded.

## Monitoring

### Logs
Search for the following log keys in Cloud Logging or via `npm run local:logs`:
- `query-analyzer.message.received`: Event processing started.
- `query-analyzer.short_circuit`: Message was flagged as spam/trivial and terminated early.
- `query-analyzer.llm_provider_error`: Errors communicating with the LLM provider (Ollama or OpenAI).
- `llm_bot.adaptive_model_selection`: Downstream model selection based on analyzer output.

### Health Checks
- `GET /healthz`: Basic liveness check for the Node.js app.
- `GET /readyz`: Readiness check (currently matches healthz).
