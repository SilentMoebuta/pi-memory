import { MemoryManager } from '../memory/memoryManager';

export function registerRecallTool(pi: any, manager: MemoryManager) {
  pi.registerTool({
    name: 'memory_recall',
    label: 'Recall Memory',
    description: 'Recall full memory content on-demand (just-in-time retrieval). The常驻 memory block only shows an INDEX of what memories exist (type + count) — it does NOT contain memory content. Call this tool to retrieve actual memory text when you need specific prior context (e.g. past decisions, API contracts, prior debugging lessons, project conventions). Use a focused query. Returns L2 (recent session) + L3 (long-term) results. Prefer this over re-deriving context you may already have stored.',
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
