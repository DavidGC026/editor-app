// ── When-clause evaluator ───────────────────────────────────────────────
//
// Parses the subset of VS Code's `when`-clause grammar that declarative
// contributions need: bare context keys, `!`, `&&`, `||`, `==`, `!=` and
// parentheses, with string/number/boolean literals. Operator precedence
// matches VS Code: `!` > `==`/`!=` > `&&` > `||`.
//
// Pure and dependency-free: the caller supplies the key lookup, so the
// same module serves the renderer's ContextKeyService and the test suite.
// Like contributionRegistry.ts, it stays erasable TypeScript (no parameter
// properties, no enums) to run unbundled under Node's type stripping.

export type WhenContextLookup = (key: string) => unknown;

type WhenNode =
  | { kind: 'key'; name: string }
  | { kind: 'literal'; value: string | number | boolean }
  | { kind: 'not'; operand: WhenNode }
  | { kind: 'equals'; negated: boolean; left: WhenNode; right: WhenNode }
  | { kind: 'and'; operands: WhenNode[] }
  | { kind: 'or'; operands: WhenNode[] };

interface Token {
  kind: 'op' | 'string' | 'atom';
  text: string;
}

const OPERATORS = ['(', ')', '&&', '||', '==', '!=', '!'];

class WhenClauseSyntaxError extends Error {}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expression.length) {
    const ch = expression[i];
    if (/\s/.test(ch)) { i += 1; continue; }

    const operator = OPERATORS.find((op) => expression.startsWith(op, i));
    // `!` is negation only when it is not the start of `!=`.
    if (operator && !(operator === '!' && expression[i + 1] === '=')) {
      tokens.push({ kind: 'op', text: operator });
      i += operator.length;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const end = expression.indexOf(ch, i + 1);
      if (end < 0) throw new WhenClauseSyntaxError(`unterminated string at ${i}`);
      tokens.push({ kind: 'string', text: expression.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    // Context-key atoms: identifiers with the separators VS Code allows
    // (`editorLangId`, `config.editor.fontSize`, `resource-scheme:file`).
    const match = /^[A-Za-z0-9_.:/-]+/.exec(expression.slice(i));
    if (!match) throw new WhenClauseSyntaxError(`unexpected character "${ch}" at ${i}`);
    tokens.push({ kind: 'atom', text: match[0] });
    i += match[0].length;
  }
  return tokens;
}

class Parser {
  private readonly tokens: Token[];
  private index = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): WhenNode {
    const node = this.parseOr();
    if (this.index < this.tokens.length) {
      throw new WhenClauseSyntaxError(`unexpected "${this.tokens[this.index].text}"`);
    }
    return node;
  }

  private parseOr(): WhenNode {
    const operands = [this.parseAnd()];
    while (this.takeOp('||')) operands.push(this.parseAnd());
    return operands.length === 1 ? operands[0] : { kind: 'or', operands };
  }

  private parseAnd(): WhenNode {
    const operands = [this.parseEquality()];
    while (this.takeOp('&&')) operands.push(this.parseEquality());
    return operands.length === 1 ? operands[0] : { kind: 'and', operands };
  }

  private parseEquality(): WhenNode {
    const left = this.parseUnary();
    const negated = this.peekOp('!=');
    if (!negated && !this.peekOp('==')) return left;
    this.index += 1;
    return { kind: 'equals', negated, left, right: this.parseUnary() };
  }

  private parseUnary(): WhenNode {
    if (this.takeOp('!')) return { kind: 'not', operand: this.parseUnary() };
    return this.parsePrimary();
  }

  private parsePrimary(): WhenNode {
    const token = this.tokens[this.index];
    if (!token) throw new WhenClauseSyntaxError('unexpected end of expression');
    if (token.kind === 'op' && token.text === '(') {
      this.index += 1;
      const node = this.parseOr();
      if (!this.takeOp(')')) throw new WhenClauseSyntaxError('missing ")"');
      return node;
    }
    if (token.kind === 'string') {
      this.index += 1;
      return { kind: 'literal', value: token.text };
    }
    if (token.kind === 'atom') {
      this.index += 1;
      if (token.text === 'true') return { kind: 'literal', value: true };
      if (token.text === 'false') return { kind: 'literal', value: false };
      if (/^-?\d+(\.\d+)?$/.test(token.text)) {
        return { kind: 'literal', value: Number(token.text) };
      }
      return { kind: 'key', name: token.text };
    }
    throw new WhenClauseSyntaxError(`unexpected "${token.text}"`);
  }

  private peekOp(text: string): boolean {
    const token = this.tokens[this.index];
    return token !== undefined && token.kind === 'op' && token.text === text;
  }

  private takeOp(text: string): boolean {
    if (!this.peekOp(text)) return false;
    this.index += 1;
    return true;
  }
}

function valueOf(node: WhenNode, lookup: WhenContextLookup): unknown {
  switch (node.kind) {
    case 'key': return lookup(node.name);
    case 'literal': return node.value;
    default: return evaluateNode(node, lookup);
  }
}

// Equality follows VS Code's tolerant comparison: `==` matches both the
// exact value and its string form, so `count == 3` and `mode == 'fast'`
// behave as authors expect regardless of how the key was set.
function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || a === null || b === undefined || b === null) return false;
  return String(a) === String(b);
}

function evaluateNode(node: WhenNode, lookup: WhenContextLookup): boolean {
  switch (node.kind) {
    case 'key': return Boolean(lookup(node.name));
    case 'literal': return Boolean(node.value);
    case 'not': return !evaluateNode(node.operand, lookup);
    case 'equals': {
      const equal = looseEquals(valueOf(node.left, lookup), valueOf(node.right, lookup));
      return node.negated ? !equal : equal;
    }
    case 'and': return node.operands.every((operand) => evaluateNode(operand, lookup));
    case 'or': return node.operands.some((operand) => evaluateNode(operand, lookup));
  }
}

/** A parsed, reusable when-clause. */
export interface WhenClause {
  evaluate(lookup: WhenContextLookup): boolean;
}

/** Parses `expression`; returns null when it is malformed or empty so the
 *  caller can decide the failure policy (warn + never match). */
export function parseWhenClause(expression: string): WhenClause | null {
  try {
    const tokens = tokenize(expression);
    if (tokens.length === 0) return null;
    const root = new Parser(tokens).parse();
    return { evaluate: (lookup) => evaluateNode(root, lookup) };
  } catch {
    return null;
  }
}
