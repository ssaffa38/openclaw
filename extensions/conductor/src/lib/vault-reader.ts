import fs from "node:fs/promises";
import path from "node:path";

type VaultMatch = {
  file: string;
  kind: "filename" | "content";
  snippet: string;
};

async function listMarkdownFiles(vaultPath: string): Promise<string[]> {
  const entries = await fs.readdir(vaultPath, { withFileTypes: true });
  const mdFiles: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue; // skip .obsidian, .trash, etc.
    if (entry.isFile() && entry.name.endsWith(".md")) {
      mdFiles.push(path.join(vaultPath, entry.name));
    }
  }
  return mdFiles;
}

function extractContentSnippets(lines: string[], terms: string[], contextLines = 3): string[] {
  const matchedLineIndices = new Set<number>();
  const lowerTerms = terms.map((t) => t.toLowerCase());

  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (lowerTerms.some((term) => lower.includes(term))) {
      matchedLineIndices.add(i);
    }
  }

  if (matchedLineIndices.size === 0) return [];

  // Expand to include context lines and merge overlapping ranges
  const ranges: [number, number][] = [];
  for (const idx of [...matchedLineIndices].sort((a, b) => a - b)) {
    const start = Math.max(0, idx - contextLines);
    const end = Math.min(lines.length - 1, idx + contextLines);
    if (ranges.length > 0 && start <= ranges[ranges.length - 1][1] + 1) {
      ranges[ranges.length - 1][1] = end;
    } else {
      ranges.push([start, end]);
    }
  }

  return ranges.map(([s, e]) => lines.slice(s, e + 1).join("\n"));
}

export async function searchVault(options: {
  vaultPath: string;
  searchTerms: string[];
  maxTotalChars?: number;
}): Promise<string | null> {
  const { vaultPath, searchTerms, maxTotalChars = 4000 } = options;

  // Bail if vault is inaccessible
  try {
    await fs.access(vaultPath);
  } catch {
    return null;
  }

  const files = await listMarkdownFiles(vaultPath);
  if (files.length === 0) return null;

  const lowerTerms = searchTerms.map((t) => t.toLowerCase());
  const matches: VaultMatch[] = [];

  for (const filePath of files) {
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch {
      continue; // file might be mid-sync via iCloud
    }

    const basename = path.basename(filePath, ".md");
    const lowerBasename = basename.toLowerCase();
    const isFilenameMatch = lowerTerms.some((term) => lowerBasename.includes(term));

    if (isFilenameMatch) {
      // For filename matches, include the first ~500 chars
      const snippet = content.slice(0, 500).trim();
      if (snippet) {
        matches.push({ file: basename, kind: "filename", snippet });
      }
    } else {
      // Check content for term matches
      const lines = content.split("\n");
      const snippets = extractContentSnippets(lines, searchTerms);
      for (const snippet of snippets) {
        matches.push({ file: basename, kind: "content", snippet });
      }
    }
  }

  if (matches.length === 0) return null;

  // Prioritize filename matches first, then content matches
  matches.sort((a, b) => {
    if (a.kind === "filename" && b.kind !== "filename") return -1;
    if (a.kind !== "filename" && b.kind === "filename") return 1;
    return 0;
  });

  // Build output, respecting maxTotalChars
  const outputLines: string[] = ["## Vault Context"];
  let charCount = outputLines[0].length;

  for (const match of matches) {
    const header = `\n### ${match.file} (${match.kind} match)`;
    const block = `${header}\n${match.snippet}\n`;
    if (charCount + block.length > maxTotalChars) break;
    outputLines.push(block);
    charCount += block.length;
  }

  return outputLines.length > 1 ? outputLines.join("") : null;
}
