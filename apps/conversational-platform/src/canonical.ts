import { createHash } from "node:crypto";

export const CANONICAL_CODEC_VERSION = "jcs-rfc8785-subset-v1" as const;
export const CANONICAL_CODEC_HASH = "sha256:9ce7b5b6a1f65e43f85ef40ae6144a2f5c9f6fca286f08c8cfd1f890ef617490" as const;

export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export function canonicalizeForHash(value: unknown): string {
  return canonicalize(value, "$ ".trim());
}

export function hashCanonical(domain: string, value: unknown): string {
  if (!isSafeString(domain)) {
    throw new Error("Invalid hash domain");
  }
  const preimage = canonicalizeForHash({ domain, value });
  return `sha256:${createHash("sha256").update(preimage, "utf8").digest("hex")}`;
}

export function stableHash(value: unknown): string {
  return hashCanonical("legacy-stable-hash", value);
}

export function cloneCanonicalValue<T extends CanonicalValue>(value: T): T {
  return cloneJson(value) as T;
}

export function deepClone<T>(value: T): T {
  return cloneJson(value) as T;
}

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item);
    }
    return value;
  }
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

export function cloneAndFreeze<T>(value: T): T {
  return deepFreeze(deepClone(value));
}

export function isReservedName(name: string): boolean {
  return DANGEROUS_KEYS.has(name) || name === "trustedClaims" || name === "systemFacts";
}

export function isSafeString(value: string): boolean {
  return !hasLoneSurrogate(value);
}

function canonicalize(value: unknown, path: string): string {
  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error(`Cannot canonicalize non-finite number at ${path}`);
      }
      return JSON.stringify(value);
    case "string":
      if (!isSafeString(value)) {
        throw new Error(`Cannot canonicalize string with lone surrogate at ${path}`);
      }
      return JSON.stringify(value);
    case "object":
      if (Array.isArray(value)) {
        return canonicalizeArray(value, path);
      }
      return canonicalizeObject(value, path);
    case "undefined":
    case "function":
    case "symbol":
    case "bigint":
      throw new Error(`Cannot canonicalize ${typeof value} at ${path}`);
  }
  throw new Error(`Cannot canonicalize value at ${path}`);
}

function canonicalizeArray(value: readonly unknown[], path: string): string {
  const items: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw new Error(`Cannot canonicalize sparse array at ${path}[${index}]`);
    }
    items.push(canonicalize(value[index], `${path}[${index}]`));
  }
  return `[${items.join(",")}]`;
}

function canonicalizeObject(value: object, path: string): string {
  if (!isPlainObject(value)) {
    throw new Error(`Cannot canonicalize non-plain object at ${path}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const properties: string[] = [];
  for (const key of keys) {
    if (DANGEROUS_KEYS.has(key) || !isSafeString(key)) {
      throw new Error(`Cannot canonicalize unsafe key at ${path}.${key}`);
    }
    properties.push(`${JSON.stringify(key)}:${canonicalize(record[key], `${path}.${key}`)}`);
  }
  return `{${properties.join(",")}}`;
}

function cloneJson(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error("Cannot clone non-finite number");
    }
    if (typeof value === "string" && !isSafeString(value)) {
      throw new Error("Cannot clone string with lone surrogate");
    }
    if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
      throw new Error(`Cannot clone ${typeof value}`);
    }
    return value;
  }

  if (Array.isArray(value)) {
    const cloned: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw new Error("Cannot clone sparse array");
      }
      cloned.push(cloneJson(value[index]));
    }
    return cloned;
  }

  if (!isPlainObject(value)) {
    throw new Error("Cannot clone non-plain object");
  }

  const source = value as Record<string, unknown>;
  const cloned: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (DANGEROUS_KEYS.has(key) || !isSafeString(key)) {
      throw new Error(`Cannot clone unsafe key ${key}`);
    }
    Object.defineProperty(cloned, key, {
      value: cloneJson(source[key]),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return cloned;
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}
