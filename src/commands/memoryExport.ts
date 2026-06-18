import { MemoryManager } from '../memory/memoryManager';
import * as fs from 'fs';
import * as path from 'path';

export function registerMemoryExportCommand(pi: any, manager: MemoryManager) {
  pi.registerCommand('memory-export', {
    description: 'Export all memories as JSON for backup/migration',
    handler: async (args: string, ctx: any) => {
      // Optional project filter: '/memory-export <project>' limits the export.
      const project = args?.trim() || undefined;
      const memories = manager.getAll(project);
      const suffix = project ? `-${project}` : '';
      const exportPath = path.join(
        require('os').homedir(), '.pi', 'agent', 'memory', `memory-export${suffix}.json`
      );
      fs.writeFileSync(exportPath, JSON.stringify(memories, null, 2), 'utf-8');
      ctx.ui.notify(`Exported ${memories.length} memories to ${exportPath}`, 'info');
    },
  });
}
