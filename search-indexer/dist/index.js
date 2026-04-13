#!/usr/bin/env node
"use strict";
/**
 * Lightworks Search Indexer
 *
 * Builds search indexes from markdown files, partitioned by database collection.
 * A "collection" is any directory that contains a _schema.json file.
 *
 * Output structure:
 *   .lightworks/search/
 *     metadata.json           ← master index (all entries, backward compat)
 *     metadata/
 *       <collection>.json     ← per-collection index for LQL engine
 *       pages.json            ← non-collection pages
 *     chunks/
 *       <entry-id>-<n>.json
 *
 * Usage:
 *   node index.js [content-dir] [output-dir]
 *
 * Defaults:
 *   content-dir: . (current directory)
 *   output-dir: .lightworks/search
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const gray_matter_1 = __importDefault(require("gray-matter"));
// ─── Default configuration ────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
    version: '1.0.0',
    include: ['**/*.md'],
    exclude: [
        '**/node_modules/**',
        '**/.git/**',
        '**/.lightworks/**',
        '**/vendor/**',
    ],
    maxFileSize: 1048576, // 1MB
    chunkSize: 100, // lines per chunk
};
// ─── Glob matching ────────────────────────────────────────────────────────────
function matchesGlob(filePath, pattern) {
    const regexPattern = pattern
        .replace(/\*\*/g, '{{GLOBSTAR}}')
        .replace(/\*/g, '[^/]*')
        .replace(/{{GLOBSTAR}}/g, '.*')
        .replace(/\?/g, '.');
    return new RegExp(`^${regexPattern}$`).test(filePath);
}
function shouldInclude(filePath, config) {
    const normalized = filePath.replace(/\\/g, '/');
    for (const pattern of config.exclude) {
        if (matchesGlob(normalized, pattern))
            return false;
    }
    for (const pattern of config.include) {
        if (matchesGlob(normalized, pattern))
            return true;
    }
    return false;
}
// ─── Directory walking ────────────────────────────────────────────────────────
function walkDir(dir, baseDir = dir) {
    if (!fs.existsSync(dir))
        return [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...walkDir(fullPath, baseDir));
        }
        else {
            files.push(path.relative(baseDir, fullPath));
        }
    }
    return files;
}
// ─── Collection detection ─────────────────────────────────────────────────────
/**
 * Build a map of absolute directory path → collection name for every
 * directory that contains a _schema.json file.
 */
function buildCollectionMap(contentDir) {
    const map = new Map();
    const allFiles = walkDir(contentDir);
    for (const f of allFiles) {
        if (path.basename(f) === '_schema.json') {
            const dirAbs = path.resolve(contentDir, path.dirname(f));
            const collectionName = path.basename(dirAbs);
            map.set(dirAbs, collectionName);
        }
    }
    return map;
}
/**
 * Determine the LQL collection type for a given file path.
 *
 * Rules:
 *  - <collection>/index.md (direct child of collection root) → 'page'
 *    (this is the database overview/index page, not a record)
 *  - Any other file under a collection folder → collection name
 *  - Files not under any collection folder → 'page'
 *
 * When directories are nested (collection inside a collection), the deepest
 * matching ancestor wins.
 */
function getCollectionType(filePath, contentDir, collectionMap) {
    const fullPath = path.resolve(contentDir, filePath);
    const dirAbs = path.dirname(fullPath);
    const basename = path.basename(fullPath);
    // If this is index.md sitting directly in a collection root → page
    if (basename === 'index.md' && collectionMap.has(dirAbs)) {
        return 'page';
    }
    // Walk up ancestors, pick the deepest (most specific) collection
    let current = dirAbs;
    const absContentDir = path.resolve(contentDir);
    while (current.length >= absContentDir.length) {
        if (collectionMap.has(current)) {
            return collectionMap.get(current);
        }
        const parent = path.dirname(current);
        if (parent === current)
            break; // filesystem root
        current = parent;
    }
    return 'page';
}
// ─── ID generation ────────────────────────────────────────────────────────────
function generateId(filePath) {
    return filePath
        .replace(/\\/g, '/')
        .replace(/\//g, '_')
        .replace(/[^a-zA-Z0-9_]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase();
}
// ─── Title extraction ─────────────────────────────────────────────────────────
function extractTitle(content, frontmatter, filePath) {
    if (frontmatter.title && typeof frontmatter.title === 'string') {
        return frontmatter.title;
    }
    const h1 = content.match(/^#\s+(.+)$/m);
    if (h1)
        return h1[1].trim();
    const base = path.basename(filePath, path.extname(filePath));
    return base === 'index' ? path.basename(path.dirname(filePath)) : base.replace(/[-_]/g, ' ');
}
// ─── Content chunking ─────────────────────────────────────────────────────────
function chunkContent(content, entryId, chunkSize) {
    const lines = content.split('\n');
    const chunks = [];
    const chunkIds = [];
    let chunkIndex = 0;
    for (let i = 0; i < lines.length; i += chunkSize) {
        const chunkId = `${entryId}-${chunkIndex}`;
        const endLine = Math.min(i + chunkSize, lines.length);
        chunks.push({
            id: chunkId,
            entryId,
            startLine: i + 1,
            endLine,
            content: lines.slice(i, endLine).join('\n'),
        });
        chunkIds.push(chunkId);
        chunkIndex++;
    }
    return { chunks, chunkIds };
}
// ─── File processing ──────────────────────────────────────────────────────────
function processFile(filePath, contentDir, collectionMap, config) {
    const fullPath = path.join(contentDir, filePath);
    // Skip _schema.json files — they're collection metadata, not records
    if (path.basename(filePath) === '_schema.json')
        return null;
    const stats = fs.statSync(fullPath);
    if (stats.size > config.maxFileSize) {
        console.warn(`  Skipping ${filePath}: exceeds max file size`);
        return null;
    }
    const raw = fs.readFileSync(fullPath, 'utf-8');
    const { data: frontmatter, content } = (0, gray_matter_1.default)(raw);
    const id = generateId(filePath);
    const title = extractTitle(content, frontmatter, filePath);
    const type = getCollectionType(filePath, contentDir, collectionMap);
    // Extract string-valued properties from frontmatter
    const properties = {};
    for (const [key, value] of Object.entries(frontmatter)) {
        if (typeof value === 'string') {
            properties[key] = value;
        }
        else if (Array.isArray(value)) {
            // Store arrays as comma-separated for simple string matching
            properties[key] = value.filter(v => typeof v === 'string').join(', ');
        }
    }
    const { chunks, chunkIds } = chunkContent(content, id, config.chunkSize);
    const entry = {
        id,
        path: filePath.replace(/\\/g, '/'),
        title,
        type,
        properties,
        lineCount: content.split('\n').length,
        chunkIds,
    };
    return { entry, chunks };
}
// ─── Config loading ───────────────────────────────────────────────────────────
function loadConfig(configPath) {
    if (fs.existsSync(configPath)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            console.log(`  Using config from ${configPath}`);
            // Normalize legacy configs that used qmsPath-prefixed include patterns.
            // If all include patterns start with a non-glob prefix that matches the
            // content-dir basename, strip it so patterns work relative to content-dir.
            const normalized = { ...DEFAULT_CONFIG, ...parsed };
            return normalized;
        }
        catch {
            console.warn('  Failed to parse config, using defaults');
        }
    }
    return DEFAULT_CONFIG;
}
// ─── Main build function ──────────────────────────────────────────────────────
async function buildIndex(contentDir, outputDir) {
    console.log('Lightworks Search Indexer v2.0.0');
    console.log('Building search index...');
    console.log(`  Content directory: ${contentDir}`);
    console.log(`  Output directory: ${outputDir}`);
    const configPath = path.join(outputDir, 'config.json');
    const config = loadConfig(configPath);
    // Detect collection folders (directories with _schema.json)
    const collectionMap = buildCollectionMap(contentDir);
    if (collectionMap.size > 0) {
        console.log(`  Collections detected: ${[...collectionMap.values()].join(', ')}`);
    }
    // Find and filter files
    const allFiles = walkDir(contentDir);
    const includedFiles = allFiles.filter(f => shouldInclude(f, config));
    console.log(`  Found ${allFiles.length} files, ${includedFiles.length} match include patterns`);
    // Process files
    const entries = [];
    const allChunks = [];
    for (const filePath of includedFiles) {
        try {
            const result = processFile(filePath, contentDir, collectionMap, config);
            if (result) {
                entries.push(result.entry);
                allChunks.push(...result.chunks);
            }
        }
        catch (e) {
            console.error(`  Error processing ${filePath}:`, e);
        }
    }
    console.log(`  Processed ${entries.length} entries, ${allChunks.length} chunks`);
    // Create output directories
    const chunksDir = path.join(outputDir, 'chunks');
    const metadataDir = path.join(outputDir, 'metadata');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(chunksDir, { recursive: true });
    fs.mkdirSync(metadataDir, { recursive: true });
    const generatedAt = new Date().toISOString();
    // ── Write master metadata.json (backward compat for Command-K search) ──────
    const master = { version: config.version, generatedAt, entries };
    fs.writeFileSync(path.join(outputDir, 'metadata.json'), JSON.stringify(master, null, 2));
    // ── Write per-collection metadata files for LQL engine ───────────────────
    const byCollection = new Map();
    for (const entry of entries) {
        const col = entry.type; // 'requirements', 'tests', 'page', etc.
        if (!byCollection.has(col))
            byCollection.set(col, []);
        byCollection.get(col).push(entry);
    }
    for (const [collection, colEntries] of byCollection) {
        const colIndex = { version: config.version, generatedAt, entries: colEntries };
        fs.writeFileSync(path.join(metadataDir, `${collection}.json`), JSON.stringify(colIndex, null, 2));
        console.log(`  Wrote metadata/${collection}.json (${colEntries.length} entries)`);
    }
    // ── Write chunks ──────────────────────────────────────────────────────────
    for (const chunk of allChunks) {
        fs.writeFileSync(path.join(chunksDir, `${chunk.id}.json`), JSON.stringify(chunk, null, 2));
    }
    console.log(`  Wrote metadata.json, ${byCollection.size} per-collection files, and ${allChunks.length} chunk files`);
    console.log('Done!');
}
// ─── CLI entry point ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const contentDir = args[0] || '.';
const outputDir = args[1] || './.lightworks/search';
buildIndex(path.resolve(contentDir), path.resolve(outputDir)).catch(e => {
    console.error('Build failed:', e);
    process.exit(1);
});
