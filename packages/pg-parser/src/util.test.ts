import { describe, expect, it } from 'vitest';
import type { Node } from './types/index.js';
import { assertAndUnwrapNode, assertDefined, unwrapNode } from './util.js';

describe('assertDefined', () => {
  it('should not throw when value is defined', () => {
    const value = 'some value';
    expect(() => assertDefined(value, 'Value is undefined')).not.toThrow();
  });

  it('should throw an error when value is undefined', () => {
    const value = undefined;
    expect(() => assertDefined(value, 'Value is undefined')).toThrow(
      'Value is undefined'
    );
  });

  it('should narrow the type after assertion', () => {
    const maybeString = 'test string' as string | undefined;
    assertDefined(maybeString, 'String is undefined');

    // This will produce a type error if the type was not narrowed
    expect(maybeString.length).toBe(11);
  });
});

describe('unwrapNode', () => {
  it('should unwrap a node with a single key', () => {
    const mockNode = {
      SelectStmt: {},
    } as Node;

    const result = unwrapNode(mockNode);

    expect(result).toEqual({
      type: 'SelectStmt',
      node: {},
    });
  });

  it('should throw an error if the node has no keys', () => {
    const emptyNode = {} as Node;

    expect(() => unwrapNode(emptyNode)).toThrow(
      'node has no keys, expected a single key'
    );
  });

  it('should throw an error if the node has multiple keys', () => {
    const multiKeyNode = {
      SelectStmt: {},
      InsertStmt: {},
    } as Node;

    expect(() => unwrapNode(multiKeyNode)).toThrow(
      'node has multiple keys, expected a single key: SelectStmt, InsertStmt'
    );
  });

  it('should handle different node types', () => {
    const insertNode = {
      InsertStmt: {
        relation: { relname: 'test' },
        cols: [],
      },
    } as Node;

    const result = unwrapNode(insertNode);

    expect(result.type).toBe('InsertStmt');
    expect(result.node).toEqual({
      relation: { relname: 'test' },
      cols: [],
    });
  });

  it('should narrow the node type', () => {
    const updateNode = {
      UpdateStmt: {
        relation: { relname: 'test' },
        targetList: [],
      },
    } as Node;
    const result = unwrapNode(updateNode);

    if (result.type !== 'UpdateStmt') {
      throw new Error('Expected UpdateStmt type');
    }

    // This will produce a type error if the type was not narrowed
    expect(result.node.relation).toEqual({ relname: 'test' });
  });
});

describe('assertAndUnwrapNode', () => {
  it('should unwrap a node when it matches the expected type', () => {
    const mockNode = {
      SelectStmt: { targetList: [] },
    } as Node;

    const result = assertAndUnwrapNode(mockNode, 'SelectStmt');

    expect(result).toEqual({ targetList: [] });
  });

  it('should throw an error if the node type does not match expected type', () => {
    const mockNode = {
      InsertStmt: { relation: { relname: 'test' } },
    } as Node;

    expect(() => assertAndUnwrapNode(mockNode, 'SelectStmt')).toThrow(
      'expected node of type SelectStmt, got InsertStmt'
    );
  });

  it('should use a custom error message if provided', () => {
    const mockNode = {
      UpdateStmt: { targetList: [] },
    } as Node;

    expect(() =>
      assertAndUnwrapNode(mockNode, 'DeleteStmt', 'Custom error message')
    ).toThrow('Custom error message');
  });
});
