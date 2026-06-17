import * as path from 'path';
import * as fs from 'fs';
import * as toml from 'toml';

export function hashCwd(cwd: string): string {
  let hash = 0;
  for (let i = 0; i < cwd.length; i++) {
    hash = ((hash << 5) - hash) + cwd.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).slice(0, 12).padStart(12, '0');
}

export function loadConfig(): any {
  const configPath = path.join(require('os').homedir(), '.pi', 'agent', 'memory', 'config.toml');
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return toml.parse(raw);
  } catch {
    return {};
  }
}

export function getMemoryDir(): string {
  return path.join(require('os').homedir(), '.pi', 'agent', 'memory');
}

export function initConfigIfMissing(): void {
  const dir = getMemoryDir();
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, 'config.toml');
  if (!fs.existsSync(configPath)) {
    const defaultConfig = `[memory]
l1_token_budget = 1500
l2_token_budget = 800

[consolidation]
auto_consolidate_on_end = true
min_interval_minutes = 30
merge_similarity_threshold = 0.6
promote_min_sessions = 3
decay_days = 30
archive_days = 90
max_sessions_per_consolidation = 10

[search]
bm25_k1 = 1.5
bm25_b = 0.75
max_results = 20
jieba_path = ""
`;
    fs.writeFileSync(configPath, defaultConfig, 'utf-8');
  }
}
