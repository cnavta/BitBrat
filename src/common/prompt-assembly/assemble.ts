import {
  AssembledPrompt,
  AssembledPromptSections,
  AssemblerConfig,
  Constraint,
  PromptSpec,
  TaskAnnotation,
} from "./types";

function heading(label: string, level: 1 | 2 | 3 = 2): string {
  const hashes = "#".repeat(level);
  return `${hashes} [${label}]`;
}

function normalizePriority<T extends { priority?: 1 | 2 | 3 | 4 | 5 }>(items: T[] | undefined): (T & { priority: 1 | 2 | 3 | 4 | 5 })[] {
  return (items ?? []).map((i) => ({ ...i, priority: (i.priority ?? 3) as 1 | 2 | 3 | 4 | 5 }));
}

function sortByPriority<T extends { priority: 1 | 2 | 3 | 4 | 5 }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.priority - b.priority);
}

function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return "…";
  return text.slice(0, Math.max(0, max - 1)) + "…";
}

function renderSystemPrompt(spec: PromptSpec, cfg: AssemblerConfig): string {
  const lines: string[] = [heading("System Prompt", cfg.headingLevel ?? 2)];
  if (!spec.systemPrompt) {
    if (cfg.showEmptySections ?? true) lines.push("- None provided.");
    return lines.join("\n");
  }
  const sp = spec.systemPrompt;
  if (sp.summary) lines.push(`- ${sp.summary}`);
  if (sp.rules && sp.rules.length) {
    for (const r of sp.rules) lines.push(`- ${r}`);
  }
  if (sp.sources && sp.sources.length) {
    lines.push(`- Sources: ${sp.sources.join(", ")}`);
  }
  return lines.join("\n");
}

function renderIdentity(spec: PromptSpec, cfg: AssemblerConfig): string {
  // v2 label update: render as [Assistant Identity] while keeping type name Identity
  const lines: string[] = [heading("Assistant Identity", cfg.headingLevel ?? 2)];
  const id = spec.identity;
  if (!id) {
    if (cfg.showEmptySections ?? true) lines.push("- None provided.");
    return lines.join("\n");
  }
  if (id.name) lines.push(`- Name: ${id.name}`);
  if (id.summary) lines.push(`- ${id.summary}`);
  if (id.traits?.length) lines.push(`- Traits: ${id.traits.join(", ")}`);
  if (id.tone) lines.push(`- Tone: ${id.tone}`);
  if (id.styleGuidelines?.length) lines.push(`- Style: ${id.styleGuidelines.join("; ")}`);
  return lines.join("\n");
}

function renderRequestingUser(spec: PromptSpec, cfg: AssemblerConfig): string {
  const lines: string[] = [heading("Requesting User", cfg.headingLevel ?? 2)];
  const u = spec.requestingUser;
  if (!u) {
    if (cfg.showEmptySections ?? true) lines.push("- None provided.");
    return lines.join("\n");
  }
  if (u.handle) lines.push(`- Handle: ${u.handle}`);
  if (u.roles?.length) lines.push(`- Roles: [${u.roles.join(", ")}]`);
  if (u.locale || u.timezone) lines.push(`- Locale: ${u.locale ?? "n/a"}; TZ: ${u.timezone ?? "n/a"}`);
  if (u.tier) lines.push(`- Tier: ${u.tier}`);
  if (u.notes) lines.push(`- Notes: ${u.notes}`);
  return lines.join("\n");
}

// v2 scaffold: Conversation State / History (placeholder rendering)
function renderConversationState(spec: PromptSpec, cfg: AssemblerConfig): string {
  const lines: string[] = [heading("Conversation State / History", cfg.headingLevel ?? 2)];
  const cs = spec.conversationState;
  if (!cs) {
    if (cfg.showEmptySections ?? true) lines.push("- None provided.");
    return lines.join("\n");
  }

  const mode = cs.renderMode ?? "summary";

  // Summary-first rendering
  if (cs.summary && (mode === "summary" || mode === "both")) {
    // Support multi-line summaries by splitting into bullets
    const parts = cs.summary.split("\n").filter(Boolean);
    for (const part of parts) lines.push(`- ${part}`);
  }

  // Optional fenced transcript
  const shouldRenderTranscript = !!cs.transcript && (mode === "transcript" || mode === "both");
  if (shouldRenderTranscript && cs.transcript && cs.transcript.length) {
    const roleLabel = (r: "user" | "assistant" | "tool") =>
      r === "user" ? "U" : r === "assistant" ? "A" : "T";
    const linesTx = cs.transcript.map((item) => `${roleLabel(item.role)}: ${item.content}`);
    lines.push("~~~text");
    lines.push(...linesTx);
    lines.push("~~~");
  }

  if (!cs.summary && !shouldRenderTranscript) {
    if (cfg.showEmptySections ?? true) lines.push("- None provided.");
  }

  return lines.join("\n");
}

function renderConstraints(spec: PromptSpec, cfg: AssemblerConfig): string {
  const lines: string[] = [heading("Constraints", cfg.headingLevel ?? 2)];
  const constraints = sortByPriority(normalizePriority<Constraint>(spec.constraints));
  if (!constraints.length) {
    if (cfg.showEmptySections ?? true) lines.push("- None provided.");
    return lines.join("\n");
  }
  for (const c of constraints) {
    lines.push(`- (${c.priority}) ${c.text}`);
  }
  return lines.join("\n");
}

function renderTask(spec: PromptSpec, cfg: AssemblerConfig): string {
  const lines: string[] = [heading("Task", cfg.headingLevel ?? 2)];
  const tasks = sortByPriority(normalizePriority<TaskAnnotation>(spec.task));
  for (const t of tasks) {
    lines.push(`- (${t.priority}) ${t.instruction}`);
  }
  return lines.join("\n");
}

function fenceIfMultiline(text: string): string {
  if (!text.includes("\n")) return text;
  return ["~~~text", text, "~~~"].join("\n");
}

function renderInput(spec: PromptSpec, cfg: AssemblerConfig): string {
  const lines: string[] = [heading("Input", cfg.headingLevel ?? 2)];
  const payload = spec.input;
  const uq = fenceIfMultiline(payload.userQuery);
  lines.push(uq);
  if (payload.context) {
    lines.push("");
    lines.push(fenceIfMultiline(payload.context));
  }
  return lines.join("\n");
}

export function assemble(spec: PromptSpec, config: AssemblerConfig = {}): AssembledPrompt {
  if (!spec || !spec.input || !spec.task || spec.task.length === 0) {
    throw new Error("assemble(): PromptSpec requires at least one task and an input payload");
  }
  const cfg: AssemblerConfig = {
    headingLevel: 2,
    showEmptySections: true,
    ...config,
  };

  // Prepare working copies for truncation logic (P-04)
  const truncationNotes: string[] = [];
  const workingSpec: PromptSpec = {
    ...spec,
    constraints: sortByPriority(normalizePriority<Constraint>(spec.constraints)),
    task: sortByPriority(normalizePriority<TaskAnnotation>(spec.task)),
    input: { ...spec.input },
  };

  // Placeholder for post-render section overrides (compression without mutating spec deeply)
  const sectionsPlaceholder: Partial<AssembledPromptSections> = {};

  // Apply per-section caps first where feasible
  const caps = cfg.sectionCaps ?? {};
  // Input: Prefer trimming context first
  if (caps.input) {
    const header = heading("Input", cfg.headingLevel ?? 2) + "\n";
    const uq = workingSpec.input.userQuery;
    const ctx = workingSpec.input.context ?? "";
    const base = header.length + uq.length + (ctx ? 2 : 0); // include extra newline when context exists
    if (header.length + uq.length + (ctx ? 2 + ctx.length : 0) > caps.input) {
      if (ctx) {
        const maxCtx = Math.max(0, caps.input - base);
        const newCtx = truncateText(ctx, maxCtx);
        if (newCtx.length < ctx.length) truncationNotes.push("Input.context truncated to meet section cap.");
        workingSpec.input.context = newCtx;
      } else {
        // As last resort for section cap, trim userQuery tail
        const maxUq = Math.max(0, caps.input - header.length);
        const newUq = truncateText(uq, maxUq);
        if (newUq.length < uq.length) truncationNotes.push("Input.userQuery truncated to meet section cap.");
        workingSpec.input.userQuery = newUq;
      }
    }
  }

  // Task section cap: drop lowest-priority tasks until under cap
  if (caps.task) {
    // Rough estimate by rendering and adjusting
    let taskText = renderTask(workingSpec, cfg);
    while (taskText.length > caps.task && workingSpec.task.length > 1) {
      const removed = workingSpec.task.pop(); // remove lowest-priority (last due to sorting)
      if (removed) truncationNotes.push(`Dropped task(id:${removed.id ?? "?"}, p:${removed.priority ?? 3}) to meet section cap.`);
      taskText = renderTask(workingSpec, cfg);
    }
  }

  // Conversation State section cap: prefer trimming transcript items first
  if (caps.conversationState && workingSpec.conversationState) {
    let csRendered = renderConversationState(workingSpec, cfg);
    if (csRendered.length > caps.conversationState) {
      if (workingSpec.conversationState.transcript?.length) {
        // Trim earliest transcript items until we fit
        while (
          csRendered.length > caps.conversationState &&
          (workingSpec.conversationState?.transcript?.length ?? 0) > 0
        ) {
          workingSpec.conversationState!.transcript = workingSpec.conversationState!.transcript!.slice(1);
          csRendered = renderConversationState(workingSpec, cfg);
        }
        truncationNotes.push("ConversationState.transcript truncated to meet section cap.");
      }
      // If still too long (e.g., long summary), compress rendered text as last resort
      if (csRendered.length > caps.conversationState) {
        const header = heading("Conversation State / History", cfg.headingLevel ?? 2) + "\n";
        const body = csRendered.slice(header.length);
        const compressedBody = truncateText(body, Math.max(0, caps.conversationState - header.length));
        sectionsPlaceholder.conversationState = header + compressedBody; // will be applied after rendering
        truncationNotes.push("ConversationState section compressed to meet section cap.");
      }
    }
  }

  // Constraints section cap: DO NOT drop constraints in v2. Compress wording instead.
  // We'll apply compression after initial render based on measured length.

  // Render sections after section-level adjustments
  let sections: AssembledPromptSections = {
    systemPrompt: renderSystemPrompt(workingSpec, cfg),
    identity: renderIdentity(workingSpec, cfg),
    requestingUser: renderRequestingUser(workingSpec, cfg),
    conversationState: renderConversationState(workingSpec, cfg),
    constraints: renderConstraints(workingSpec, cfg),
    task: renderTask(workingSpec, cfg),
    input: renderInput(workingSpec, cfg),
  };

  // Post-render section compression placeholders (set above) get applied here
  // Using a small holder object to avoid re-rendering everything repeatedly
  if (typeof (sectionsPlaceholder as any) !== "undefined") {
    if (sectionsPlaceholder.conversationState) sections.conversationState = sectionsPlaceholder.conversationState;
  }

  // Apply constraints section cap by compressing, never dropping
  if (caps.constraints && sections.constraints.length > caps.constraints) {
    sections.constraints = truncateText(sections.constraints, caps.constraints);
    truncationNotes.push("Constraints section compressed to meet section cap (no items dropped).");
  }

  // Compute totals
  const sectionLengths = {
    systemPrompt: sections.systemPrompt.length,
    identity: sections.identity.length,
    requestingUser: sections.requestingUser.length,
    conversationState: sections.conversationState.length,
    constraints: sections.constraints.length,
    task: sections.task.length,
    input: sections.input.length,
  } as Record<keyof AssembledPromptSections, number>;
  let totalChars = [
    sections.systemPrompt,
    sections.identity,
    sections.requestingUser,
    sections.conversationState,
    sections.constraints,
    sections.task,
    sections.input,
  ].join("\n\n").length;

  // Apply maxTotalChars by trimming in the defined order (v2):
  // 1) Remove Input.context
  // 2) Trim ConversationState.transcript
  // 3) Drop lower-priority tasks
  // 4) (Never drop Constraints or System Prompt/Identity)
  // 5) Trim Input.userQuery tail as last resort
  if (cfg.maxTotalChars && totalChars > cfg.maxTotalChars) {
    // 1) Trim Input.context entirely before touching anything else
    if (workingSpec.input.context) {
      workingSpec.input = { ...workingSpec.input, context: "" };
      truncationNotes.push("Removed Input.context to satisfy total cap.");
      sections.input = renderInput(workingSpec, cfg);
      sectionLengths.input = sections.input.length;
      totalChars = [
        sections.systemPrompt,
        sections.identity,
        sections.requestingUser,
        sections.conversationState,
        sections.constraints,
        sections.task,
        sections.input,
      ].join("\n\n").length;
    }

    // 2) Trim ConversationState.transcript (prefer summarization over raw transcript)
    if (
      cfg.maxTotalChars &&
      totalChars > cfg.maxTotalChars &&
      workingSpec.conversationState?.transcript?.length
    ) {
      // Iteratively remove earliest items to keep most recent exchanges
      while (
        cfg.maxTotalChars &&
        totalChars > cfg.maxTotalChars &&
        (workingSpec.conversationState?.transcript?.length ?? 0) > 0
      ) {
        workingSpec.conversationState!.transcript = workingSpec.conversationState!.transcript!.slice(1);
        sections.conversationState = renderConversationState(workingSpec, cfg);
        sectionLengths.conversationState = sections.conversationState.length;
        totalChars = [
          sections.systemPrompt,
          sections.identity,
          sections.requestingUser,
          sections.conversationState,
          sections.constraints,
          sections.task,
          sections.input,
        ].join("\n\n").length;
      }
      truncationNotes.push("ConversationState.transcript truncated to satisfy total cap.");
    }

    // 3) Drop lowest-priority tasks
    while (cfg.maxTotalChars && totalChars > cfg.maxTotalChars && workingSpec.task.length > 1) {
      const removed = workingSpec.task.pop();
      if (removed) truncationNotes.push(`Dropped task(id:${removed.id ?? "?"}, p:${removed.priority ?? 3}) to satisfy total cap.`);
      sections.task = renderTask(workingSpec, cfg);
      sectionLengths.task = sections.task.length;
      totalChars = [
        sections.systemPrompt,
        sections.identity,
        sections.requestingUser,
        sections.conversationState,
        sections.constraints,
        sections.task,
        sections.input,
      ].join("\n\n").length;
    }

    // Never drop System Prompt; preserve Identity if provided (we already never touch them)
    // As last resort, trim the tail of Input.userQuery
    if (cfg.maxTotalChars && totalChars > cfg.maxTotalChars) {
      const header = heading("Input", cfg.headingLevel ?? 2) + "\n";
      // reconstruct input body without context (already removed if needed)
      const uq = workingSpec.input.userQuery;
      const allowed = Math.max(
        0,
        (cfg.maxTotalChars ?? 0) - (
          // All sections except Input body (we add header back below)
          [
            sections.systemPrompt,
            sections.identity,
            sections.requestingUser,
            sections.conversationState,
            sections.constraints,
            sections.task,
          ].join("\n\n").length + "\n\n".length + header.length
        )
      );
      const newUq = truncateText(uq, allowed);
      if (newUq.length < uq.length) truncationNotes.push("Input.userQuery truncated to satisfy total cap.");
      workingSpec.input.userQuery = newUq;
      sections.input = renderInput(workingSpec, cfg);
      sectionLengths.input = sections.input.length;
      totalChars = [
        sections.systemPrompt,
        sections.identity,
        sections.requestingUser,
        sections.conversationState,
        sections.constraints,
        sections.task,
        sections.input,
      ].join("\n\n").length;
    }
  }

  const text = [
    sections.systemPrompt,
    sections.identity,
    sections.requestingUser,
    sections.conversationState,
    sections.constraints,
    sections.task,
    sections.input,
  ].join("\n\n");

  const meta = {
    truncated: truncationNotes.length > 0,
    totalChars,
    maxTotalChars: cfg.maxTotalChars,
    sectionLengths,
    truncationNotes,
  } as AssembledPrompt["meta"];

  return { text, sections, meta };
}

export type { PromptSpec };
