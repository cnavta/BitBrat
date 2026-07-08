/**
 * Persistence Abstraction Tools
 *
 * Tools for querying Firestore as generic JSON document storage.
 * Read-only operations for development and debugging.
 */

import { z } from 'zod';
import { ToolDefinition, TargetConnection } from '../types.js';

/**
 * db.collections - List all Firestore collections
 *
 * Returns a list of all top-level collections in the target Firestore.
 */
export const dbCollectionsTool: ToolDefinition = {
  name: 'db.collections',
  description: 'List all top-level Firestore collections in the target database',
  inputSchema: z.object({}),
  handler: async (args, connection: TargetConnection) => {
    try {
      const collections = await connection.firestore.db.listCollections();
      const collectionNames = collections.map((col) => col.id);

      const result = {
        projectId: connection.firestore.projectId,
        databaseId: connection.firestore.databaseId || '(default)',
        collections: collectionNames,
        count: collectionNames.length,
      };

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error listing collections: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * db.get - Get a single document by ID
 *
 * Retrieves a document from Firestore by collection and document ID.
 */
export const dbGetTool: ToolDefinition = {
  name: 'db.get',
  description: 'Get a Firestore document by collection path and document ID',
  inputSchema: z.object({
    collection: z.string().describe('Collection path (e.g., "commands", "packs", "events")'),
    id: z.string().describe('Document ID'),
  }),
  handler: async (args, connection: TargetConnection) => {
    try {
      const docRef = connection.firestore.db.collection(args.collection).doc(args.id);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                found: false,
                collection: args.collection,
                id: args.id,
              }, null, 2),
            },
          ],
        };
      }

      const data = docSnap.data();
      const result = {
        found: true,
        collection: args.collection,
        id: args.id,
        data,
      };

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error getting document: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * db.query - Query Firestore with filters, ordering, and pagination
 *
 * Supports:
 * - Filters: ==, !=, <, <=, >, >=, in, array-contains
 * - Ordering: orderBy with asc/desc
 * - Pagination: limit, offset
 */
export const dbQueryTool: ToolDefinition = {
  name: 'db.query',
  description: 'Query Firestore documents with filters, ordering, and pagination',
  inputSchema: z.object({
    collection: z.string().describe('Collection path to query'),
    filters: z.array(z.object({
      field: z.string().describe('Field path to filter on'),
      op: z.enum(['==', '!=', '<', '<=', '>', '>=', 'in', 'array-contains', 'array-contains-any'])
        .describe('Filter operator'),
      value: z.any().describe('Value to compare against'),
    })).optional().describe('Array of filter conditions'),
    orderBy: z.object({
      field: z.string().describe('Field to order by'),
      direction: z.enum(['asc', 'desc']).optional().describe('Sort direction (default: asc)'),
    }).optional().describe('Ordering specification'),
    limit: z.number().optional().describe('Maximum number of documents to return'),
    offset: z.number().optional().describe('Number of documents to skip'),
  }),
  handler: async (args, connection: TargetConnection) => {
    try {
      let query: any = connection.firestore.db.collection(args.collection);

      // Apply filters
      if (args.filters && args.filters.length > 0) {
        for (const filter of args.filters) {
          query = query.where(filter.field, filter.op, filter.value);
        }
      }

      // Apply ordering
      if (args.orderBy) {
        const direction = args.orderBy.direction || 'asc';
        query = query.orderBy(args.orderBy.field, direction);
      }

      // Apply pagination
      if (args.offset) {
        query = query.offset(args.offset);
      }
      if (args.limit) {
        query = query.limit(args.limit);
      }

      // Execute query
      const snapshot = await query.get();

      const documents = snapshot.docs.map((doc: any) => ({
        id: doc.id,
        data: doc.data(),
      }));

      const result = {
        collection: args.collection,
        count: documents.length,
        documents,
      };

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error querying collection: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * All persistence tools
 */
export const persistenceTools: ToolDefinition[] = [
  dbCollectionsTool,
  dbGetTool,
  dbQueryTool,
];
