export const DEFAULT_TASK_REGEX =
  "https://your-company\\.atlassian\\.net/browse/[A-Z]+-\\d+";

export function compileTaskRegex(input: string | null | undefined): RegExp | null {
  if (!input) return null;
  try {
    const m = input.match(/^\/(.*)\/([a-z]*)$/i);
    if (m) {
      return new RegExp(m[1], m[2] || "g");
    }
    return new RegExp(input, "g");
  } catch {
    return null;
  }
}

export function extractTaskUrls(
  body: string | null | undefined,
  regex: RegExp | null,
): string[] {
  if (!body || !regex) return [];
  const matches = body.match(regex);
  if (!matches) return [];
  return Array.from(new Set(matches));
}
