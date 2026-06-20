import initSqlJs, { Database } from 'sql.js';
import * as path from 'path';
import * as fs from 'fs';
import { MemoryManager } from './memory/memoryManager';
import { CREATE_TABLES, INIT_VERSION } from './memory/schema';
import { ContextInjector } from './context/injector';
import { SessionWriter } from './consolidation/sessionWriter';
import { ConsolidationEngine } from './consolidation/engine';
import { hashCwd, loadConfig, initConfigIfMissing } from './utils';
import { registerWriteTool } from './tools/write';
import { registerSearchTool } from './tools/search';
import { registerRecallTool } from './tools/recall';
import { registerForgetTool } from './tools/forget';
import { registerStatusTool } from './tools/status';
import { registerMemoryStatusCommand } from './commands/memoryStatus';
import { registerMemoryConsolidateCommand } from './commands/memoryConsolidate';
import { registerMemoryExportCommand } from './commands/memoryExport';
import { persistDatabase, createDebouncedFlush, acquireLock, releaseLock } from './persist';

let db: Database | null = null;
let manager: MemoryManager | null = null;
let injector: ContextInjector | null = null;
let sessionWriter: SessionWriter | null = null;
let dbLock: ReturnType<typeof acquireLock> | null = null;
let readOnly = false;

export default async function piMemoryExtension(pi: any) {
  // ---- Initialize ----
  const memoryDir = path.join(require('os').homedir(), '.pi', 'agent', 'memory');
  fs.mkdirSync(memoryDir, { recursive: true });
  initConfigIfMissing();

  const dbPath = path.join(memoryDir, 'agent.db');
  const SQL = await initSqlJs();

  // GM-13: acquire an exclusive lockfile before opening the DB. If another
  // live pi process already holds it, switch this session to READ-ONLY so its
  // flushes cannot clobber the holder's DB (the documented last-writer-wins
  // data-loss class). A stale lock from a crashed holder is auto-stolen.
  dbLock = acquireLock(dbPath + '.lock');
  readOnly = !dbLock.acquired;
  if (readOnly) {
    console.warn(
      '[pi-memory] Another live writer holds the DB lock at ' + dbPath + '.lock — ' +
      'running READ-ONLY this session: writes will NOT be persisted, to avoid ' +
      'clobbering the holder. (GM-13)'
    );
  }

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(CREATE_TABLES);
  db.run(INIT_VERSION);

  manager = new MemoryManager(db);
  injector = new ContextInjector(manager);
  sessionWriter = new SessionWriter(memoryDir);

  // ---- Durable persistence: debounced flush after every mutation ----
  // sql.js is an in-memory DB; without per-mutation flushing, every write
  // since the last clean session_shutdown is lost on a crash/SIGKILL. The
  // flusher debounces rapid mutations into one atomic temp+fsync+rename
  // write, and session_shutdown does a final immediate flush.
  const getDb = () => db;
  const flusher = createDebouncedFlush(() => {
    if (readOnly) return; // GM-13: second writer must not clobber the holder
    const current = getDb();
    if (current) persistDatabase(() => Buffer.from(current.export()), dbPath);
  });
  manager.onMutation = () => {
    if (!readOnly) flusher.schedule();
  };

  // ---- Register tools ----
  registerWriteTool(pi, manager);
  registerSearchTool(pi, manager);
  registerRecallTool(pi, manager);
  registerForgetTool(pi, manager);
  registerStatusTool(pi, manager);

  // ---- Register commands ----
  registerMemoryStatusCommand(pi, manager);
  registerMemoryConsolidateCommand(pi, manager);
  registerMemoryExportCommand(pi, manager);

  // ---- Hooks ----
  let injectedInThisSession = false;

  pi.on('before_agent_start', async (event: any, ctx: any) => {
    if (injectedInThisSession || !injector) return event;
    injectedInThisSession = true;

    const project = hashCwd(ctx.cwd);
    const context = injector.buildContext(project);

    if (context) {
      return {
        systemPrompt: (event.systemPrompt || '') + '\n\n' + context,
      };
    }
    return event;
  });

  pi.on('agent_end', async (event: any, ctx: any) => {
    if (!sessionWriter || !manager) return;

    // Belt-and-suspenders: flush any pending mutations so a crash after
    // agent_end (but before session_shutdown) still persists this turn's
    // writes. Debounced — coalesces with mutation-triggered flushes.
    // GM-13: skipped when read-only (second writer).
    if (!readOnly) flusher.schedule();

    const project = hashCwd(ctx.cwd);

    // ---- Auto-consolidate: lightweight decay if interval exceeded ----
    const config = loadConfig();
    if (config.consolidation?.auto_consolidate_on_end !== false) {
      try {
        const rows = manager.execSql(
          'SELECT last_processed_at FROM consolidation_cursor WHERE project = ?', [project]
        );
        const lastCons = (rows?.[0]?.values?.[0]?.[0] as number) || 0;
        const intervalMs = (config.consolidation?.min_interval_minutes ?? 30) * 60 * 1000;
        if (Date.now() - lastCons > intervalMs) {
          const engine = new ConsolidationEngine(manager);
          engine.runDecay(project, config.consolidation?.decay_days ?? 30, config.consolidation?.archive_days ?? 90);
        }
      } catch (err) {
        console.error('[pi-memory] auto-consolidation failed:', err);
      }
    }

    const sessionId = ctx.sessionManager?.getCurrentSessionId?.() || Date.now().toString();

    const messages = event.messages || [];
    const lastAssistant = [...messages].reverse().find((m: any) => m.role === 'assistant');
    const lastResponse = lastAssistant?.content
      ?.filter((c: any) => c.type === 'text')
      ?.map((c: any) => c.text)
      ?.join('\n')
      ?.slice(0, 500) || '';

    const toolCalls: string[] = [];
    for (const m of messages) {
      if (m.role === 'assistant' && m.content) {
        for (const c of m.content) {
          if (c.type === 'tool_use') toolCalls.push(c.name);
        }
      }
    }

    sessionWriter.writeSession({
      timestamp: Date.now(),
      project,
      sessionId,
      lastResponse,
      toolCalls,
    });
  });

  pi.on('session_shutdown', async () => {
    // Regen L1 index before shutdown
    if (manager) {
      try {
        const engine = new ConsolidationEngine(manager);
        engine.regenL1Index('*');
      } catch (err) {
        console.error('[pi-memory] L1 index regen failed:', err);
      }
    }

    // Final immediate flush: cancel any pending debounced timer and write
    // the DB to disk now (atomic temp + fsync + unique-tmp rename).
    // GM-13: skipped when read-only; instead release the lock (if we held it).
    if (!readOnly) flusher.flushNow();
    if (dbLock) releaseLock(dbLock);

    // Reset injection state
    injectedInThisSession = false;
    if (injector) injector.reset();
  });
}
