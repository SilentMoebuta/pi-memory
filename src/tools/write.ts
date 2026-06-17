import { MemoryManager } from '../memory/memoryManager';
import { hashCwd } from '../utils';

export function registerWriteTool(pi: any, manager: MemoryManager) {
  pi.registerTool({
    name: 'memory_write',
    label: 'Write Memory',
    description: 'Write a fact, decision, preference, procedure, or correction to persistent memory.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Memory type: fact, decision, preference, procedure, correction' },
        content: { type: 'string', description: 'The memory content to store' },
        project: { type: 'string', description: 'Project scope (defaults to current project)' },
      },
      required: ['type', 'content'],
    },
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      const memory = manager.write({
        type: params.type,
        content: params.content,
        project: params.project || hashCwd(ctx.cwd),
      });
      return {
        content: [{ type: 'text', text: `Memory recorded: [${memory.id}] ${memory.content}` }],
        details: { memory },
      };
    },
  });
}
