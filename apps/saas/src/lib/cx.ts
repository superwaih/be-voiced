/** Joins class names, dropping anything falsy, so conditions can be written inline. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
