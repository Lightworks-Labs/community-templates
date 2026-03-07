#!/usr/bin/env node
"use strict";
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
// Default configuration
const DEFAULT_CONFIG = {
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
function matchesGlob(filePath, pattern) {
    const regexPattern = pattern
        .replace(/\*\*/g, '{{GLOBSTAR}}')
        .replace(/\*/g, '[^/]*')
        .replace(/{{GLOBSTAR}}/g, '.*')
        .replace(/\?/g, '.');
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePath);
}
function shouldInclude(filePath, config) {
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
function walkDir(dir, baseDir = dir) {
    const files = [];
    if (!fs.existsSync(dir)) {
        return files;
    }
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...walkDir(fullPath, baseDir));
        }
        else {
            const relativePath = path.relative(baseDir, fullPath);
            files.push(relativePath);
        }
    }
    return files;
}
// Generate a stable ID from a path
function generateId(filePath) {
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
function extractTitle(content, frontmatter, filePath) {
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
function isRecord(frontmatter) {
    const recordIndicators = ['status', 'priority', 'category', 'type', 'id'];
    return recordIndicators.some((key) => key in frontmatter);
}
// Chunk content into smaller pieces
function chunkContent(content, entryId, chunkSize) {
    const lines = content.split('\n');
    const chunks = [];
    const chunkIds = [];
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
function processFile(filePath, contentDir, config) {
    const fullPath = path.join(contentDir, filePath);
    // Check file size
    const stats = fs.statSync(fullPath);
    if (stats.size > config.maxFileSize) {
        console.warn(`  Skipping ${filePath}: exceeds max file size`);
        return null;
    }
    // Read and parse file
    const fileContent = fs.readFileSync(fullPath, 'utf-8');
    const { data: frontmatter, content } = (0, gray_matter_1.default)(fileContent);
    const id = generateId(filePath);
    const title = extractTitle(content, frontmatter, filePath);
    const type = isRecord(frontmatter) ? 'record' : 'page';
    const lines = content.split('\n');
    // Extract string properties
    const properties = {};
    for (const [key, value] of Object.entries(frontmatter)) {
        if (typeof value === 'string') {
            properties[key] = value;
        }
    }
    // Chunk the content
    const { chunks, chunkIds } = chunkContent(content, id, config.chunkSize);
    const entry = {
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
function loadConfig(configPath) {
    if (fs.existsSync(configPath)) {
        try {
            const configContent = fs.readFileSync(configPath, 'utf-8');
            const parsed = JSON.parse(configContent);
            console.log(`  Using config from ${configPath}`);
            return { ...DEFAULT_CONFIG, ...parsed };
        }
        catch (e) {
            console.warn(`  Failed to parse config, using defaults`);
        }
    }
    return DEFAULT_CONFIG;
}
// Main build function
async function buildIndex(contentDir, outputDir) {
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
    console.log(`  Found ${allFiles.length} files, ${includedFiles.length} match include patterns`);
    // Process files
    const entries = [];
    const allChunks = [];
    for (const filePath of includedFiles) {
        try {
            const result = processFile(filePath, contentDir, config);
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
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(chunksDir, { recursive: true });
    // Write metadata index
    const metadataIndex = {
        version: config.version,
        generatedAt: new Date().toISOString(),
        entries,
    };
    fs.writeFileSync(path.join(outputDir, 'metadata.json'), JSON.stringify(metadataIndex, null, 2));
    // Write chunks
    for (const chunk of allChunks) {
        fs.writeFileSync(path.join(chunksDir, `${chunk.id}.json`), JSON.stringify(chunk, null, 2));
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
