import { Database } from 'sql.js';
import { v4 as uuidv4 } from 'uuid';
import { Memory, MemoryInput, MemoryStatus, SearchOptions, SearchResult, RecallResult, MemoryStats } from '../types';
import { BM25Index } from './search';

export class MemoryManager {
  // BM25 cache: rebuilt on demand, invalidated on any mutation to `memories`.
  private bm25Cache: { project: string | undefined; status: MemoryStatus | undefined; asOf: number | undefined; docs: string[]; memories: Memory[]; index: BM25Index } | null = null;

  /** Optional hook fired after any mutation that should trigger a debounced
   *  DB persist (set by the extension to durably flush writes to disk). */
  onMutation?: () => void;

  constructor(private db: Database) {}

  /** Invalidate the BM25 cache (call after any mutation to `memories`). */
  private invalidateSearchCache(): void {
    this.bm25Cache = null;
  }

  write(input: MemoryInput): Memory {
    const id = uuidv4();
    const now = Date.now();
    this.invalidateSearchCache();
    this.db.run(
      `INSERT INTO memories (id, type, content, confidence, access_count, created_at, session_id, project, source, status, valid_from)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 'active', ?)`,
      [id, input.type, input.content, input.confidence ?? 1.0, now, input.sessionId ?? null, input.project ?? 'default', input.source ?? 'agent', now]
    );
    this.onMutation?.();
    return this.get(id)!;
  }

  get(id: string): Memory | null {
    this.db.run('UPDATE memories SET access_count = access_count + 1, last_access = ? WHERE id = ? AND status != ?',
      [Date.now(), id, 'deleted']);

    const rows = this.db.exec(
      'SELECT id, type, content, confidence, access_count, last_access, created_at, session_id, project, source, status, superseded_by, valid_from, valid_to FROM memories WHERE id = ?',
      [id]
    );
    if (!rows.length || !rows[0].values.length) return null;

    const row = rows[0].values[0];
    return this._rowToMemory(row);
  }

  forget(id: string): boolean {
    const existing = this.get(id);
    if (!existing) return false;
    this.invalidateSearchCache();
    this.db.run('UPDATE memories SET status = ? WHERE id = ?', ['deleted', id]);
    this.onMutation?.();
    return true;
  }

  // Public DB access methods (for consolidation engine)
  runSql(sql: string, params?: any[]): void {
    if (params) this.db.run(sql, params);
    else this.db.run(sql);
    // Invalidate cache + trigger persist when the SQL mutates the `memories` table.
    if (/\bmemories\b/i.test(sql)) {
      this.invalidateSearchCache();
      this.onMutation?.();
    }
  }

  execSql(sql: string, params?: any[]): any {
    return this.db.exec(sql, params);
  }

  search(query: string, opts?: SearchOptions): SearchResult[] {
    // Wildcard / undefined project means "all projects" (used by regenL1Index).
    const projectFilter = opts?.project && opts.project !== '*' ? opts.project : undefined;
    let memories = this.getAll(projectFilter, opts?.status);
    // GM-7: when asOf is set, keep only memories valid at that timestamp
    // (valid_from <= asOf, valid_to NULL-or-after asOf). Omit asOf = unfiltered.
    if (opts?.asOf !== undefined) {
      memories = memories.filter(m =>
        (m.validFrom === null || m.validFrom <= opts.asOf!) &&
        (m.validTo === null || m.validTo > opts.asOf!)
      );
    }
    if (memories.length === 0) return [];

    // Empty query: BM25 gives every doc score 0 (filtered out), so skip BM25
    // and return by recency/confidence (fallback ranking).
    if (!query || query.trim().length === 0) {
      let results: SearchResult[] = memories.map(m => ({ memory: m, score: 0 }));
      if (opts?.type) {
        results = results.filter(r => r.memory.type === opts.type);
      }
      results.sort((a, b) => {
        if (b.memory.confidence !== a.memory.confidence) {
          return b.memory.confidence - a.memory.confidence;
        }
        return b.memory.createdAt - a.memory.createdAt;
      });
      const limit = opts?.limit ?? 20;
      return results.slice(0, limit);
    }

    // BM25 with caching: reuse index when project/status scope unchanged.
    const docs = memories.map(m => m.content);
    if (!this.bm25Cache || this.bm25Cache.project !== projectFilter || this.bm25Cache.status !== opts?.status || this.bm25Cache.asOf !== opts?.asOf) {
      const index = new BM25Index();
      index.addDocuments(docs);
      this.bm25Cache = { project: projectFilter, status: opts?.status, asOf: opts?.asOf, docs, memories, index };
    }
    const index = this.bm25Cache.index;

    const bm25Results = index.search(query);
    let results: SearchResult[] = bm25Results.map(r => ({
      memory: memories[r.index],
      score: r.score,
    }));

    if (opts?.type) {
      results = results.filter(r => r.memory.type === opts.type);
    }

    const limit = opts?.limit ?? 20;
    return results.slice(0, limit);
  }

  recall(query: string, project: string): RecallResult {
    const l2Results = this.search(query, { project, limit: 5 });
    const l3Results = this.search(query, { limit: 5 });
    const l3Filtered = l3Results.filter(r =>
      r.memory.project !== project || r.memory.source === 'consolidated'
    );

    const seen = new Set<string>();
    const combined: SearchResult[] = [];
    for (const r of [...l2Results, ...l3Filtered]) {
      if (!seen.has(r.memory.id)) {
        seen.add(r.memory.id);
        combined.push(r);
      }
    }
    combined.sort((a, b) => b.score - a.score);

    return {
      l2Results,
      l3Results: l3Filtered,
      combined: combined.slice(0, 10),
    };
  }

  getStats(project?: string): MemoryStats {
    const params: any[] = ['deleted'];
    let projectFilter = '';
    if (project) {
      projectFilter = ' AND project = ?';
      params.push(project);
    }

    const totalRow = this.db.exec(
      `SELECT COUNT(*) FROM memories WHERE status != ?${projectFilter}`, params
    );
    const total = (totalRow[0]?.values[0][0] as number) || 0;

    const typeRow = this.db.exec(
      `SELECT type, COUNT(*) FROM memories WHERE status != ?${projectFilter} GROUP BY type`, params
    );
    const byType: Record<string, number> = {};
    if (typeRow.length) {
      for (const row of typeRow[0].values) {
        byType[row[0] as string] = row[1] as number;
      }
    }

    const statusRow = this.db.exec(
      `SELECT status, COUNT(*) FROM memories WHERE status != 'deleted'${projectFilter} GROUP BY status`,
      project ? [project] : []
    );
    const byStatus: Record<string, number> = {};
    if (statusRow.length) {
      for (const row of statusRow[0].values) {
        byStatus[row[0] as string] = row[1] as number;
      }
    }

    const projectRow = this.db.exec(
      `SELECT project, COUNT(*) FROM memories WHERE status != 'deleted' GROUP BY project`, []
    );
    const byProject: Record<string, number> = {};
    if (projectRow.length) {
      for (const row of projectRow[0].values) {
        byProject[row[0] as string] = row[1] as number;
      }
    }

    const avgParams: any[] = [];
    if (project) avgParams.push(project);
    const avgConfRow = this.db.exec(
      `SELECT AVG(confidence) FROM memories WHERE status = 'active'${projectFilter}`, avgParams
    );
    const avgConfidence = (avgConfRow[0]?.values[0][0] as number) || 0;

    const lastConsRow = this.db.exec(
      `SELECT MAX(last_processed_at) FROM consolidation_cursor${project ? ' WHERE project = ?' : ''}`,
      project ? [project] : []
    );
    const lastConsolidation = (lastConsRow[0]?.values[0][0] as number) || null;

    return {
      total,
      byType: byType as any,
      byStatus: byStatus as any,
      byProject,
      lastConsolidation,
      avgConfidence,
    };
  }
  getAll(project?: string, status?: MemoryStatus): Memory[] {
    // Wildcard '*' means all projects (used by regenL1Index / context injection).
    const effectiveProject = project && project !== '*' ? project : undefined;
    let sql = 'SELECT id, type, content, confidence, access_count, last_access, created_at, session_id, project, source, status, superseded_by, valid_from, valid_to FROM memories WHERE status != ?';
    const params: any[] = ['deleted'];
    if (effectiveProject) { sql += ' AND project = ?'; params.push(effectiveProject); }
    if (status) { sql += ' AND status = ?'; params.push(status); }
    const rows = this.db.exec(sql, params);
    if (!rows.length) return [];
    return rows[0].values.map((row: any[]) => this._rowToMemory(row));
  }

  private _rowToMemory(row: any[]): Memory {
    return {
      id: row[0], type: row[1], content: row[2],
      confidence: row[3], accessCount: row[4],
      lastAccess: row[5], createdAt: row[6],
      sessionId: row[7], project: row[8],
      source: row[9], status: row[10],
      supersededBy: row[11],
      validFrom: row[12] ?? null,
      validTo: row[13] ?? null,
    };
  }
}
