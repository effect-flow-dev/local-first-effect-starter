// FILE: src/lib/client/logic/title-utils.ts

/**
 * Generates a unique title by appending (n) if a collision exists.
 * e.g. "Untitled Note" -> "Untitled Note (2)" -> "Untitled Note (3)"
 */
export const generateUniqueTitle = (
  baseTitle: string,
  existingTitles: Set<string>
): string => {
  // Case 1: Exact match doesn't exist
  if (!existingTitles.has(baseTitle)) {
    return baseTitle;
  }

  // Case 2: Collision found, increment counter
  let counter = 2;
  while (true) {
    const candidate = `${baseTitle} (${counter})`;
    if (!existingTitles.has(candidate)) {
      return candidate;
    }
    counter++;
  }
};
