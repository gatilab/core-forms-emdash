# Handoff: where the port stands (paused 2026-10-05)

The full EmDash port of Core Forms 4.11.1 is paused at Wave 0 of Phase 1. Nothing here is released; `main` is still v0.1.0, which gatilab.com runs.

## Branches

| Branch | State |
|---|---|
| `main` (tag `v0.1.0`) | Forms core used by the Gatilab site (`emdash-next` links this checkout). Unchanged. |
| `next` | Integration branch: specs `docs/port/00–06`, architecture `10`, decision log `11` (with Gaurav's answers), build plan `12`. No code merged yet. |
| `pkg/p1.0a` | Contracts & skeleton, about half done (WIP). See `docs/port/handoff/p1.0a.md` on that branch: what's done, what remains, and contract decisions that need review. |
| `pkg/p1.1` | WP oracle: environment prototype only (Playground php-wasm, PHP 8.3, libxml 2.9.10, WP 7.1.2 on SQLite, deterministic). No goldens or fixtures yet. See `docs/port/handoff/p1.1.md` on that branch. |

## Resuming

1. Recreate the worktrees (one per package, outside the main checkout):
   `git worktree add ../core-forms-emdash-wt/next next` and `git worktree add ../core-forms-emdash-wt/<id> pkg/<id>`, then `pnpm install` in each.
2. Restore the read-only WordPress reference source in `.reference/core-forms-wp/` (git-ignored): copy `wp-content/plugins/core-forms` from the WordPress site over SSH, read-only.
3. Fixture data for the oracle comes from `emdash-next/migration/data/core-forms-data.json` (git-ignored there; produced by `migration/scripts/export-wordpress.sh`). It holds live credentials and real addresses: commit only the anonymized copy (see `p1.1.md`).
4. Finish P1.0a and P1.1, review and merge them into `next`, then launch Wave 1 as described in `12-plan.md`.

## Decisions already made

Scope: all four areas (forms + smart forms → workflows + integrations → analytics → payments + licensing); WordPress-only integrations import but don't run. Email for gatilab.com via a direct Emailit transport; package `@gatilab/emdash-core-forms` (GPL-2.0-or-later, free, 1.0.0 at the Phase 1 gate); analytics on by default; no live store moves to Core Commerce. Details in `11-decisions.md`.
