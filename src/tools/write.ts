import { MemoryManager } from '../memory/memoryManager';
import { hashCwd } from '../utils';

export function registerWriteTool(pi: any, manager: MemoryManager) {
  pi.registerTool({
    name: 'memory_write',
    label: 'Write Memory',
    description: 'Write a fact, decision, preference, procedure, or correction to persistent memory. PROACTIVELY use this during work when you learn something worth remembering across sessions — you do NOT need the user to ask. Especially write when: (1) the user corrects you (you were wrong, they show the right way — store as `correction` so you don\'t repeat the mistake); (2) an important design decision is made (chose A over B, with a reason — store as `decision`); (3) the user states a preference or convention (store as `preference`); (4) you discover a reusable fact or procedure (API contract, project convention, how-to — store as `fact`/`procedure`). Keep entries concise (one lesson per write). Pass `role` if you are a spawned role subagent (default main).',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Memory type: fact, decision, preference, procedure, correction' },
        content: { type: 'string', description: 'The memory content to store' },
        project: { type: 'string', description: 'Project scope (defaults to current project)' },
        role: { type: 'string', description: "Role isolation bucket: 'main' (main agent, incl. in-place /role switch — default), your role name if you are a spawned role subagent (e.g. 'researcher', 'coder'), or 'shared' for cross-role read-only knowledge. Prevents memory cross-contamination across roles." },
      },
      required: ['type', 'content'],
    },
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      const memory = manager.write({
        type: params.type,
        content: params.content,
        project: params.project || hashCwd(ctx.cwd),
        role: params.role,
      });
      return {
        content: [{ type: 'text', text: `Memory recorded: [${memory.id}] ${memory.content}` }],
        details: { memory },
      };
    },
  });
}
