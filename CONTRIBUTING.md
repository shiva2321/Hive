# Contributing to Hive

Thank you for your interest in contributing! Here is how to get started.

## Development Setup

```bash
git clone https://github.com/your-org/universal-ai-memory
cd universal-ai-memory
npm install
```

## Project Structure

See the [Architecture section in README.md](README.md#️-architecture) for a full source tree overview.

## Running Tests

```bash
npm run test:all
```

All pull requests must pass the full test suite before merging.

## Adding a New Provider Parser

1. Create `src/ingestion/parsers/<provider>_parser.ts`
2. Export a function that converts raw provider data to `CanonicalConversation[]` (see `src/core/types.ts`)
3. Register the parser in `src/ingestion/importer.ts`
4. Add tests under `test/`
5. Add the new `AIProvider` string literal to the union type in `src/core/types.ts`

## Code Style

- TypeScript strict mode is enabled — no implicit `any`
- Keep functions small and single-purpose
- All security-sensitive paths (crypto, sanitizer) require code review from a maintainer

## Pull Request Process

1. Fork the repo and create a feature branch: `git checkout -b feature/my-feature`
2. Make your changes with tests
3. Run `npm run test:all` and confirm all pass
4. Open a PR with a clear description of the change and why

## Security Contributions

Please see [`SECURITY.md`](SECURITY.md) before reporting any security issues.
