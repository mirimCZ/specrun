import { describe, expect, it } from 'vitest';
import { nodeIdOf } from './featureSchema.js';
import { definedNodes, mermaidBlocks } from './mermaidNodes.js';

describe('mermaidBlocks', () => {
  it('returns the contents of every mermaid block and skips other fences', () => {
    const markdown = [
      '# Map',
      '```mermaid',
      'flowchart TD',
      '  a[A]',
      '```',
      '```ts',
      'const b = 1;',
      '```',
      '```mermaid',
      'flowchart LR',
      '```',
    ].join('\n');
    expect(mermaidBlocks(markdown)).toEqual(['flowchart TD\n  a[A]', 'flowchart LR']);
  });

  it('returns nothing for a document without mermaid', () => {
    expect(mermaidBlocks('# Map\n\nText.\n')).toEqual([]);
  });
});

describe('definedNodes', () => {
  it('finds all six shapes', () => {
    const block = [
      'rect[Rect]',
      'round(Round)',
      'rhombus{Rhombus}',
      'stadium([Stadium])',
      'sub[[Subroutine]]',
      'flag>Flag]',
    ].join('\n');
    expect(definedNodes(block)).toEqual(['rect', 'round', 'rhombus', 'stadium', 'sub', 'flag']);
  });

  it('finds nodes defined inside edge lines', () => {
    expect(definedNodes('a[A] --> b(B)\nc{C} -.->|uses| d([D])')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not count plain ids in edges or text inside labels', () => {
    const block = [
      'a[A]',
      'a --> b',
      'b --- c',
      'a -->|calls x[y]| c',
      'e["has f(g) inside"]',
    ].join('\n');
    expect(definedNodes(block)).toEqual(['a', 'e']);
  });

  it('ignores keyword lines and %% comments', () => {
    const block = [
      'flowchart TD',
      'graph LR',
      '%% old[Old]',
      'subgraph board [Board]',
      '  board_cells[Cells]',
      'end',
      'classDef hot fill:#f00',
      'class board_cells hot',
      'style board_cells fill:#0f0',
      'click board_cells "https://example.com"',
      'linkStyle 0 stroke:#ff3',
      'end_node[End node]',
    ].join('\n');
    expect(definedNodes(block)).toEqual(['board_cells', 'end_node']);
  });

  it('lists a node defined twice once', () => {
    expect(definedNodes('a[A]\na[A again] --> b[B]')).toEqual(['a', 'b']);
  });

  it('counts nodes across several blocks', () => {
    const markdown = '```mermaid\nflowchart TD\na[A]\n```\n\n```mermaid\nflowchart TD\nb[B]\n```\n';
    const blocks = mermaidBlocks(markdown);
    expect(blocks).toHaveLength(2);
    expect(blocks.flatMap(definedNodes)).toEqual(['a', 'b']);
  });
});

describe('nodeIdOf', () => {
  it('replaces / and - with _', () => {
    expect(nodeIdOf('board/fog-cells')).toBe('board_fog_cells');
  });
});
