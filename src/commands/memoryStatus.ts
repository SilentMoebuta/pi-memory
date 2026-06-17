import { MemoryManager } from '../memory/memoryManager';

export function registerMemoryStatusCommand(pi: any, manager: MemoryManager) {
  pi.registerCommand('memory-status', {
    description: 'View memory statistics and health',
    handler: async (_args: string, ctx: any) => {
      const stats = manager.getStats();
      const lines = [
        '=== Memory Status ===',
        `Total: ${stats.total}`,
        `Active: ${stats.byStatus['active'] || 0} | Archived: ${stats.byStatus['archived'] || 0}`,
        `Superseded: ${stats.byStatus['superseded'] || 0}`,
        `Avg Confidence: ${stats.avgConfidence.toFixed(2)}`,
        '',
        'By Type:',
        ...Object.entries(stats.byType).map(([t, c]) => `  ${t}: ${c || 0}`),
        '',
        `Last consolidation: ${stats.lastConsolidation ? new Date(stats.lastConsolidation).toLocaleString() : 'never'}`,
      ];
      ctx.ui.notify(lines.join('\n'), 'info');
    },
  });
}
