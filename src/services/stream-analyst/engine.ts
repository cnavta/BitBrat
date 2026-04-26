import type { Firestore } from 'firebase-admin/firestore';
import { generateText } from 'ai';
import { StreamBuffer } from './stream-buffer';
import type { SummarizationRequest } from '../../types/sessi';
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
    const windowMinutes = request.windowMinutes || 10;
    const streamType = request.streamType || 'chat';
    
    this.logger.info('stream.summarize.start', { streamType, windowMinutes });

    try {
      // 1. Extraction Phase
      const events = await this.queryEvents(request);
      
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

      const { text } = await generateText({
        model: model as any,
        prompt: assembled.text
      });

      let finalSummary = text;
      let annotations: AnnotationV1[] = [];

      if (request.inspectionEnabled) {
        try {
          // Extract JSON from potential Markdown code blocks
          const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/{[\s\S]*}/);
          const jsonText = jsonMatch ? jsonMatch[1] || jsonMatch[0] : text;
          const parsed = JSON.parse(jsonText);
          
          finalSummary = parsed.summary || text;
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
          this.logger.warn('stream.summarize.json_parse_failed', { error: e.message, text });
          // Fallback: use raw text as summary
        }
      }

      this.logger.info('stream.summarize.complete', { 
        streamType, 
        eventCount: events.length,
        charsUsed: assembled.text.length,
        annotationsCount: annotations.length
      });

      return request.inspectionEnabled 
        ? JSON.stringify({ summary: finalSummary, annotations }, null, 2)
        : finalSummary;
    } catch (error: any) {
      this.logger.error('stream.summarize.error', { 
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Queries Firestore for events within the time window and matching filters.
   */
  private async queryEvents(request: SummarizationRequest): Promise<InternalEventV2[]> {
    const windowMinutes = request.windowMinutes || 10;
    const startTime = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
    
    let query: any = this.firestore.collection('events')
      .where('ingressAt', '>=', startTime)
      .orderBy('ingressAt', 'desc');
      
    if (request.streamType) {
       const typeMap: Record<string, string> = {
         'chat': 'chat.message.v1',
         'logs': 'llm.response.v1',
         'errors': 'system.error.v1'
       };
       const eventType = typeMap[request.streamType] || request.streamType;
       query = query.where('eventType', '==', eventType);
    }
    
    if (request.filters) {
      for (const [key, value] of Object.entries(request.filters)) {
        query = query.where(key, '==', value);
      }
    }
    
    const snapshot = await query.get();
    return snapshot.docs.map((doc: any) => doc.data() as InternalEventV2);
  }
}
