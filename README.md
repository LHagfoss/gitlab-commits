# @lhagfoss/gitlab-commits

A responsive, dependency-light GitLab contribution graph for React — for
`gitlab.com` and self-hosted instances. It inherits your typography, requires no
CSS import, and adapts the number of visible weeks to its container.

Hover a contribution square — or focus it with the keyboard — to reveal the
exact count and date with a smooth tooltip.

> Sibling of [`@lhagfoss/github-commits`](https://github.com/LHagfoss/github-commits).
> The visual layer is identical; only the data source differs.

## Why GitLab needs a server route

GitHub exposes public contribution data through a third-party proxy, so the
GitHub component can fetch straight from the browser.

GitLab has no equivalent, and **self-hosted instances are usually private** —
anonymous requests to `/api/v4/*` return `401`/`403` and a private profile's
contribution calendar is empty. So the data must be fetched **server-side with a
token**. This package ships a `server` entry for exactly that.

## Install

```bash
bun add @lhagfoss/gitlab-commits
```

## 1. Server route

Create a route that hides your token and returns the contribution series.

```ts
// app/api/gitlab-contributions/route.ts
import { NextResponse } from "next/server";
import { getGitLabContributions } from "@lhagfoss/gitlab-commits/server";

export const revalidate = 3600;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const username = [REDACTED] ?? "LHagfoss";

  const result = await getGitLabContributions({
    instance: "git.paral.no",
    username,
  });

  return NextResponse.json({ contributions: result.contributions });
}
```

Set the token as an environment variable (never `NEXT_PUBLIC_*`):

```bash
GITLAB_PERSONAL_ACCESS_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx
```

Create one at **User settings → Access tokens** with the `read_user` scope
(`read_api` also works). For a fully private instance you may prefer `api`.

## 2. Render the graph

```tsx
import { GitLabCommits } from "@lhagfoss/gitlab-commits";

export function Activity() {
  return (
    <GitLabCommits
      endpoint="/api/gitlab-contributions"
      username="LHagfoss"
      instance="git.paral.no"
      contributionLabel="commit"
    />
  );
}
```

Or fetch on the server and pass the data straight in (no client request):

```tsx
import { GitLabCommits } from "@lhagfoss/gitlab-commits";
import { getGitLabContributions } from "@lhagfoss/gitlab-commits/server";

export async function Activity() {
  const { contributions } = await getGitLabContributions({
    instance: "git.paral.no",
    username: "LHagfoss",
  });

  return (
    <GitLabCommits
      contributions={contributions}
      username="LHagfoss"
      instance="git.paral.no"
    />
  );
}
```

For your own markup, use the data hook:

```tsx
import { useGitLabContributions } from "@lhagfoss/gitlab-commits";

const { contributions, loading, error } = useGitLabContributions({
  endpoint: "/api/gitlab-contributions",
});
```

## Props

| Prop                | Type                                       | Default          | Notes |
| ------------------- | ------------------------------------------ | ---------------- | ----- |
| `contributions`     | `ContributionDay[]`                        | —                | Pre-fetched data; skips the network entirely. |
| `endpoint`          | `string`                                   | —                | Returns `{ contributions: [...] }`. |
| `username`          | `string`                                   | —                | Used for the profile link and request param. |
| `instance`          | `string`                                   | `"gitlab.com"`   | GitLab host, e.g. `git.paral.no`. |
| `year`              | `"last" \| number`                         | `"last"`         | Trailing 12 months, or a year. |
| `weeks`             | `number`                                   | `53`             | Upper bound; shrinks on narrow containers. |
| `colors`            | `[string×5]`                               | dark neutral     | Level 0 → level 4. |
| `profileUrl`        | `string`                                   | derived          | Footer link target. |
| `showFooter`        | `boolean`                                  | `true`           | Totals + handle row. |
| `contributionLabel` | `string`                                   | `"commit"`       | Singular noun for tooltips/ARIA. |

## Behaviour & caveats

- **~12-month window.** GitLab prunes contribution events after roughly a year,
  so older history is not retrievable (the same limit as GitLab's own profile
  graph). `getGitLabContributions` reports this as `truncated: true`.
- **Commit counts are push counts.** GitLab counts every commit in a push, so
  re-pushing or rebasing a branch inflates numbers — identical to GitLab's
  activity graph. Large initial/backfill pushes can create tall spikes on one
  day; map them to your own scale via `colors` if needed.
- **Private activity counts.** Because the request is authenticated, commits in
  private projects are included — which is usually what "my work commits" means.
- **User-Agent matters.** Some GitLab front doors reject requests without a
  User-Agent; this package sends one, and you can override via `headers`.

## API

### `getGitLabContributions(options)`

```ts
const { contributions, total, truncated, username } =
  await getGitLabContributions({
    instance: "git.paral.no",
    username: "LHagfoss",   // omit to use the authenticated user's own events
    year: "last",
    token: process.env.GITLAB_PERSONAL_ACCESS_TOKEN,
  });
```

Returns a **dense** daily series (oldest first), with every day present —
including zero-commit days — so the grid aligns to weeks.

### `buildContributionDays(events, { since, now })`

Lower-level helper if you already have GitLab events and want the dense series.

## Data source

This package reads `GET /api/v4/events` (or `GET /api/v4/users/:id/events`) and
aggregates `push_data.commit_count` per day. It never sends your token to the
browser.

## Publish

```bash
npm login
npm publish --access public
```
