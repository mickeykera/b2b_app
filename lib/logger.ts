import { randomBytes } from "node:crypto";

/**
 * Structured JSON logger (single line per event) plus request-id plumbing.
 *
 * Every entry is one JSON object: `{ t, level, msg, ...fields }` where nested
 * Errors are flattened to `{ message, stack }`. Using JSON lines keeps logs
 * greppable and ship-to-drain friendly. Nothing here touches the network.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  [key: string]: unknown;
}

function serializeField(value: unknown): unknown {
  if (value instanceof Error) {
    return { error: value.message, stack: value.stack };
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object" && value !== null) {
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      copy[key] = serializeField(entry);
    }
    return copy;
  }
  return value;
}

function write(level: LogLevel, message: string, fields: LogFields): void {
  const entry = {
    t: new Date().toISOString(),
    level,
    msg: message,
    ...serializeFields(fields),
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
}

function serializeFields(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = serializeField(value);
  }
  return out;
}

export interface Logger {
  debug: (message: string, fields?: LogFields) => void;
  info: (message: string, fields?: LogFields) => void;
  warn: (message: string, fields?: LogFields) => void;
  error: (message: string, fields?: LogFields) => void;
}

export const logger: Logger = {
  debug: (message, fields = {}) => write("debug", message, fields),
  info: (message, fields = {}) => write("info", message, fields),
  warn: (message, fields = {}) => write("warn", message, fields),
  error: (message, fields = {}) => write("error", message, fields),
};

/** Generates a collision-resistant request id (`req_<16 hex>`). */
export function createRequestId(): string {
  return `req_${randomBytes(8).toString("hex")}`;
}

/** Returns a logger that always attaches `requestId` to every entry. */
export function withRequestId(requestId?: string | null): Logger {
  const fields: LogFields = requestId ? { requestId } : {};
  return {
    debug: (message, extra = {}) => logger.debug(message, { ...fields, ...extra }),
    info: (message, extra = {}) => logger.info(message, { ...fields, ...extra }),
    warn: (message, extra = {}) => logger.warn(message, { ...fields, ...extra }),
    error: (message, extra = {}) => logger.error(message, { ...fields, ...extra }),
  };
}

/** Extracts a request id from an incoming Request, else generates one. */
export function requestLogger(request: { headers: Headers }): Logger {
  return withRequestId(request.headers.get("x-request-id") ?? createRequestId());
}