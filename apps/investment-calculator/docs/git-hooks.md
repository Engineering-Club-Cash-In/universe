# Git Hooks Setup

This project uses a pre-commit hook to ensure code quality before commits.

## What the pre-commit hook does

When you commit changes to the investment-calculator app, the hook will automatically:

1. **Run all tests** - Ensures no tests are broken
2. **Run the build** - Ensures the TypeScript compiles and the app builds successfully

## How it works

The pre-commit hook is located at `.git/hooks/pre-commit` and runs the `precommit` script defined in `package.json`.

## Skipping the hook (use with caution)

If you need to commit without running the checks (not recommended), you can use:

```bash
git commit --no-verify -m "your message"
```

## Manual testing

You can manually run the pre-commit checks at any time:

```bash
bun run precommit
```

This will run the same checks that the git hook runs.

## Troubleshooting

If the pre-commit hook isn't working:

1. Check that the hook file exists: `ls -la .git/hooks/pre-commit`
2. Ensure it's executable: `chmod +x .git/hooks/pre-commit`
3. Run the checks manually to see specific errors: `bun run precommit`