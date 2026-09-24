import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import * as reamify from '../../src/index.js';

describe('reamify', () => {
  it('exposes a public API', () => {
    expect(reamify).toBeDefined();
    expect(reamify.convert).toBeTypeOf('function');
  });

  it('keeps markdown table columns separate and ignores separators', () => {
    expect(reamify.markdownToRows('| A | B |\n| --- | --- |\n| 1 | 2 |')).toEqual([
      ['A', 'B'],
      ['1', '2'],
    ]);
  });

  it('appends browser-provided pages incrementally', async () => {
    const output = await reamify.convertPages([
      [['A', 'B']],
      [['1', '2']],
    ]);
    expect(output instanceof ArrayBuffer || Buffer.isBuffer(output)).toBe(true);
  });

  it('writes page rows to a Node stream without retaining workbook rows', async () => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on('data', (chunk: Buffer) => chunks.push(chunk));

    await reamify.convertPages([[['A']]], { stream: output });

    expect(Buffer.concat(chunks).subarray(0, 2).toString()).toBe('PK');
  });
});