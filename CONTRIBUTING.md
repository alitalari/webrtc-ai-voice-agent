# Contributing

Thanks for your interest. This project is in early development (Phase 0).

## Development

Requires Node >= 20 (uses npm workspaces).

```bash
npm install
npm run build         # tsc -b — also typechecks
npm run lint
npm test
npm run test:coverage
npm run format        # prettier --check (use format:write to fix)
```

## Expectations

- **Tests are required.** Deterministic logic needs unit tests; behavior that
  touches the voice loop needs integration/e2e coverage where feasible. A test
  must distinguish correct logic from broken logic — see
  [`docs/testing.md`](./docs/testing.md).
- **Instrument as you build.** New components emit their timings/states from the
  first commit — see [`docs/observability.md`](./docs/observability.md).
- **Keep the protocol the source of truth.** Shared types live in
  `packages/protocol`; don't duplicate them.
- **No secrets in code or the client.** Provider keys are server-side only.
- CI (build + lint + test) must pass before merge.

## Commit / PR flow

Branch from `master`, keep PRs focused, and describe *why* a change matters.

## License

By contributing, you agree your contributions are licensed under
[Apache 2.0](./LICENSE).
