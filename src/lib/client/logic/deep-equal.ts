// FILE: src/lib/client/logic/deep-equal.ts
/**
 * Performs a deep comparison between two values to determine if they are equivalent.
 */
export function deepEqual(a: unknown, b: unknown, path = ""): boolean {
  if (a === b) return true;

  if (a === null || a === undefined || b === null || b === undefined) {
    return a === b;
  }

  if (typeof a !== "object" || typeof b !== "object") {
    return false;
  }

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i], `${path}[${i}]`)) return false;
    }
    return true;
  }

  if (Array.isArray(b)) return false; // a is object, b is array

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);

  if (keysA.length !== keysB.length) {
    return false;
  }

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(objB, key)) return false;

    if (!deepEqual(objA[key], objB[key], `${path}.${key}`)) return false;
  }

  return true;
}
