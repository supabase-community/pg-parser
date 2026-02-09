import type { PgParser } from '../pg-parser.js';
import { unwrapDeparseResult } from '../util.js';
import type {
  FindContext,
  Node,
  NodeOfType,
  NodeTypeName,
  ParseResult,
  Predicate,
} from './types.js';
import type { BuilderFor } from './builders/index.js';
import { rawFind, rawTransform } from './traverse.js';

/**
 * Pluggable builder factory — set by builders/index.ts to break circular deps.
 * Maps a node type name + unwrapped node → typed AstQuery subclass.
 */
let builderFactory: (
  typeName: string,
  inner: unknown,
  parser?: PgParser
) => AstQuery = (_, inner, parser) => new AstQuery(inner, parser);

/**
 * Register the builder factory. Called once from builders/index.ts.
 * @internal
 */
export function setBuilderFactory(
  fn: typeof builderFactory
): void {
  builderFactory = fn;
}

/**
 * Base class for all AST query/builder objects.
 *
 * Wraps an unwrapped AST node and provides traversal, transformation,
 * and deparsing capabilities.
 */
export class AstQuery<T = unknown> {
  readonly #inner: T;
  readonly #parser?: PgParser;

  /**
   * The statement type name for wrapping back into a Node envelope.
   * Set by builder subclasses (e.g., 'SelectStmt', 'UpdateStmt').
   * @internal
   */
  protected _stmtType?: string;

  constructor(inner: T, parser?: PgParser) {
    this.#inner = inner;
    this.#parser = parser;
  }

  /**
   * The unwrapped AST node (sync in Phase 1).
   */
  get node(): T {
    return this.#inner;
  }

  /**
   * Access the bound parser (if any).
   * @internal Used by subclasses.
   */
  protected get parser(): PgParser | undefined {
    return this.#parser;
  }

  /**
   * Create a new AstQuery of the same type with a different inner node.
   * Subclasses override to return their own type.
   * @internal
   */
  protected _clone(inner: T): this {
    return new AstQuery(inner, this.#parser) as this;
  }

  /**
   * Find the first node of a given type, optionally matching a predicate.
   * Returns a detached builder — modifications don't flow back to the original tree.
   */
  find<U extends NodeTypeName>(
    type: U,
    predicate?: Predicate<NodeOfType<U>>
  ): BuilderFor<U> | undefined {
    const results = rawFind<NodeOfType<U>>(this.#inner, type, predicate);
    if (results.length === 0) return undefined;
    return builderFactory(type, results[0]!.node, this.#parser) as BuilderFor<U>;
  }

  /**
   * Find all nodes of a given type, optionally matching a predicate.
   * Returns detached builders.
   */
  findAll<U extends NodeTypeName>(
    type: U,
    predicate?: Predicate<NodeOfType<U>>
  ): BuilderFor<U>[] {
    return rawFind<NodeOfType<U>>(this.#inner, type, predicate).map(
      (r) => builderFactory(type, r.node, this.#parser) as BuilderFor<U>
    );
  }

  /**
   * Transform the first node of a given type.
   *
   * The callback receives a typed builder and should return a modified builder.
   * The rest of the tree is preserved.
   */
  transform<U extends NodeTypeName>(
    type: U,
    fn: (builder: BuilderFor<U>) => AstQuery<NodeOfType<U>>
  ): this;
  transform<U extends NodeTypeName>(
    type: U,
    predicate: Predicate<NodeOfType<U>>,
    fn: (builder: BuilderFor<U>) => AstQuery<NodeOfType<U>>
  ): this;
  transform<U extends NodeTypeName>(
    type: U,
    fnOrPredicate:
      | ((builder: BuilderFor<U>) => AstQuery<NodeOfType<U>>)
      | Predicate<NodeOfType<U>>,
    maybeFn?: (builder: BuilderFor<U>) => AstQuery<NodeOfType<U>>
  ): this {
    const predicate = maybeFn
      ? (fnOrPredicate as Predicate<NodeOfType<U>>)
      : undefined;
    const fn = (maybeFn ?? fnOrPredicate) as (
      builder: BuilderFor<U>
    ) => AstQuery<NodeOfType<U>>;

    const transformed = rawTransform(
      this.#inner,
      type,
      (_wrapped: Node, inner: unknown) => {
        const builder = builderFactory(type, inner, this.#parser) as BuilderFor<U>;
        return { [type]: fn(builder).node } as unknown as Node;
      },
      predicate as Predicate<unknown> | undefined,
      true
    );

    return this._clone(transformed as T);
  }

  /**
   * Transform all nodes of a given type. Same as transform but applies to every match.
   */
  transformAll<U extends NodeTypeName>(
    type: U,
    fn: (builder: BuilderFor<U>) => AstQuery<NodeOfType<U>>
  ): this;
  transformAll<U extends NodeTypeName>(
    type: U,
    predicate: Predicate<NodeOfType<U>>,
    fn: (builder: BuilderFor<U>) => AstQuery<NodeOfType<U>>
  ): this;
  transformAll<U extends NodeTypeName>(
    type: U,
    fnOrPredicate:
      | ((builder: BuilderFor<U>) => AstQuery<NodeOfType<U>>)
      | Predicate<NodeOfType<U>>,
    maybeFn?: (builder: BuilderFor<U>) => AstQuery<NodeOfType<U>>
  ): this {
    const predicate = maybeFn
      ? (fnOrPredicate as Predicate<NodeOfType<U>>)
      : undefined;
    const fn = (maybeFn ?? fnOrPredicate) as (
      builder: BuilderFor<U>
    ) => AstQuery<NodeOfType<U>>;

    const transformed = rawTransform(
      this.#inner,
      type,
      (_wrapped: Node, inner: unknown) => {
        const builder = builderFactory(type, inner, this.#parser) as BuilderFor<U>;
        return { [type]: fn(builder).node } as unknown as Node;
      },
      predicate as Predicate<unknown> | undefined,
      false
    );

    return this._clone(transformed as T);
  }

  /**
   * Check if a node of the given type exists, optionally matching a predicate.
   */
  has<U extends NodeTypeName>(
    type: U,
    predicate?: Predicate<NodeOfType<U>>
  ): boolean {
    return rawFind<NodeOfType<U>>(this.#inner, type, predicate).length > 0;
  }

  /**
   * Shallow-merge fields into the inner node. Returns a new builder.
   */
  patch(fields: Partial<T>): this {
    return this._clone({ ...this.#inner, ...fields });
  }

  /**
   * Deparse the AST back to a SQL string.
   *
   * Requires a parser instance (either bound via createAstTools or passed directly).
   */
  async toSQL(parser?: PgParser): Promise<string> {
    const p = parser ?? this.#parser;
    if (!p) {
      throw new Error(
        'toSQL() requires a PgParser instance. Use createAstTools(parser) or pass parser directly.'
      );
    }

    const parseResult = this.#toParseResult();
    return unwrapDeparseResult(p.deparse(parseResult as ParseResult));
  }

  /**
   * Wrap the inner node in a ParseResult envelope for deparsing.
   */
  #toParseResult(): ParseResult {
    const inner = this.#inner as Record<string, unknown>;

    // Already a ParseResult
    if ('stmts' in inner) {
      return inner as unknown as ParseResult;
    }

    // Wrap in ParseResult → RawStmt → Node
    // Detect the node type name by checking known statement fields
    const wrappedStmt = this.#wrapAsNode(inner);

    return {
      version: 170004,
      stmts: [{ stmt: wrappedStmt }],
    };
  }

  /**
   * Wrap an unwrapped inner node back into its Node envelope.
   */
  #wrapAsNode(inner: Record<string, unknown>): Node {
    // Prefer explicit type from builder subclass
    if (this._stmtType) {
      return { [this._stmtType]: inner } as unknown as Node;
    }

    // Fallback: detect from field patterns (for generic AstQuery usage)
    if ('tableElts' in inner) {
      return { CreateStmt: inner } as unknown as Node;
    }
    if ('cmds' in inner) {
      return { AlterTableStmt: inner } as unknown as Node;
    }
    if ('idxname' in inner || 'indexParams' in inner) {
      return { IndexStmt: inner } as unknown as Node;
    }
    if ('relation' in inner && 'cols' in inner) {
      return { InsertStmt: inner } as unknown as Node;
    }
    if ('relation' in inner && ('usingClause' in inner || 'whereClause' in inner) && !('targetList' in inner)) {
      return { DeleteStmt: inner } as unknown as Node;
    }
    if ('relation' in inner && 'targetList' in inner) {
      return { UpdateStmt: inner } as unknown as Node;
    }
    if ('targetList' in inner || 'fromClause' in inner || 'op' in inner) {
      return { SelectStmt: inner } as unknown as Node;
    }

    throw new Error(
      'Cannot determine node type for deparsing. Use query() to wrap known AST types.'
    );
  }
}
