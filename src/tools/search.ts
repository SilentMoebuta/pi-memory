import { MemoryManager } from '../memory/memoryManager';

export function registerSearchTool(pi: any, manager: MemoryManager) {
  pi.registerTool({
    name: 'memory_search',
    label: 'Search Memory',
    description: 'Search memories by keyword using BM25. Returns ranked results.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        type: { type: 'string', description: 'Filter by type' },
        project: { type: 'string', description: 'Filter by project' },
        role: { type: 'string', description: "Your role isolation bucket (default 'main'). Pass your role name if you are a spawned role subagent; 'shared' content is always visible. Prevents cross-role memory contamination." },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
      required: ['query'],
    },
    async execute(_id: string, params: any) {
      const results = manager.search(params.query, {
        type: params.type as any,
        project: params.project,
        role: params.role ?? 'main',
        limit: params.limit ?? 20,
        refreshOnAccess: true,
      });
      if (results.length === 0) {
        return { content: [{ type: 'text', text: 'No matching memories found.' }], details: {} };
      }
      const text = results.map((r, i) =>
        `${i + 1}. [${r.memory.type}] ${r.memory.content} (score: ${r.score.toFixed(2)})`
      ).join('\n');
      return { content: [{ type: 'text', text }], details: { results } };
    },
  });
}
