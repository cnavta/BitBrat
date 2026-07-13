// Just-in-Time Context Provisioning — public surface (sprint-328, sprint-338 P4 RAG)
//
// See documentation/architecture/tool-context-provisioning.md for the design (ADR §5).

export * from './types';
export * from './resolver';
export * from './named-context';
export * from './provider';
export * from './packs';
export * from './vector-provider';  // P4 RAG Scale-Out (sprint-338)
export * from './embedding';        // P4 RAG embedding utilities (sprint-338, BL-338-202)
