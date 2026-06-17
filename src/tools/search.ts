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
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
      required: ['query'],
    },
    async execute(_id: string, params: any) {
      const results = manager.search(params.query, {
        type: params.type as any,
        project: params.project,
        limit: params.limit ?? 20,
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
