import { MemoryManager } from '../memory/memoryManager';

export function registerForgetTool(pi: any, manager: MemoryManager) {
  pi.registerTool({
    name: 'memory_forget',
    label: 'Forget Memory',
    description: 'Remove a memory by its ID (soft delete).',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Memory ID to forget' },
      },
      required: ['id'],
    },
    async execute(_id: string, params: any) {
      const ok = manager.forget(params.id);
      return {
        content: [{ type: 'text', text: ok ? `Memory ${params.id} forgotten.` : `Memory ${params.id} not found.` }],
        details: {},
        isError: !ok,
      };
    },
  });
}
