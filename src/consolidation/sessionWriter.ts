import * as fs from 'fs';
import * as path from 'path';

export interface SessionSummary {
  timestamp: number;
  project: string;
  sessionId: string;
  lastResponse: string;
  toolCalls: string[];
}

export class SessionWriter {
  private memoryDir: string;

  constructor(memoryDir = path.join(require('os').homedir(), '.pi', 'agent', 'memory')) {
    this.memoryDir = memoryDir;
  }

  writeSession(summary: SessionSummary): void {
    const sessionsDir = path.join(this.memoryDir, 'sessions', summary.project);
    fs.mkdirSync(sessionsDir, { recursive: true });

    const filename = path.join(sessionsDir, `${summary.sessionId}.md`);
    const content = this._formatSession(summary);
    fs.writeFileSync(filename, content, 'utf-8');
  }

  private _formatSession(s: SessionSummary): string {
    const date = new Date(s.timestamp).toISOString();
    const lines = [
      `# Session: ${s.sessionId}`,
      `Date: ${date}`,
      `Project: ${s.project}`,
      '',
      '## Agent Response',
      s.lastResponse.slice(0, 500),
      '',
      '## Tools Used',
      s.toolCalls.length > 0 ? s.toolCalls.map(t => `- ${t}`).join('\n') : '- none',
    ];
    return lines.join('\n');
  }
}
