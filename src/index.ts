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

let db: Database | null = null;
let manager: MemoryManager | null = null;
let injector: ContextInjector | null = null;
let sessionWriter: SessionWriter | null = null;

export default async function piMemoryExtension(pi: any) {
  // ---- Initialize ----
  const memoryDir = path.join(require('os').homedir(), '.pi', 'agent', 'memory');
  fs.mkdirSync(memoryDir, { recursive: true });
  initConfigIfMissing();

  const dbPath = path.join(memoryDir, 'agent.db');
  const SQL = await initSqlJs();

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

    // Save database to disk (atomic: write temp then rename, so a crash
    // mid-write cannot corrupt the existing db and lose all memories).
    if (db) {
      try {
        const data = db.export();
        const buffer = Buffer.from(data);
        const tmpPath = dbPath + '.tmp';
        fs.writeFileSync(tmpPath, buffer);
        fs.renameSync(tmpPath, dbPath);
      } catch (err) {
        console.error('[pi-memory] database persist failed:', err);
      }
    }

    // Reset injection state
    injectedInThisSession = false;
    if (injector) injector.reset();
  });
}
