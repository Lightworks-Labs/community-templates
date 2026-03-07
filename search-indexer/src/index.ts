#!/usr/bin/env node
/**
 * Lightworks Search Indexer
 *
 * Builds search indexes from markdown files.
 * Used as a GitHub Action or CLI tool.
 *
 * Usage:
 *   node index.js [content-dir] [output-dir]
 *
 * Defaults:
 *   content-dir: . (current directory)
 *   output-dir: .lightworks/search
 */

import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';

// Types
interface SearchEntry {
  id: string;
  path: string;
  title: string;
  type: 'page' | 'record';
  properties: Record<string, string>;
  lineCount: number;
  chunkIds: string[];
}

interface SearchChunk {
  id: string;
  entryId: string;
  startLine: number;
  endLine: number;
  content: string;
}

interface MetadataIndex {
  version: string;
  generatedAt: string;
  entries: SearchEntry[];
}

interface IndexConfig {
  version: string;
  include: string[];
  exclude: string[];
  maxFileSize: number;
  chunkSize: number;
}

// Default configuration
const DEFAULT_CONFIG: IndexConfig = {
  version: '1.0.0',
  include: ['**/*.md'],
  exclude: [
    '**/node_modules/**',
    '**/.git/**',
    '**/vendor/**',
    '**/.lightworks/**',
  ],
  maxFileSize: 1048576, // 1MB
  chunkSize: 100, // lines per chunk
};

// Simple glob matching
function matchesGlob(filePath: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{GLOBSTAR}}/g, '.*')
    .replace(/\?/g, '.');
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(filePath);
}

function shouldInclude(filePath: string, config: IndexConfig): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Check excludes first
  for (const pattern of config.exclude) {
    if (matchesGlob(normalizedPath, pattern)) {
      return false;
    }
  }

  // Check includes
  for (const pattern of config.include) {
    if (matchesGlob(normalizedPath, pattern)) {
      return true;
    }
  }

  return false;
}

// Recursively find all files
function walkDir(dir: string, baseDir: string = dir): string[] {
  const files: string[] = [];

  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(fullPath, baseDir));
    } else {
      const relativePath = path.relative(baseDir, fullPath);
      files.push(relativePath);
    }
  }

  return files;
}

// Generate a stable ID from a path
function generateId(filePath: string): string {
  // Use the full path to ensure uniqueness
  // Replace path separators with underscores, other special chars with dashes
  return filePath
    .replace(/\\/g, '/') // Normalize Windows paths
    .replace(/\//g, '_') // Use underscore for directory separators
    .replace(/[^a-zA-Z0-9_]/g, '-') // Replace other special chars with dash
    .replace(/-+/g, '-') // Collapse multiple dashes
    .replace(/^-|-$/g, '') // Trim leading/trailing dashes
    .toLowerCase();
}

// Extract title from markdown content
function extractTitle(
  content: string,
  frontmatter: Record<string, unknown>,
  filePath: string
): string {
  // Try frontmatter title first
  if (frontmatter.title && typeof frontmatter.title === 'string') {
    return frontmatter.title;
  }

  // Try first H1 heading
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) {
    return h1Match[1].trim();
  }

  // Fallback to filename without extension
  const basename = path.basename(filePath, path.extname(filePath));
  return basename.replace(/[-_]/g, ' ');
}

// Determine if this is a database record (has schema-like properties)
function isRecord(frontmatter: Record<string, unknown>): boolean {
  const recordIndicators = ['status', 'priority', 'category', 'type', 'id'];
  return recordIndicators.some((key) => key in frontmatter);
}

// Chunk content into smaller pieces
function chunkContent(
  content: string,
  entryId: string,
  chunkSize: number
): { chunks: SearchChunk[]; chunkIds: string[] } {
  const lines = content.split('\n');
  const chunks: SearchChunk[] = [];
  const chunkIds: string[] = [];

  let chunkIndex = 0;
  for (let i = 0; i < lines.length; i += chunkSize) {
    const chunkId = `${entryId}-${chunkIndex}`;
    const startLine = i + 1;
    const endLine = Math.min(i + chunkSize, lines.length);
    const chunkContent = lines.slice(i, endLine).join('\n');

    chunks.push({
      id: chunkId,
      entryId,
      startLine,
      endLine,
      content: chunkContent,
    });

    chunkIds.push(chunkId);
    chunkIndex++;
  }

  return { chunks, chunkIds };
}

// Process a single file
function processFile(
  filePath: string,
  contentDir: string,
  config: IndexConfig
): { entry: SearchEntry; chunks: SearchChunk[] } | null {
  const fullPath = path.join(contentDir, filePath);

  // Check file size
  const stats = fs.statSync(fullPath);
  if (stats.size > config.maxFileSize) {
    console.warn(`  Skipping ${filePath}: exceeds max file size`);
    return null;
  }

  // Read and parse file
  const fileContent = fs.readFileSync(fullPath, 'utf-8');
  const { data: frontmatter, content } = matter(fileContent);

  const id = generateId(filePath);
  const title = extractTitle(content, frontmatter, filePath);
  const type = isRecord(frontmatter) ? 'record' : 'page';
  const lines = content.split('\n');

  // Extract string properties
  const properties: Record<string, string> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (typeof value === 'string') {
      properties[key] = value;
    }
  }

  // Chunk the content
  const { chunks, chunkIds } = chunkContent(content, id, config.chunkSize);

  const entry: SearchEntry = {
    id,
    path: filePath,
    title,
    type,
    properties,
    lineCount: lines.length,
    chunkIds,
  };

  return { entry, chunks };
}

// Load config from file or use defaults
function loadConfig(configPath: string): IndexConfig {
  if (fs.existsSync(configPath)) {
    try {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(configContent);
      console.log(`  Using config from ${configPath}`);
      return { ...DEFAULT_CONFIG, ...parsed };
    } catch (e) {
      console.warn(`  Failed to parse config, using defaults`);
    }
  }
  return DEFAULT_CONFIG;
}

// Main build function
async function buildIndex(
  contentDir: string,
  outputDir: string
): Promise<void> {
  console.log(`Lightworks Search Indexer v1.0.0`);
  console.log(`Building search index...`);
  console.log(`  Content directory: ${contentDir}`);
  console.log(`  Output directory: ${outputDir}`);

  // Load config
  const configPath = path.join(outputDir, 'config.json');
  const config = loadConfig(configPath);

  // Find all files
  const allFiles = walkDir(contentDir);
  const includedFiles = allFiles.filter((f) => shouldInclude(f, config));

  console.log(
    `  Found ${allFiles.length} files, ${includedFiles.length} match include patterns`
  );

  // Process files
  const entries: SearchEntry[] = [];
  const allChunks: SearchChunk[] = [];

  for (const filePath of includedFiles) {
    try {
      const result = processFile(filePath, contentDir, config);
      if (result) {
        entries.push(result.entry);
        allChunks.push(...result.chunks);
      }
    } catch (e) {
      console.error(`  Error processing ${filePath}:`, e);
    }
  }

  console.log(
    `  Processed ${entries.length} entries, ${allChunks.length} chunks`
  );

  // Create output directories
  const chunksDir = path.join(outputDir, 'chunks');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(chunksDir, { recursive: true });

  // Write metadata index
  const metadataIndex: MetadataIndex = {
    version: config.version,
    generatedAt: new Date().toISOString(),
    entries,
  };

  fs.writeFileSync(
    path.join(outputDir, 'metadata.json'),
    JSON.stringify(metadataIndex, null, 2)
  );

  // Write chunks
  for (const chunk of allChunks) {
    fs.writeFileSync(
      path.join(chunksDir, `${chunk.id}.json`),
      JSON.stringify(chunk, null, 2)
    );
  }

  console.log(`  Wrote metadata.json and ${allChunks.length} chunk files`);
  console.log(`Done!`);
}

// CLI entry point
const args = process.argv.slice(2);
const contentDir = args[0] || '.';
const outputDir = args[1] || './.lightworks/search';

buildIndex(path.resolve(contentDir), path.resolve(outputDir)).catch((e) => {
  console.error('Build failed:', e);
  process.exit(1);
});
