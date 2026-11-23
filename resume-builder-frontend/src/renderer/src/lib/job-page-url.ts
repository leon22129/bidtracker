/** Compare browser pages without changing the original URL saved with the prepared job. */
export function comparableJobUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "");

    // Ashby's posting UUID identifies the job on both the posting and application routes.
    // Restrict this to its hosted board and known routes: another company/job or an unknown
    // path must still count as a different page. Submission/tracking query values do not
    // change the job identified by this path.
    if (host === "jobs.ashbyhq.com" && !url.port && ["http:", "https:"].includes(url.protocol)) {
      const posting = path.match(/^\/([^/]+)\/([a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})(?:\/(?:application(?:\/(?:confirmation|submitted|success|thank[-_]you))?|confirmation|submitted|success|thank[-_]you))?$/i);
      if (posting) return `${host}/${posting[1]}/${posting[2].toLowerCase()}`;
    }

    const ignored = new Set([
      "source", "src", "ref", "referrer", "trackingid", "trk", "trkinfo", "position",
      "pagenum", "origin", "originalsubdomain", "savedsearchid", "refid", "eburl", "from",
      "lipi", "licu", "fbclid", "gclid", "mc_cid", "mc_eid", "ittk", "sid", "jobclick",
      "campaignid", "clickid", "applyflowversion",
    ]);
    const params = new URLSearchParams();
    [...url.searchParams.keys()].sort().forEach((key) => {
      const lower = key.toLowerCase();
      if (ignored.has(lower) || ["utm_", "gh_", "ref_"].some((prefix) => lower.startsWith(prefix))) return;
      url.searchParams.getAll(key).forEach((value) => params.append(lower, value));
    });
    const query = params.toString();
    return `${host}${path}${query ? `?${query}` : ""}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}
