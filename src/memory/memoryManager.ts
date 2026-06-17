import { Database } from 'sql.js';
import { v4 as uuidv4 } from 'uuid';
import { Memory, MemoryInput, MemoryStatus, SearchOptions, SearchResult, RecallResult, MemoryStats, ConsolidationResult } from '../types';
import { BM25Index } from './search';

export class MemoryManager {
  constructor(private db: Database) {}

  write(input: MemoryInput): Memory {
    const id = uuidv4();
    const now = Date.now();
    this.db.run(
      `INSERT INTO memories (id, type, content, confidence, access_count, created_at, session_id, project, source, status)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 'active')`,
      [id, input.type, input.content, input.confidence ?? 1.0, now, input.sessionId ?? null, input.project ?? 'default', input.source ?? 'agent']
    );
    return this.get(id)!;
  }

  get(id: string): Memory | null {
    this.db.run('UPDATE memories SET access_count = access_count + 1, last_access = ? WHERE id = ? AND status != ?',
      [Date.now(), id, 'deleted']);

    const rows = this.db.exec(
      'SELECT id, type, content, confidence, access_count, last_access, created_at, session_id, project, source, status, superseded_by FROM memories WHERE id = ?',
      [id]
    );
    if (!rows.length || !rows[0].values.length) return null;

    const row = rows[0].values[0];
    return this._rowToMemory(row);
  }

  forget(id: string): boolean {
    const existing = this.get(id);
    if (!existing) return false;
    this.db.run('UPDATE memories SET status = ? WHERE id = ?', ['deleted', id]);
    return true;
  }

  // Public DB access methods (for consolidation engine)
  runSql(sql: string, params?: any[]): void {
    if (params) this.db.run(sql, params);
    else this.db.run(sql);
  }

  execSql(sql: string, params?: any[]): any {
    return this.db.exec(sql, params);
  }

  search(query: string, opts?: SearchOptions): SearchResult[] {
    const memories = this.getAll(opts?.project, opts?.status);
    if (memories.length === 0) return [];

    const docs = memories.map(m => m.content);
    const index = new BM25Index();
    index.addDocuments(docs);

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
  consolidate(project: string): ConsolidationResult {
    throw new Error('consolidate not yet implemented');
  }
  getAll(project?: string, status?: MemoryStatus): Memory[] {
    let sql = 'SELECT id, type, content, confidence, access_count, last_access, created_at, session_id, project, source, status, superseded_by FROM memories WHERE status != ?';
    const params: any[] = ['deleted'];
    if (project) { sql += ' AND project = ?'; params.push(project); }
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
    };
  }
}
