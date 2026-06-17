import { MemoryManager } from '../memory/memoryManager';

export function registerStatusTool(pi: any, manager: MemoryManager) {
  pi.registerTool({
    name: 'memory_status',
    label: 'Memory Status',
    description: 'Get memory statistics: total count, type distribution, decay status.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Filter by project' },
      },
      required: [],
    },
    async execute(_id: string, params: any) {
      const stats = manager.getStats(params.project);
      const lines = [
        `Total memories: ${stats.total}`,
        `Active: ${stats.byStatus['active'] || 0}`,
        `Archived: ${stats.byStatus['archived'] || 0}`,
        `Average confidence: ${stats.avgConfidence.toFixed(2)}`,
        '',
        'By type:',
        ...Object.entries(stats.byType).map(([t, c]) => `  ${t}: ${c}`),
        '',
        `Last consolidation: ${stats.lastConsolidation ? new Date(stats.lastConsolidation).toISOString() : 'never'}`,
      ];
      return { content: [{ type: 'text', text: lines.join('\n') }], details: { stats } };
    },
  });
}
