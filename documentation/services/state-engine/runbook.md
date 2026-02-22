# State Engine Service Runbook

## Overview
This runbook provides operational guidelines for maintaining and managing the State Engine service.

## Configuration Management

### State Configuration
The service's behavior (allowed keys and rules) is defined by a YAML configuration file. The path to this file is specified by the `STATE_ENGINE_CONFIG_PATH` environment variable.

#### Structure of the Config File
```yaml
allowedKeys:
  - "stream.state"
  - "stream.title"
  - "obs.scene"

rules:
  - id: "on_stream_start"
    when:
      and:
        - "==": [{ var: "key" }, "stream.state"]
        - "==": [{ var: "value" }, "on"]
    actions:
      - type: "publishEgress"
        payload:
          type: "system.stream.online"
          message: "Stream is now online"
```

#### Updating the Configuration
To apply changes to the rules or allowed keys:
1.  Update the YAML configuration file.
2.  Redeploy the service OR restart the Cloud Run instance to reload the configuration into memory.

## Monitoring

### Logs
The service logs meaningful events to stdout/stderr, which are captured by Google Cloud Logging (Stackdriver).

**Key Log Events**:
- `state-engine.mutation.received`: A new mutation proposal was received.
- `state-engine.mutation.committed`: Mutation successfully applied to Firestore.
- `state-engine.mutation.commit_failed`: Mutation failed due to validation or version mismatch.
- `state-engine.rule.eval_error`: JSON-Logic evaluation failed.
- `state-engine.egress.publish_error`: Failed to publish egress event.

### Health Checks
The service exposes a `/health` endpoint that returns a `200 OK` if the service is operational.

```bash
curl https://state-engine.bitbrat.ai/health
```

## Troubleshooting

### Mutation Rejected: "Key not allowed"
**Symptom**: Mutations for a specific key are consistently rejected.
**Resolution**: Check if the key is included in the `allowedKeys` list in the service's configuration file.

### Mutation Rejected: "Version mismatch"
**Symptom**: Mutation proposals are failing with a version mismatch error.
**Resolution**: 
1.  Verify that the proposing service/agent is providing the correct `expectedVersion`. 
2.  Use the `get_state` MCP tool to check the current version in Firestore.
3.  If a race condition is suspected, consider if the proposing logic needs to retry or fetch the latest state first.

### Rules Not Triggering
**Symptom**: State updates are successful, but no egress events are published.
**Resolution**:
1.  Check the logs for `state-engine.rule.eval_error`.
2.  Validate the JSON-Logic syntax in the `when` clause.
3.  Verify that the `key` and `value` being updated match the rule's conditions.

### Firestore Connectivity
**Symptom**: Service logs indicate errors connecting to Firestore.
**Resolution**: 
1.  Ensure the service account has the `roles/datastore.user` IAM role.
2.  Verify the `GOOGLE_APPLICATION_CREDENTIALS` environment variable if running locally.
3.  Check Firestore usage limits and quotas.
