import { MemoryManager } from '../memory/memoryManager';
import { ConsolidationResult } from '../types';
import { tokenize } from '../memory/search';
import * as fs from 'fs';
import * as path from 'path';

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  const intersection = [...setA].filter(x => setB.has(x)).length;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export class ConsolidationEngine {
  constructor(private manager: MemoryManager, private opts?: { llmMerge?: (a: string, b: string) => Promise<string | null> }) {}

  runDecay(project: string, decayDays: number, archiveDays: number): Pick<ConsolidationResult, 'decayed' | 'archived'> {
    const now = Date.now();
    const decayThreshold = now - decayDays * 24 * 60 * 60 * 1000;
    const archiveThreshold = now - archiveDays * 24 * 60 * 60 * 1000;

    const archives = this.manager.getAll(project, 'active').filter(m =>
      m.createdAt < archiveThreshold &&
      (m.lastAccess === null || m.lastAccess < archiveThreshold)
    );

    let archived = 0;
    for (const m of archives) {
      this.manager.runSql('UPDATE memories SET status = ? WHERE id = ?', ['archived', m.id]);
      archived++;
    }

    const toDecay = this.manager.getAll(project, 'active').filter(m =>
      m.createdAt < decayThreshold && m.createdAt >= archiveThreshold
    );

    let decayed = 0;
    for (const m of toDecay) {
      const newConf = Math.max(0.1, m.confidence * 0.8);
      this.manager.runSql('UPDATE memories SET confidence = ? WHERE id = ?', [newConf, m.id]);
      decayed++;
    }

    return { decayed, archived };
  }

  async runMerge(project: string, threshold: number): Promise<Pick<ConsolidationResult, 'merged'>> {
    const memories = this.manager.getAll(project, 'active');
    if (memories.length < 2) return { merged: 0 };

    const byType: Map<string, typeof memories> = new Map();
    for (const m of memories) {
      const group = byType.get(m.type) || [];
      group.push(m);
      byType.set(m.type, group);
    }

    let merged = 0;
    for (const [, group] of byType) {
      const toMerge = new Set<string>();
      for (let i = 0; i < group.length; i++) {
        if (toMerge.has(group[i].id)) continue;
        for (let j = i + 1; j < group.length; j++) {
          if (toMerge.has(group[j].id)) continue;
          const sim = jaccardSimilarity(group[i].content, group[j].content);
          if (sim >= threshold) {
            const [keeper, remove] = group[i].confidence >= group[j].confidence
              ? [group[i], group[j]] : [group[j], group[i]];
            this.manager.runSql(
              'UPDATE memories SET access_count = access_count + ?, confidence = MAX(confidence, ?) WHERE id = ?',
              [remove.accessCount, remove.confidence, keeper.id]
            );
            this.manager.runSql(
              'UPDATE memories SET status = ?, superseded_by = ?, valid_to = ? WHERE id = ?',
              ['superseded', keeper.id, Date.now(), remove.id]
            );
            // GM-9: opt-in LLM-driven merge — propose merged content for the
            // keeper. On throw / null / empty, gracefully fall back to the
            // keeper content unchanged above (no crash, no data loss).
            if (this.opts?.llmMerge) {
              try {
                const mergedContent = await this.opts.llmMerge(keeper.content, remove.content);
                if (typeof mergedContent === 'string' && mergedContent.length > 0) {
                  this.manager.runSql('UPDATE memories SET content = ? WHERE id = ?', [mergedContent, keeper.id]);
                }
              } catch { /* graceful fallback: keeper content unchanged */ }
            }
            toMerge.add(remove.id);
            merged++;
          }
        }
      }
    }
    return { merged };
  }

  runPromote(minSessions: number): Pick<ConsolidationResult, 'promoted'> {
    const allActive = this.manager.getAll(undefined, 'active');
    let promoted = 0;
    for (const m of allActive) {
      if (m.accessCount >= minSessions && m.source === 'agent') {
        this.manager.runSql('UPDATE memories SET confidence = MIN(confidence + 0.2, 2.0) WHERE id = ?', [m.id]);
        promoted++;
      }
    }
    return { promoted };
  }

  async consolidate(project: string, config: { decayDays: number; archiveDays: number; mergeThreshold: number; promoteMinSessions: number }): Promise<ConsolidationResult> {
    const { decayed, archived } = this.runDecay(project, config.decayDays, config.archiveDays);
    const { merged } = await this.runMerge(project, config.mergeThreshold);
    const { promoted } = this.runPromote(config.promoteMinSessions);

    this.manager.runSql(
      'INSERT OR REPLACE INTO consolidation_cursor (project, last_processed_at) VALUES (?, ?)',
      [project, Date.now()]
    );

    return { decayed, archived, merged, promoted, reindexed: true };
  }

  regenL1Index(project: string): void {
    const top = this.manager.search('', { project, limit: 20 });
    const active = top.filter(r => r.memory.status === 'active');
    const lines = [
      '# Memory (auto-generated)',
      `Generated: ${new Date().toISOString()}`,
      `Project: ${project}`,
      '',
    ];
    for (const r of active) {
      lines.push(`- [${r.memory.type}] ${r.memory.content}`);
    }
    const dir = path.join(require('os').homedir(), '.pi', 'agent', 'memory');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'MEMORY.md'), lines.join('\n'), 'utf-8');
  }
}
