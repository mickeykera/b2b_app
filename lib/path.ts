/**
 * Minimal JSON path resolver used by filters, transforms, and interpolation.
 *
 * Supported syntax: `foo.bar`, `$.foo.bar`, `foo.bar[0]`, `foo.bar[2].baz`.
 * A leading `$.` is treated as `$` → the root object.
 */

export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathError";
  }
}

function tokenize(path: string): (string | number)[] {
  const normalized = path.replace(/^\$\.?/, "").replace(/^\./, "");
  if (normalized.length === 0) {
    return [];
  }
  const tokens: (string | number)[] = [];
  let current = "";
  let i = 0;
  const flushCurrent = () => {
    if (current.length === 0) {
      return;
    }
    if (/^\d+$/.test(current)) {
      tokens.push(Number(current));
    } else {
      tokens.push(current);
    }
    current = "";
  };
  while (i < normalized.length) {
    const ch = normalized[i];
    if (ch === ".") {
      flushCurrent();
      i += 1;
    } else if (ch === "[") {
      flushCurrent();
      i += 1;
      while (i < normalized.length && normalized[i] !== "]") {
        current += normalized[i];
        i += 1;
      }
      if (!/^\d+$/.test(current)) {
        throw new PathError(`Invalid array index in path "${path}".`);
      }
      tokens.push(Number(current));
      current = "";
      i += 1;
      if (i < normalized.length && normalized[i] === ".") {
        i += 1;
      }
    } else {
      current += ch;
      i += 1;
    }
  }
  flushCurrent();
  return tokens;
}

export interface Found {
  found: true;
  value: unknown;
}

export interface NotFound {
  found: false;
  value: undefined;
}

export type Lookup = Found | NotFound;

export function getPath(root: unknown, path: string): Lookup {
  const tokens = tokenize(path);
  if (tokens.length === 0) {
    if (path === "$") {
      return { found: true, value: root };
    }
    throw new PathError(`Path "${path}" is empty.`);
  }
  let cursor: unknown = root;
  for (const token of tokens) {
    if (cursor === null || cursor === undefined) {
      return { found: false, value: undefined };
    }
    if (typeof token === "number") {
      if (!Array.isArray(cursor) || token < 0 || token >= cursor.length) {
        return { found: false, value: undefined };
      }
      cursor = cursor[token];
    } else {
      if (typeof cursor !== "object" || Array.isArray(cursor)) {
        return { found: false, value: undefined };
      }
      const record = cursor as Record<string, unknown>;
      if (!(token in record)) {
        return { found: false, value: undefined };
      }
      cursor = record[token];
    }
  }
  return { found: true, value: cursor };
}

export function hasPath(root: unknown, path: string): boolean {
  return getPath(root, path).found;
}

/**
 * Deep-copies `value` then writes `value` at `path`, creating missing
 * containers along the way. Returns the new copy (never mutates input).
 */
export function setPath(root: unknown, path: string, value: unknown): unknown {
  const tokens = tokenize(path);
  const output = structuredClone(root) as Record<string | number, unknown>;
  if (tokens.length === 0) {
    return value;
  }
  let cursor: any = output;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const token = tokens[i];
    const next = tokens[i + 1];
    const containerForNext = typeof next === "number" ? [] : {};
    if (typeof token === "number") {
      if (!Array.isArray(cursor)) {
        cursor = [];
      }
      const existing = cursor[token];
      if (existing === undefined || existing === null) {
        cursor[token] = containerForNext;
      }
      cursor = cursor[token];
    } else {
      if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor)) {
        cursor = {};
      }
      const existing = cursor[token!];
      if (existing === undefined || existing === null) {
        cursor[token!] = containerForNext;
      }
      cursor = cursor[token!];
    }
  }
  const last = tokens[tokens.length - 1]!;
  if (typeof last === "number") {
    if (!Array.isArray(cursor)) {
      cursor = [];
    }
    cursor[last] = value;
  } else {
    if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor)) {
      cursor = {};
    }
    cursor[last] = value;
  }
  return output;
}

/** Replaces every `{{ path }}` occurrence in a string with a value. */
export function interpolate(template: string, root: unknown): string {
  return template.replace(/\{\{\s*([\w.$[\]-]+)\s*\}\}/g, (_match, path: string) => {
    const lookup = getPath(root, path);
    if (!lookup.found) {
      return "";
    }
    const { value } = lookup;
    if (value === null) {
      return "null";
    }
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  });
}

export function hasInterpolation(template: string): boolean {
  return /\{\{\s*[\w.$[\]-]+\s*\}\}/.test(template);
}