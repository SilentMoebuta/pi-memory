import { MemoryManager } from '../memory/memoryManager';
import * as fs from 'fs';
import * as path from 'path';

export function registerMemoryExportCommand(pi: any, manager: MemoryManager) {
  pi.registerCommand('memory-export', {
    description: 'Export all memories as JSON for backup/migration',
    handler: async (_args: string, ctx: any) => {
      const memories = manager.getAll();
      const exportPath = path.join(
        require('os').homedir(), '.pi', 'agent', 'memory', 'memory-export.json'
      );
      fs.writeFileSync(exportPath, JSON.stringify(memories, null, 2), 'utf-8');
      ctx.ui.notify(`Exported ${memories.length} memories to ${exportPath}`, 'info');
    },
  });
}
