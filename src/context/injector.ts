import { MemoryManager } from '../memory/memoryManager';
import { MemoryStats } from '../types';
import { loadConfig } from '../utils';

export class ContextInjector {
  private injected = false;
  private l1Budget: number;
  private l2Budget: number;

  constructor(
    private manager: MemoryManager,
    l1Budget?: number,
    l2Budget?: number,
  ) {
    // Prefer config.toml values; fall back to constructor arg then defaults.
    const config = loadConfig();
    this.l1Budget = l1Budget ?? config?.memory?.l1_token_budget ?? 1500;
    this.l2Budget = l2Budget ?? config?.memory?.l2_token_budget ?? 800;
  }

  buildContext(project: string): string {
    if (this.injected) return '';
    this.injected = true;

    const parts: string[] = [];
    const stats = this.manager.getStats(project);

    const l1 = this._buildL1(project, stats);
    if (l1) parts.push(l1);

    const l2 = this._buildL2(project);
    if (l2) parts.push(l2);

    return parts.join('\n\n');
  }

  reset(): void {
    this.injected = false;
  }

  private _buildL1(project: string, stats: MemoryStats): string {
    const lines: string[] = [
      '## Memory (auto-generated)',
      '',
      `Project: ${project}`,
      `Total memories: ${stats.total} (active: ${stats.byStatus['active'] || 0})`,
    ];

    const topFacts = this.manager.search('', { project, limit: 10 });
    const activeFacts = topFacts.filter(r => r.memory.status === 'active');
    if (activeFacts.length > 0) {
      lines.push('');
      lines.push('### Key Knowledge');
      for (const r of activeFacts.slice(0, 8)) {
        lines.push(`- [${r.memory.type}] ${r.memory.content}`);
      }
    }

    const result = lines.join('\n');
    if (result.length > this.l1Budget * 4) {
      return result.slice(0, this.l1Budget * 4) + '\n...';
    }
    return result;
  }

  private _buildL2(project: string): string {
    const recent = this.manager.search('', { project, limit: 5, status: 'active' });
    if (recent.length === 0) return '';
    const lines = ['### Recent Session Context'];
    for (const r of recent.slice(0, 3)) {
      lines.push(`- ${r.memory.content}`);
    }
    const result = lines.join('\n');
    if (result.length > this.l2Budget * 4) {
      return result.slice(0, this.l2Budget * 4) + '\n...';
    }
    return result;
  }
}
