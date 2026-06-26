import { MemoryManager } from '../memory/memoryManager';

export function registerRecallTool(pi: any, manager: MemoryManager) {
  pi.registerTool({
    name: 'memory_recall',
    label: 'Recall Memory',
    description: 'Recursively recall memories across L2/L3 tiers for a query.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to recall' },
        project: { type: 'string', description: 'Current project' },
        role: { type: 'string', description: "Your role isolation bucket (default 'main'). Pass your role name if spawned role subagent. 'shared' content always visible." },
      },
      required: ['query', 'project'],
    },
    async execute(_id: string, params: any) {
      const result = await manager.recall(params.query, params.project, params.role ?? 'main', true);
      const text = result.combined.map((r, i) =>
        `${i + 1}. [${r.memory.type}] ${r.memory.content}`
      ).join('\n') || 'No relevant memories found.';
      return { content: [{ type: 'text', text }], details: { result } };
    },
  });
}
