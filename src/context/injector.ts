/**
 * ContextInjector — P1-7 just-in-time injection.
 *
 * Research (memory_context_injection_research.md / memory_injection_p1_7_research.md):
 *  - Industry default is "分层注入": tiny常驻 (in-context) + 按需 (out-of-context tool).
 *  - pi's old "top-N facts + top-3 recent 正文常驻 ~2300 token" is the反模式.
 *  - Key mechanism = **结构性强制**: 常驻只放记忆索引(类型计数 + 引导),
 *    NOT正文. LLM wanting memory body MUST call memory_recall (already exists).
 *    This is what makes just-in-time actually fire — not prompt hints.
 *  - 常驻属 system prompt; compaction只压 messages不动常驻 (Letta/MemGPT/Claude Code一致).
 *  - RESEARCH CAVEAT: exact token budget <800 / index entries are推理需实战验证.
 */
import { MemoryManager } from '../memory/memoryManager';
import { MemoryStats } from '../types';
import { loadConfig } from '../utils';

export class ContextInjector {
  private injected = false;
  /** 常驻预算(token). 极小: 索引概要 + 引导语. RESEARCH CAVEAT: <800是推理需实战验证. */
  private readonly l1Budget: number;

  constructor(
    private manager: MemoryManager,
    l1Budget?: number,
    _l2Budget?: number, // kept for back-compat; L2 正文预取已移除(结构性强制)
  ) {
    const config = loadConfig();
    // 默认 800 token(现状 1500+800=2300 → 压到 800). 可经 config.memory.l1_token_budget 覆盖.
    this.l1Budget = l1Budget ?? config?.memory?.l1_token_budget ?? 800;
  }

  buildContext(project: string): string {
    if (this.injected) return '';
    this.injected = true;
    return this._buildL1(project);
  }

  reset(): void {
    this.injected = false;
  }

  /** L1 = 极小常驻索引块. 只含记忆索引(类型计数 + 引导), 不含正文.
   *  结构性强制: LLM 想要记忆正文必须调 memory_recall 工具按需拉. */
  private _buildL1(project: string): string {
    const stats = this.manager.getStats(project);
    if (stats.total === 0) return '';

    const lines: string[] = [
      '## Memory Index (just-in-time)',
      '',
      `Project: ${project} | Total memories: ${stats.total} (active: ${stats.byStatus['active'] || 0})`,
      '',
      '### Memory Index by Type',
    ];

    // 索引: 按类型计数(不含正文). 让 LLM 知道有什么类型的记忆可 recall.
    const byType = stats.byType || {};
    const typeEntries = Object.entries(byType)
      .filter(([, count]) => count > 0)
      .map(([type, count]) => `- ${type}: ${count} ${count === 1 ? 'entry' : 'entries'}`);
    if (typeEntries.length > 0) {
      lines.push(...typeEntries);
    } else {
      lines.push('- (no typed memories)');
    }

    // 结构性强制引导: 明确告诉 LLM 正文不在常驻, 要调 recall
    lines.push('');
    lines.push('### How to access memory content');
    lines.push('This index shows WHAT memories exist, not their content. To retrieve actual');
    lines.push('memory content, call the memory_recall tool with a query (e.g. recall "architecture');
    lines.push('decisions" or "API contracts"). Memory_recall returns full text + does not bloat');
    lines.push('this常驻 block. Use it on-demand when you need specific prior context.');

    const result = lines.join('\n');
    // 预算截断(索引本身应远小于预算, 这是安全网)
    const charBudget = this.l1Budget * 4;
    if (result.length > charBudget) {
      return result.slice(0, charBudget) + '\n...';
    }
    return result;
  }
}
