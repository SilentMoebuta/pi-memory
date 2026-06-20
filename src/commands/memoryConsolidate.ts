import { MemoryManager } from '../memory/memoryManager';
import { ConsolidationEngine } from '../consolidation/engine';
import { hashCwd, loadConfig } from '../utils';
import { complete } from '@earendil-works/pi-ai';

export function registerMemoryConsolidateCommand(pi: any, manager: MemoryManager) {
  pi.registerCommand('memory-consolidate', {
    description: 'Consolidate memories: decay, merge, promote, and trigger agent extraction',
    handler: async (_args: string, ctx: any) => {
      const project = hashCwd(ctx.cwd);
      const config = loadConfig();

      // GM-9: opt-in LLM-driven merge. When llm_consolidate=true and a model is
      // available, build an llmMerge callable from ctx.model + modelRegistry
      // (mirrors pi-goal runJudge's auth+complete pattern). The engine calls it
      // for high-similarity pairs and falls back to jaccard on any error/null.
      let llmMerge: ((a: string, b: string) => Promise<string | null>) | undefined;
      if (config.consolidation?.llm_consolidate === true && ctx.model) {
        const model = ctx.model;
        llmMerge = async (a: string, b: string) => {
          try {
            const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
            if (!auth.ok) return null;
            const result = await complete(model, {
              systemPrompt: 'Merge the two memories below into one concise memory that preserves all key information. Reply with ONLY the merged memory text, no preamble or explanation.',
              messages: [{ role: 'user', content: [{ type: 'text', text: `Memory A:\n${a}\n\nMemory B:\n${b}` }], timestamp: Date.now() }],
            }, { apiKey: auth.apiKey, headers: auth.headers, temperature: 0, maxTokens: 512 });
            const text = ((result as any)?.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim();
            return text || null;
          } catch {
            return null; // graceful fallback to jaccard
          }
        };
      }

      const engine = new ConsolidationEngine(manager, { llmMerge });
      const result = await engine.consolidate(project, {
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
