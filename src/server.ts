import type { ContributionDay, ContributionLevel } from "./index";

export interface GitLabEvent {
  created_at: string;
  action_name?: string;
  push_data?: { commit_count?: number | null; action?: string } | null;
}

export interface GetGitLabContributionsOptions {
  /** GitLab host, e.g. `git.paral.no` or `https://gitlab.com`. */
  instance?: string;
  /** Personal access token. Falls back to `GITLAB_PERSONAL_ACCESS_TOKEN`. */
  token?: string;
  /** `"last"` for the trailing 12 months, or a four-digit year. */
  year?: "last" | number;
  /**
   * Username (or numeric id) to attribute commits to. When omitted, the
   * authenticated user's own events are used via `GET /events`.
   */
  username?: string | number;
  /** Extra headers for every request (some instances require a real User-Agent). */
  headers?: Record<string, string>;
  /** Max event pages to fetch. Guards against runaway pagination. Default 60. */
  maxPages?: number;
  /** Fetch implementation. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

export interface GitLabContributionsResult {
  contributions: ContributionDay[];
  total: number;
  username?: string;
  /** GitLab prunes events after ~12 months, so older data is unavailable. */
  truncated: boolean;
}

const DAY_MS = 86_400_000;

function normalizeInstance(instance: string) {
  const trimmed = instance.replace(/\/$/, "");
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Inclusive `since` boundary (UTC midnight, `days` before `now`). */
function sinceDate(days: number, now: Date) {
  const since = new Date(now.getTime() - days * DAY_MS);
  since.setUTCHours(0, 0, 0, 0);
  return since;
}

/**
 * Expands GitLab contribution events into a dense daily series, oldest first.
 * Every day in the range is present with `count: 0` when no commits landed.
 */
export function buildContributionDays(
  events: GitLabEvent[],
  { since, now = new Date() }: { since: Date; now?: Date },
): ContributionDay[] {
  const counts = new Map<string, number>();

  for (const event of events) {
    const commits = event.push_data?.commit_count ?? 0;
    if (commits <= 0) continue;
    const day = event.created_at.slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + commits);
  }

  const start = new Date(since);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);

  const days: ContributionDay[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += DAY_MS) {
    const date = toIsoDate(new Date(t));
    const count = counts.get(date) ?? 0;
    days.push({ date, count, level: levelForCount(count) });
  }

  return days;
}

/**
 * Maps a daily commit count to one of five intensity levels using GitHub-style
 * quartile thresholds (1-4 / 5-9 / 10-19 / 20+).
 */
export function levelForCount(count: number): ContributionLevel {
  if (count <= 0) return 0;
  if (count <= 4) return 1;
  if (count <= 9) return 2;
  if (count <= 19) return 3;
  return 4;
}

/**
 * Fetches contribution events from the GitLab REST API and aggregates them into
 * a daily series. Requires a token (`read_user` or `api` scope).
 *
 * Note: GitLab counts every commit in a push, so re-pushing a branch inflates
 * the numbers — the same behaviour as GitLab's own activity graph.
 */
export async function getGitLabContributions(
  options: GetGitLabContributionsOptions = {},
): Promise<GitLabContributionsResult> {
  const {
    instance = "gitlab.com",
    year = "last",
    username,
    headers = {},
    maxPages = 60,
  } = options;

  const token = options.token ?? process.env.GITLAB_PERSONAL_ACCESS_TOKEN;
  const doFetch = options.fetch ?? fetch;
  const base = normalizeInstance(instance);
  const now = new Date();

  const days = year === "last" ? 365 : Math.round((now.getTime() - Date.UTC(year, 0, 1)) / DAY_MS) + 1;
  const since = year === "last" ? sinceDate(365, now) : new Date(Date.UTC(year, 0, 1));
  const truncated = year === "last" || days > 370;

  if (!token) {
    throw new Error(
      "A GitLab token is required. Pass `token` or set GITLAB_PERSONAL_ACCESS_TOKEN.",
    );
  }

  const requestHeaders: Record<string, string> = {
    "PRIVATE-TOKEN": token,
    "User-Agent": "lhagfoss-gitlab-commits",
    ...headers,
  };

  const events: GitLabEvent[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const params = new URLSearchParams({
      per_page: "100",
      page: String(page),
      after: toIsoDate(since),
      sort: "asc",
    });
    const path = username
      ? `/api/v4/users/${encodeURIComponent(String(username))}/events`
      : "/api/v4/events";
    const response = await doFetch(`${base}${path}?${params}`, {
      headers: requestHeaders,
    });

    if (!response.ok) {
      throw new Error(
        `GitLab events request failed (${response.status}${response.statusText ? ` ${response.statusText}` : ""})`,
      );
    }

    const batch = (await response.json()) as GitLabEvent[];
    events.push(...batch);
    if (batch.length < 100) break;
  }

  const contributions = buildContributionDays(events, { since, now });

  return {
    contributions,
    total: contributions.reduce((sum, day) => sum + day.count, 0),
    username: username === undefined ? undefined : String(username),
    truncated,
  };
}
