/**
 * Removes JSON comments without touching comment-like text inside strings.
 */
function stripJsonComments(source: string): string {
  let output = '';
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
        output += char;
      }
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      } else if (char === '\n') {
        output += char;
      }
      continue;
    }
    if (inString) {
      output += char;
      if (char === '\\') {
        output += next ?? '';
        index += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
    } else if (char === '/' && next === '/') {
      inLineComment = true;
      index += 1;
    } else if (char === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
    } else {
      output += char;
    }
  }

  return output;
}

/** Removes commas before `}`/`]` while preserving comma-like string content. */
function stripTrailingCommas(source: string): string {
  let output = '';
  let inString = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      output += char;
      if (char === '\\') {
        output += source[index + 1] ?? '';
        index += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char === ',') {
      let lookahead = index + 1;
      while (/\s/.test(source[lookahead] ?? '')) lookahead += 1;
      if (source[lookahead] === '}' || source[lookahead] === ']') continue;
    }
    output += char;
  }

  return output;
}

export type JsonObject = Record<string, unknown>;

/** Valid JSON whose root is not an object — callers can tell it apart from
 *  syntax errors when reporting discriminated validation issues. */
export class JsoncRootTypeError extends SyntaxError {
  constructor() {
    super('Expected a JSON object at the document root.');
    this.name = 'JsoncRootTypeError';
  }
}

export function parseJsonc(source: string): JsonObject {
  const parsed: unknown = JSON.parse(stripTrailingCommas(stripJsonComments(source)));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new JsoncRootTypeError();
  }
  return parsed as JsonObject;
}
