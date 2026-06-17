import { MemoryManager } from '../memory/memoryManager';
import { ConsolidationEngine } from '../consolidation/engine';
import { hashCwd, loadConfig } from '../utils';

export function registerMemoryConsolidateCommand(pi: any, manager: MemoryManager) {
  pi.registerCommand('memory-consolidate', {
    description: 'Consolidate memories: decay, merge, promote, and trigger agent extraction',
    handler: async (_args: string, ctx: any) => {
      const project = hashCwd(ctx.cwd);
      const config = loadConfig();

      const engine = new ConsolidationEngine(manager);
      const result = engine.consolidate(project, {
        decayDays: config.consolidation?.decay_days ?? 30,
        archiveDays: config.consolidation?.archive_days ?? 90,
        mergeThreshold: config.consolidation?.merge_similarity_threshold ?? 0.6,
        promoteMinSessions: config.consolidation?.promote_min_sessions ?? 3,
      });

      ctx.ui.notify(
        `Consolidation complete:\n` +
        `  Decayed: ${result.decayed}\n` +
        `  Archived: ${result.archived}\n` +
        `  Merged: ${result.merged}\n` +
        `  Promoted: ${result.promoted}`,
        'info'
      );

      const os = require('os');
      const path = require('path');
      const sessionsDir = path.join(os.homedir(), '.pi', 'agent', 'memory', 'sessions', project);
      pi.sendMessage(
        {
          content: `Review recent session summaries in ${sessionsDir}.\nExtract important facts, decisions, preferences, and corrections.\nUse memory_write to record them. Focus on reusable, cross-session knowledge.`,
          display: true,
        },
        { triggerTurn: true, deliverAs: 'steer' }
      );
    },
  });
}
