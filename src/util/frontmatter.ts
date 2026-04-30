import { readFileSync, existsSync } from "node:fs";
import matter from "gray-matter";

export function readFrontmatter(
  filePath: string,
): { data: Record<string, unknown>; content: string } | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = matter(raw);
    return { data: parsed.data as Record<string, unknown>, content: parsed.content };
  } catch {
    return null;
  }
}

export function getFrontmatterValue(
  filePath: string,
  key: string,
  fallback = "",
): string {
  const fm = readFrontmatter(filePath);
  if (!fm) return fallback;
  const value = fm.data[key];
  if (value === undefined || value === null) return fallback;
  return String(value);
}
