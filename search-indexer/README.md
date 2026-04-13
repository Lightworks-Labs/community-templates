# Lightworks Search Indexer

A GitHub Action that builds search indexes from markdown files for [Lightworks](https://app.lightworks.md).

## Usage

```yaml
- uses: Lightworks-Labs/community-templates/search-indexer@v2
```

### With options

```yaml
- uses: Lightworks-Labs/community-templates/search-indexer@v2
  with:
    content-dir: './docs'
    output-dir: '.lightworks/search'
```

### Subfolder connection

If your QMS lives in a subdirectory of the repo (e.g. `qms/`), pass explicit `content-dir` and `output-dir` so the index is written into the right location:

```yaml
- uses: Lightworks-Labs/community-templates/search-indexer@v2
  with:
    content-dir: 'qms'
    output-dir: 'qms/.lightworks/search'
    config-path: 'qms/.lightworks/search/config.json'
```

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `content-dir` | Directory containing markdown files to index | `.` |
| `output-dir` | Directory to write the search index | `.lightworks/search` |
| `config-path` | Path to config file | `.lightworks/search/config.json` |

## Output

The action generates:

- `<output-dir>/metadata.json` — Master index of all documents (backward compat)
- `<output-dir>/metadata/<collection>.json` — Per-collection index for LQL queries
- `<output-dir>/chunks/*.json` — Content chunks for full-text search

## Configuration

Create a config file at `config-path` to customize indexing:

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

## Example Workflow

```yaml
name: Lightworks Search Index

on:
  push:
    branches:
      - main
  workflow_dispatch:

permissions:
  contents: write

jobs:
  build-index:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build search index
        uses: Lightworks-Labs/community-templates/search-indexer@v2
        with:
          content-dir: 'qms'
          output-dir: 'qms/.lightworks/search'
          config-path: 'qms/.lightworks/search/config.json'

      - name: Commit index
        run: |
          git config user.name "Lightworks Bot"
          git config user.email "bot@lightworks.md"
          git add qms/.lightworks/search/
          git diff --staged --quiet || git commit -m "chore: update search index"
          git push
```

## Changelog

### v2.0.0
- Per-collection metadata files (`metadata/<collection>.json`) for LQL engine
- Explicit `content-dir` and `output-dir` inputs required for subfolder connections
- Improved collection detection via `_schema.json` discovery

### v1.0.0
- Initial release

## License

MIT
