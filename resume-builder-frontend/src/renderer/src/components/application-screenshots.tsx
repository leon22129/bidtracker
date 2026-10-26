import { useEffect, useRef, useState } from "react";
import { Camera, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type ScreenshotApplication = {
  tabId: number;
  applicationId: string;
  companyName?: string;
  jobTitle?: string;
  createdAt: number;
  submitted?: boolean;
  capturedAt?: number;
};

type ScreenshotResult = { ok?: boolean; error?: string; items?: ScreenshotApplication[] };
type ChromeApi = {
  runtime?: { sendMessage: (message: unknown) => Promise<ScreenshotResult> };
  storage?: { onChanged?: {
    addListener: (listener: (changes: Record<string, unknown>, area: string) => void) => void;
    removeListener: (listener: (changes: Record<string, unknown>, area: string) => void) => void;
  } };
};

const chromeApi = () => (globalThis as { chrome?: ChromeApi }).chrome;

export function ApplicationScreenshots() {
  const [applications, setApplications] = useState<ScreenshotApplication[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState("");
  const [confirmedId, setConfirmedId] = useState("");
  const captureRunning = useRef(false);
  const available = Boolean(chromeApi()?.runtime);

  useEffect(() => {
    const api = chromeApi();
    if (!api?.runtime) return;
    let mounted = true;
    const refresh = async () => {
      try {
        const result = await api.runtime!.sendMessage({ type: "GET_SCREENSHOT_APPLICATIONS" });
        if (!result?.ok) throw new Error(result?.error || "Unable to load screenshot applications.");
        if (!mounted) return;
        const items = Array.isArray(result.items) ? result.items : [];
        setApplications(items);
        setSelectedId((previous) => items.some((item) => item.applicationId === previous)
          ? previous : items[0]?.applicationId || "");
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : "Unable to load screenshot applications.");
      }
    };
    const onStorageChanged = (changes: Record<string, unknown>, area: string) => {
      if (area === "local" && changes.resume_ai_pending_screenshots) void refresh();
    };
    api.storage?.onChanged?.addListener(onStorageChanged);
    void refresh();
    return () => {
      mounted = false;
      api.storage?.onChanged?.removeListener(onStorageChanged);
    };
  }, []);

  const selected = applications.find((item) => item.applicationId === selectedId);
  const takeScreenshot = async () => {
    if (!selected || captureRunning.current) return;
    captureRunning.current = true;
    setIsCapturing(true);
    setError("");
    try {
      const result = await chromeApi()?.runtime?.sendMessage({
        type: "CAPTURE_APPLICATION_SCREENSHOT",
        tabId: selected.tabId,
        applicationId: selected.applicationId,
        confirmed: selected.submitted || confirmedId === selected.applicationId,
      });
      if (!result?.ok) throw new Error(result?.error || "Unable to save the screenshot.");
      setApplications((previous) => previous.map((item) => item.applicationId === selected.applicationId
        ? { ...item, capturedAt: Date.now() } : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save the screenshot.");
    } finally {
      captureRunning.current = false;
      setIsCapturing(false);
    }
  };

  return (
    <section aria-labelledby="submission-screenshots-title" className="shrink-0 border-b border-border bg-card px-4 py-3 sm:px-8">
      <div className="mx-auto max-w-7xl space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="submission-screenshots-title" className="flex items-center gap-2 text-xs font-semibold">
            <Camera className="size-4" aria-hidden="true" /> Submission screenshots
          </h2>
          <Button type="button" size="sm" disabled={!available || !selected || isCapturing || Boolean(selected.capturedAt) || (!selected.submitted && confirmedId !== selected.applicationId)} onClick={() => void takeScreenshot()}>
            {isCapturing ? <RefreshCw className="size-4 animate-spin" /> : <Camera className="size-4" />}
            {isCapturing ? "Saving…" : "Take screenshot & add application"}
          </Button>
        </div>
        {applications.length > 0 && (
          <select aria-label="Application to screenshot" value={selectedId} disabled={isCapturing}
            onChange={(event) => { setSelectedId(event.target.value); setError(""); }}
            className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {applications.map((item) => (
              <option key={item.applicationId} value={item.applicationId}>
                {[item.companyName, item.jobTitle].filter(Boolean).join(" · ") || `Application ${item.applicationId.slice(-8)}`}
                {item.capturedAt ? " — Saved" : " — Screenshot needed"}
              </option>
            ))}
          </select>
        )}
        {selected && !selected.capturedAt && !selected.submitted && (
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={confirmedId === selected.applicationId}
              onChange={(event) => setConfirmedId(event.target.checked ? selected.applicationId : "")} />
            I submitted this application successfully and the confirmation page is open.
          </label>
        )}
        <p role={error ? "alert" : "status"} className={`flex items-start gap-1.5 text-xs leading-5 ${error ? "text-destructive" : "text-muted-foreground"}`}>
          {error || (selected?.capturedAt
            ? <><Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />Added to the application table. Screenshot saved for 8 days.</>
            : !available ? "Screenshot capture is available in the Chrome extension."
              : !selected ? "Generate a resume to prepare a job. It will be added after submission and screenshot capture."
                : "After submitting, keep the confirmation page open and take its screenshot here.")}
        </p>
      </div>
    </section>
  );
}
