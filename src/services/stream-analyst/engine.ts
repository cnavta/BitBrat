import type { Firestore } from 'firebase-admin/firestore';
import { generateText } from 'ai';
import { StreamBuffer } from './stream-buffer';
import type { SummarizationRequest, StreamObserver } from '../../types/sessi';
import type { InternalEventV2, AnnotationV1 } from '../../types/events';
import { getLlmProvider } from '../../common/llm/provider-factory';
import { assemble } from '../../common/prompt-assembly/assemble';
import type { PromptSpec } from '../../common/prompt-assembly/types';
import { v4 as uuidv4 } from 'uuid';

export class StreamAnalystEngine {
  constructor(
    private firestore: Firestore,
    private logger: any
  ) {}

  /**
   * Main entry point for summarization requests.
   */
  async summarize(request: SummarizationRequest): Promise<string> {
    // BL-004: Load observer if ID provided to get source configuration
    let observer: StreamObserver | undefined;
    if (request.observerId) {
      const doc = await this.firestore.collection('stream_observers').doc(request.observerId).get();
      if (doc.exists) {
        observer = { id: doc.id, ...doc.data() } as StreamObserver;
      }
    }

    const windowMinutes = request.windowMinutes || 10;
    const streamType = request.streamType || 'chat';
    const observerId = request.observerId || 'manual';
    
    // Idempotency: Use observerId + current window start time (rounded to windowMinutes)
    const now = Date.now();
    const windowStart = new Date(Math.floor(now / (windowMinutes * 60000)) * (windowMinutes * 60000)).toISOString();
    const idempotencyKey = `${observerId}:${windowStart}`;

    if (request.observerId) {
      const runDoc = await this.firestore.collection('summarization_runs').doc(idempotencyKey).get();
      if (runDoc.exists) {
        this.logger.info('stream.summarize.skip_duplicate', { observerId, windowStart });
        return runDoc.data()?.summary || 'Duplicate run skipped.';
      }
    }

    this.logger.info('stream.summarize.start', { streamType, windowMinutes, observerId });

    try {
      // 1. Extraction Phase
      const events = await this.queryEvents(request, observer);
      
      if (events.length === 0) {
        this.logger.info('stream.summarize.no_events', { streamType, windowMinutes });
        return `No events found for ${streamType} in the last ${windowMinutes} minutes.`;
      }

      // 2. Normalization Phase
      const buffer = new StreamBuffer();
      // Events from Firestore are DESC (newest first). 
      // addEvent adds them to an internal list.
      // getContent returns them in ASC (chronological) order by reversing the list.
      for (const event of events) {
        if (!buffer.addEvent(event)) {
          this.logger.warn('stream.summarize.buffer_full', { 
            streamType, 
            processedCount: buffer.getTokens() 
          });
          break;
        }
      }
      
      const context = buffer.getContent();
      
      // 3. Analysis Phase
      const taskInstruction = `Summarize the following ${streamType} stream from the last ${windowMinutes} minutes.`;
      const inspectionInstruction = request.inspectionEnabled 
        ? "\n\nProvide the output in JSON format with the following structure:\n" +
          "{\n" +
          "  \"summary\": \"markdown formatted summary\",\n" +
          "  \"annotations\": [\n" +
          "    { \"kind\": \"sentiment|topic|toxicity|accuracy\", \"label\": \"label\", \"score\": 0.0-1.0, \"value\": \"optional text\", \"payload\": {} }\n" +
          "  ]\n" +
          "}"
        : "";

      const promptSpec: PromptSpec = {
        systemPrompt: {
          rules: [
            "You are a professional stream analyst.",
            "Analyze the event stream provided in the context.",
            request.inspectionEnabled 
              ? "Provide a structured JSON response containing a summary and a list of annotations." 
              : "Provide a concise summary of the event stream.",
            "Output in clean Markdown format for the summary part.",
            "Do not mention the redaction markers [REDACTED_EMAIL] or [REDACTED_TOKEN] in your output."
          ]
        },
        task: [{
          instruction: taskInstruction + inspectionInstruction
        }],
        input: {
          userQuery: request.inspectionEnabled ? "Analyze and inspect this stream." : "Summarize this stream.",
          context: context
        }
      };

      const assembled = assemble(promptSpec);
      
      const model = getLlmProvider({
        provider: process.env.LLM_PROVIDER || 'openai',
        model: process.env.LLM_MODEL || 'gpt-4o',
        apiKey: process.env.OPENAI_API_KEY
      });

      // BL-007: Simple retry logic for transient LLM failures
      let responseText = '';
      let retries = 3;
      while (retries > 0) {
        try {
          const { text } = await generateText({
            model: model as any,
            prompt: assembled.text
          });
          responseText = text;
          break;
        } catch (e: any) {
          retries--;
          this.logger.warn('stream.summarize.llm_failed', { error: e.message, retriesLeft: retries });
          if (retries === 0) throw e;
          await new Promise(resolve => setTimeout(resolve, 1000 * (3 - retries))); // Exponential backoffish
        }
      }

      let finalSummary = responseText;
      let annotations: AnnotationV1[] = [];

      if (request.inspectionEnabled) {
        try {
          // Extract JSON from potential Markdown code blocks
          const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || responseText.match(/{[\s\S]*}/);
          const jsonText = jsonMatch ? jsonMatch[1] || jsonMatch[0] : responseText;
          const parsed = JSON.parse(jsonText);
          
          finalSummary = parsed.summary || responseText;
          if (Array.isArray(parsed.annotations)) {
            annotations = parsed.annotations.map((a: any) => ({
              id: uuidv4(),
              kind: a.kind || 'custom',
              source: 'stream-analyst',
              createdAt: new Date().toISOString(),
              label: a.label,
              score: a.score,
              value: a.value,
              payload: a.payload
            }));
          }
        } catch (e: any) {
          this.logger.warn('stream.summarize.json_parse_failed', { error: e.message, responseText });
          // Fallback: use raw text as summary
        }
      }

      this.logger.info('stream.summarize.complete', { 
        streamType, 
        eventCount: events.length,
        charsUsed: assembled.text.length,
        annotationsCount: annotations.length
      });

      // BL-005: Enable Annotation Persistence
      if (annotations.length > 0) {
        await this.persistAnnotations(events, annotations, observer?.source?.collection || 'events');
      }

      const result = request.inspectionEnabled 
        ? JSON.stringify({ summary: finalSummary, annotations }, null, 2)
        : finalSummary;

      // Persist run for idempotency
      if (request.observerId) {
        await this.firestore.collection('summarization_runs').doc(idempotencyKey).set({
          observerId,
          windowStart,
          at: new Date().toISOString(),
          summary: result,
          requestId: request.requestId
        });
      }

      return result;
    } catch (error: any) {
      this.logger.error('stream.summarize.error', { 
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  private async persistAnnotations(events: InternalEventV2[], annotations: AnnotationV1[], collectionName: string) {
    try {
      // For simplicity, we enrich the most recent event in the window with the annotations
      // In a more complex scenario, we might map annotations to specific events
      if (events.length === 0) return;
      
      const latestEvent = events[0];
      const docId = (latestEvent as any).id || (latestEvent as any)._id; // Try to find a document ID

      if (!docId) {
        this.logger.warn('stream.persist_annotations.no_id', { collectionName });
        return;
      }

      const docRef = this.firestore.collection(collectionName).doc(docId);
      await this.firestore.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        if (!doc.exists) return;

        const currentAnnotations = doc.data()?.annotations || [];
        transaction.update(docRef, {
          annotations: [...currentAnnotations, ...annotations],
          updatedAt: new Date().toISOString()
        });
      });

      this.logger.info('stream.persist_annotations.complete', { 
        docId, 
        collectionName, 
        count: annotations.length 
      });
    } catch (e: any) {
      this.logger.error('stream.persist_annotations.failed', { error: e.message });
    }
  }

  /**
   * Queries Firestore for events within the time window and matching filters.
   */
  private async queryEvents(request: SummarizationRequest, observer?: StreamObserver): Promise<InternalEventV2[]> {
    const windowMinutes = request.windowMinutes || 10;
    const startTime = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
    
    // BL-004: Respect source collection from observer or request
    const collectionName = observer?.source?.collection || 'events';
    const timeField = collectionName === 'prompt_logs' ? 'createdAt' : 'ingressAt';

    let query: any = this.firestore.collection(collectionName)
      .where(timeField, '>=', startTime)
      .orderBy(timeField, 'desc');
      
    if (request.streamType) {
       // BL-007: Make event type mappings configurable via environment or default
       const typeMap: Record<string, string> = {
         'chat': process.env.STREAM_TYPE_MAP_CHAT || 'chat.message.v1',
         'logs': process.env.STREAM_TYPE_MAP_LOGS || 'llm.response.v1',
         'errors': process.env.STREAM_TYPE_MAP_ERRORS || 'system.error.v1'
       };
       const eventType = typeMap[request.streamType] || request.streamType;
       
       // Handle schema differences
       if (collectionName === 'events') {
         query = query.where('eventType', '==', eventType);
       }
    }
    
    const filters = observer?.source?.filters || request.filters;
    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        query = query.where(key, '==', value);
      }
    }
    
    const snapshot = await query.get();
    return snapshot.docs.map((doc: any) => {
      const data = doc.data();
      // Ensure we keep the doc ID for persistence phase
      const eventData = { ...data, id: doc.id };

      // Normalize prompt_logs to InternalEventV2-like structure if needed for buffer
      if (collectionName === 'prompt_logs') {
        return {
          ...eventData,
          ingressAt: data.createdAt,
          eventType: 'prompt_log.v1',
          message: {
            text: data.response?.text || data.prompt || JSON.stringify(data)
          }
        } as any;
      }
      return eventData as InternalEventV2;
    });
  }
}
