# Lightworks Search Indexer

A GitHub Action that builds search indexes from markdown files for [Lightworks](https://app.lightworks.md).

## Usage

```yaml
- uses: Lightworks-Labs/community-templates/search-indexer@v1
```

### With options

```yaml
- uses: Lightworks-Labs/community-templates/search-indexer@v1
  with:
    content-dir: './docs'
    output-dir: '.lightworks/search'
```

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `content-dir` | Directory containing markdown files to index | `.` |
| `output-dir` | Directory to write the search index | `.lightworks/search` |
| `config-path` | Path to config file | `.lightworks/search/config.json` |

## Configuration

Create a `.lightworks/search/config.json` file to customize indexing:

```json
{
  "$schema": "https://app.lightworks.md/schemas/search-config.json",
  "version": "1.0.0",
  "include": ["**/*.md"],
  "exclude": ["**/node_modules/**", "**/.git/**"],
  "maxFileSize": 1048576,
  "chunkSize": 100
}
```

## Output

The action generates:

- `.lightworks/search/metadata.json` - Index of all documents with frontmatter
- `.lightworks/search/chunks/*.json` - Content chunks for full-text search

## Example Workflow

```yaml
name: Lightworks Search Index

on:
  push:
    branches:
      - main
  workflow_dispatch:

jobs:
  build-index:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build search index
        uses: Lightworks-Labs/community-templates/search-indexer@v1

      - name: Commit index
        run: |
          git config user.name "Lightworks Bot"
          git config user.email "bot@lightworks.md"
          git add .lightworks/search/
          git diff --staged --quiet || git commit -m "chore: update search index"
          git push
```

## License

MIT
