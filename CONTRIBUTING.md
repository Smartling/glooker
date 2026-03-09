# Contributing to Glooker

Thanks for your interest in contributing! Here's how to get started.

## Development setup

```bash
git clone https://github.com/Smartling/glooker.git
cd glooker
npm install
cp .env.example .env.local
# Edit .env.local with your GitHub token and LLM API key
npm run dev
```

By default, Glooker uses SQLite (zero config). No database setup needed.

## Making changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Test locally with `npm run dev`
4. Ensure `npm run build` passes
5. Submit a pull request

## Code structure

- `src/app/` — Next.js pages and API routes
- `src/lib/` — Core logic (GitHub fetcher, LLM analyzer, DB, aggregator)
- `src/lib/db/` — Database abstraction (SQLite + MySQL)
- `src/lib/llm-provider.ts` — LLM provider factory (OpenAI, Anthropic, Smartling, custom)

## Guidelines

- Keep it simple — avoid over-engineering
- Test with both SQLite and MySQL if touching DB code
- The `CLAUDE.md` file has architectural context and known gotchas

## Issues

Use GitHub Issues for bugs and feature requests. Please include:
- Steps to reproduce (for bugs)
- Expected vs actual behavior
- Your environment (OS, Node.js version, LLM provider)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
