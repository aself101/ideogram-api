# Contributing

Contributions are welcome. Follow the existing code patterns and include tests for new features.

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Run `npm run verify`
5. Submit a pull request

## Commits and releases

Commit messages drive releases: semantic-release cuts each version from conventional commits and generates `CHANGELOG.md`. `feat:` makes a minor release and `fix:` a patch. A `BREAKING CHANGE:` footer makes a major release. The footer must say what broke and what a user does instead (the removed or changed name, the new behaviour, the migration), because its text becomes the release note. Never squash-merge commits that carry footers: the squash drops or merges the footers and the major bump with them. Merge them as they are.

## Testing

```bash
npm run verify         # type-check, then run the tests (the pre-merge gate)
npm test               # run the tests once
npm run test:watch     # watch mode
npm run test:ui        # Vitest UI
npm run test:coverage  # coverage report
```

The suite covers every operation's request shape (HTTP is stubbed, so it makes no network calls), the v2 validators, the security features, the HTTP layer's limits and the utilities. `npm test` prints the current count.

## Running the CLI from source

```bash
npm run ideogram -- <command> [options]   # same as `ideogram`, via tsx

npm run ideogram:help
npm run ideogram:examples

# Helper commands
npm run ideogram:list-styles
npm run ideogram:list-ratios
npm run ideogram:list-resolutions

# Operations (each takes the command's own options after --)
npm run ideogram:generate
npm run ideogram:edit
npm run ideogram:remix
npm run ideogram:reframe
npm run ideogram:replace-background
npm run ideogram:upscale
npm run ideogram:describe
```

Real commands call the paid Ideogram API; add `--dry-run` to the v2 commands to price a request without running it.
