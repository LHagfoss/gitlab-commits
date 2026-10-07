"use client";

import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type ContributionLevel = 0 | 1 | 2 | 3 | 4;

export interface ContributionDay {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  count: number;
  level: ContributionLevel;
}

export type ColorPalette = [string, string, string, string, string];

export interface UseGitLabContributionsOptions {
  /**
   * URL of an endpoint that returns `{ contributions: ContributionDay[] }`.
   *
   * Self-hosted GitLab instances are usually private, so GitLab's API cannot be
   * called from the browser. Point this at your own server route (for example
   * `/api/gitlab-contributions`) that uses `getGitLabContributions` from
   * `@lhagfoss/gitlab-commits/server` with a `PRIVATE-TOKEN`.
   */
  endpoint: string;
  /** `"last"` (trailing 12 months) or a four-digit year. */
  year?: "last" | number;
  username?: string;
}

/**
 * Loads contribution data from an endpoint you control. The endpoint should
 * return the same shape as `{ contributions: ContributionDay[] }`.
 */
export function useGitLabContributions({
  endpoint,
  year = "last",
  username,
}: UseGitLabContributionsOptions) {
  const [contributions, setContributions] = useState<ContributionDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    async function load() {
      try {
        const base = endpoint.replace(/\/$/, "");
        const query = new URLSearchParams({ y: String(year) });
        if (username) query.set("username", username);
        const response = await fetch(`${base}?${query}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`GitLab contributions request failed (${response.status})`);
        }
        const result = (await response.json()) as { contributions?: ContributionDay[] };
        setContributions(result.contributions ?? []);
        setError(null);
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) {
          setError(
            cause instanceof Error
              ? cause
              : new Error("Could not load GitLab contributions"),
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [endpoint, username, year]);

  return { contributions, loading, error };
}

export interface GitLabCommitsProps {
  /**
   * Pre-fetched, a dense daily series (oldest first) covering at least the
   * displayed window. When provided, no network request is made.
   */
  contributions?: ContributionDay[];
  /** Endpoint returning `{ contributions: ContributionDay[] }` (see the hook). */
  endpoint?: string;
  username?: string;
  year?: "last" | number;
  className?: string;
  style?: CSSProperties;
  /** Link target for the footer handle. Defaults to the GitLab profile URL. */
  profileUrl?: string;
  /** GitLab host, used to build the default profile URL. */
  instance?: string;
  weeks?: number;
  showFooter?: boolean;
  colors?: ColorPalette;
  loadingLabel?: string;
  errorLabel?: string;
  contributionLabel?: string;
  loading?: boolean;
  error?: Error | null;
}

const defaultColors: ColorPalette = [
  "#171717",
  "#404040",
  "#737373",
  "#d4d4d4",
  "#ffffff",
];

function defaultProfileUrl(instance: string, username?: string) {
  const host = instance.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return username ? `https://${host}/${username}` : `https://${host}`;
}

export function GitLabCommits({
  contributions,
  endpoint,
  username,
  year = "last",
  className,
  style,
  profileUrl,
  instance = "gitlab.com",
  weeks = 53,
  showFooter = true,
  colors = defaultColors,
  loadingLabel = "Loading activity\u2026",
  errorLabel = "Could not load activity.",
  contributionLabel = "commit",
  loading: loadingProp,
  error: errorProp,
}: GitLabCommitsProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [visibleWeeks, setVisibleWeeks] = useState(weeks);
  const [activeDate, setActiveDate] = useState<string | null>(null);

  const shouldFetch = contributions === undefined && Boolean(endpoint);
  const fetched = useGitLabContributions({
    endpoint: endpoint ?? "",
    year,
    username,
  });

  const data = contributions ?? fetched.contributions;
  const loading = loadingProp ?? (shouldFetch ? fetched.loading : false);
  const error = errorProp ?? (shouldFetch ? fetched.error : null);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const update = () => {
      const width = element.clientWidth;
      setVisibleWeeks(Math.min(weeks, width < 360 ? 20 : width < 560 ? 36 : 53));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [weeks]);

  const days = useMemo(
    () => data.slice(-(visibleWeeks * 7)),
    [data, visibleWeeks],
  );
  const total = days.reduce((sum, day) => sum + day.count, 0);

  return (
    <div ref={rootRef} className={className} style={{ width: "100%", ...style }}>
      {loading ? (
        <div
          aria-label={loadingLabel}
          style={{ height: 96, borderRadius: 4, background: colors[0] }}
        />
      ) : error ? (
        <p role="status" style={{ margin: 0, opacity: 0.6 }}>
          {errorLabel}
        </p>
      ) : (
        <div
          role="grid"
          aria-label={`${total} ${contributionLabel} contributions in the displayed period`}
          style={{
            display: "grid",
            width: "100%",
            gap: 4,
            gridTemplateColumns: `repeat(${Math.max(visibleWeeks, 1)}, minmax(0, 1fr))`,
            gridTemplateRows: "repeat(7, minmax(0, 1fr))",
            gridAutoFlow: "column",
          }}
        >
          {days.map((day) => {
            const isActive = activeDate === day.date;
            const countLabel = `${contributionLabel}${day.count === 1 ? "" : "s"}`;

            return (
              <span
                key={day.date}
                role="gridcell"
                tabIndex={0}
                aria-label={`${day.count} ${countLabel} on ${day.date}`}
                onPointerEnter={() => setActiveDate(day.date)}
                onPointerLeave={() => setActiveDate(null)}
                onFocus={() => setActiveDate(day.date)}
                onBlur={() => setActiveDate(null)}
                style={{
                  position: "relative",
                  zIndex: isActive ? 1 : 0,
                  display: "block",
                  aspectRatio: "1",
                  borderRadius: 2,
                  background: colors[day.level],
                  outline: "none",
                  cursor: "default",
                  transform: isActive ? "scale(1.18)" : "scale(1)",
                  transition:
                    "transform 180ms cubic-bezier(0.22, 1, 0.36, 1), filter 180ms ease",
                  filter: isActive ? "brightness(1.2)" : "brightness(1)",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    bottom: "calc(100% + 8px)",
                    left: "50%",
                    padding: "6px 8px",
                    border: "1px solid rgba(255, 255, 255, 0.14)",
                    borderRadius: 6,
                    background: "#171717",
                    color: "#fafafa",
                    fontSize: 12,
                    lineHeight: 1.2,
                    whiteSpace: "nowrap",
                    pointerEvents: "none",
                    opacity: isActive ? 1 : 0,
                    transform: isActive
                      ? "translate(-50%, 0) scale(1)"
                      : "translate(-50%, 4px) scale(0.96)",
                    transformOrigin: "bottom center",
                    transition:
                      "opacity 140ms ease, transform 180ms cubic-bezier(0.22, 1, 0.36, 1)",
                    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
                  }}
                >
                  {day.count} {countLabel} · {day.date}
                </span>
              </span>
            );
          })}
        </div>
      )}
      {showFooter && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 12,
            fontSize: 12,
            opacity: 0.6,
          }}
        >
          <span>
            {loading
              ? loadingLabel
              : error
                ? errorLabel
                : `${total} ${contributionLabel}${total === 1 ? "" : "s"}`}
          </span>
          <a
            href={profileUrl ?? defaultProfileUrl(instance, username)}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "inherit" }}
          >
            @{username ?? instance.replace(/^https?:\/\//, "").replace(/\/$/, "")}
          </a>
        </div>
      )}
    </div>
  );
}
