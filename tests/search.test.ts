import { describe, it, expect } from 'vitest';
import { tokenize, BM25Index } from '../src/memory/search';

describe('tokenize', () => {
  it('should split English text into lowercase words', () => {
    const tokens = tokenize('The Project uses TypeScript');
    expect(tokens).toContain('the');
    expect(tokens).toContain('project');
    expect(tokens).toContain('typescript');
  });

  it('should produce Chinese bigrams', () => {
    const tokens = tokenize('这是一个测试');
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens).toContain('这是');
    expect(tokens).toContain('测试');
  });

  it('should handle mixed Chinese and English', () => {
    const tokens = tokenize('使用 TypeScript 编写代码');
    expect(tokens).toContain('typescript');
    expect(tokens.length).toBeGreaterThan(3);
  });

  it('should return empty array for empty input', () => {
    expect(tokenize('')).toEqual([]);
  });
});

describe('BM25Index', () => {
  it('should build index and search documents', () => {
    const docs = [
      'The project uses TypeScript with strict mode',
      'We deploy using Docker containers on AWS',
      'TypeScript configuration is in tsconfig.json',
    ];

    const index = new BM25Index();
    index.addDocuments(docs);

    const results = index.search('TypeScript');
    expect(results.length).toBe(2);
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('should rank documents by term frequency', () => {
    const docs = [
      'TypeScript TypeScript TypeScript project',
      'TypeScript project',
      'JavaScript project',
    ];

    const index = new BM25Index();
    index.addDocuments(docs);

    const results = index.search('TypeScript');
    expect(results[0].index).toBe(0);
    expect(results[1].index).toBe(1);
    expect(results.length).toBe(2);
  });

  it('should return empty for no matches', () => {
    const index = new BM25Index();
    index.addDocuments(['hello world', 'test project']);
    expect(index.search('xyznotfound')).toEqual([]);
  });
});
