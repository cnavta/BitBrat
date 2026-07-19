/**
 * Persistence Abstraction Tools
 *
 * Tools for querying the persistence backend (PostgreSQL or Firestore) as generic JSON document storage.
 * Read-only operations for development and debugging.
 */

import { z } from 'zod';
import { ToolDefinition, TargetConnection } from '../types.js';

/**
 * db.collections - List all database collections/tables
 *
 * Returns a list of all top-level collections in the target database.
 * For PostgreSQL: Lists tables in the public schema.
 * For Firestore: Lists top-level collections.
 */
export const dbCollectionsTool: ToolDefinition = {
  name: 'db.collections',
  description: 'List all top-level Firestore collections in the target database',
  inputSchema: z.object({}),
  handler: async (args, connection: TargetConnection) => {
    try {
      // Use PostgreSQL store if available
      if (connection.persistenceDriver === 'postgres' && connection.store) {
        // For PostgreSQL, we'll list known tables
        // The IDocumentStore interface doesn't have a listCollections method,
        // so we return a hardcoded list of known tables
        const knownTables = [
          'service_registry',
          'events',
          'dispositions',
          'routingSlips',
          'context_packs',
          'commands'
        ];

        const result = {
          driver: 'postgres',
          collections: knownTables,
          count: knownTables.length,
        };

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // Fallback to Firestore
      const collections = await connection.firestore.db.listCollections();
      const collectionNames = collections.map((col) => col.id);

      const result = {
        driver: 'firestore',
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
 * Retrieves a document from the persistence backend by collection and document ID.
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
      // Use PostgreSQL store if available
      if (connection.persistenceDriver === 'postgres' && connection.store) {
        const doc = await connection.store.get(args.collection, args.id);

        if (!doc) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  found: false,
                  driver: 'postgres',
                  collection: args.collection,
                  id: args.id,
                }, null, 2),
              },
            ],
          };
        }

        const result = {
          found: true,
          driver: 'postgres',
          collection: args.collection,
          id: args.id,
          data: doc,
        };

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // Fallback to Firestore
      const docRef = connection.firestore.db.collection(args.collection).doc(args.id);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                found: false,
                driver: 'firestore',
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
        driver: 'firestore',
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
 * db.query - Query persistence backend with filters, ordering, and pagination
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
      // Use PostgreSQL store if available
      if (connection.persistenceDriver === 'postgres' && connection.store) {
        const queryOptions: any = {};

        // Map filters
        if (args.filters && args.filters.length > 0) {
          queryOptions.filters = args.filters.map((f: any) => ({
            field: f.field,
            operator: f.op,
            value: f.value
          }));
        }

        // Map ordering
        if (args.orderBy) {
          queryOptions.orderBy = {
            field: args.orderBy.field,
            direction: args.orderBy.direction || 'asc'
          };
        }

        // Map pagination
        if (args.limit) {
          queryOptions.limit = args.limit;
        }
        if (args.offset) {
          queryOptions.offset = args.offset;
        }

        // Execute query
        const documents = await connection.store.query(args.collection, queryOptions);

        const result = {
          driver: 'postgres',
          collection: args.collection,
          count: documents.length,
          documents: documents.map((doc: any) => ({
            id: doc.id,
            data: doc
          })),
        };

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // Fallback to Firestore
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
        driver: 'firestore',
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
