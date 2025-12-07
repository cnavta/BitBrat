# Command Effects — Annotation or Candidate

This document explains how to author commands that produce either an Annotation or a Candidate on the current InternalEventV2.

CommandDoc fields:
- type: 'annotation' | 'candidate' (default: 'candidate')
- annotationKind: optional string identifying the kind of annotation to create when type='annotation' (e.g., 'intent', 'prompt', 'custom')
- templates: array of { id, text } used to render content
- cooldowns: { globalMs?, perUserMs? }
- rateLimit: { max, perMs }

Behavior:
- Cooldowns and rate limits are evaluated before any effect is produced. Violations result in SKIP and no mutations.
- For type='candidate':
  - A template is chosen avoiding immediate repeats (using runtime.lastUsedTemplateId).
  - The template text is rendered using a tiny interpolation: {{botName}}, {{username}}, {{utcNow}}, {{channel}}, {{userId}}, {{messageText}}, and shallow keys from event.payload.
  - A text CandidateV1 is appended with status='proposed'.
- For type='annotation':
  - If a template is present, it is rendered using the same interpolation to produce the annotation value; label defaults to the command name.
  - An AnnotationV1 is appended with kind from annotationKind or 'custom'.

Examples:

1) Candidate command
```
name: ping
type: candidate
templates:
  - id: t1
    text: "Pong {{username}}"
```

2) Annotation command
```
name: save
type: annotation
annotationKind: prompt
templates:
  - id: a1
    text: "Saved by {{username}} at {{utcNow}}"
```

Logging:
- command_processor.command.matched { name, id }
- command_processor.template.chosen { name, templateId }
- command_processor.candidate.added { name, templateId }
- command_processor.effect.added { effect: 'annotation', name, kind }

Notes:
- Unknown variables are left intact (e.g., {{foo}} remains {{foo}}) to keep rendering safe and predictable.
- runtime.lastUsedTemplateId is updated on successful candidate creation as part of global cooldown updates.
