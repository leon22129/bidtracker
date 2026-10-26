import { useEffect, useId, useRef, useState } from "react";
import { Camera, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";

type ScreenshotApplication = {
  tabId: number;
  profileTabId: string;
  applicationId: string;
  companyName?: string;
  jobTitle?: string;
  createdAt: number;
  submitted?: boolean;
  capturedAt?: number;
};

type ScreenshotResult = { ok?: boolean; error?: string; item?: ScreenshotApplication | null };
type ChromeApi = {
  runtime?: { sendMessage: (message: unknown) => Promise<ScreenshotResult> };
  storage?: { onChanged?: {
    addListener: (listener: (changes: Record<string, unknown>, area: string) => void) => void;
    removeListener: (listener: (changes: Record<string, unknown>, area: string) => void) => void;
  } };
};

const chromeApi = () => (globalThis as { chrome?: ChromeApi }).chrome;

type ApplicationScreenshotsProps = {
  profileTabId: string;
  applicationId: string | null;
  companyName?: string;
  jobTitle?: string;
  busy: boolean;
  onCapturingChange: (capturing: boolean) => void;
  onSaved: (applicationId: string) => void;
};

export function ApplicationScreenshots({
  profileTabId, applicationId, companyName, jobTitle, busy, onCapturingChange, onSaved,
}: ApplicationScreenshotsProps) {
  const [application, setApplication] = useState<ScreenshotApplication | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState("");
  const [confirmedId, setConfirmedId] = useState("");
  const captureRunning = useRef(false);
  const available = Boolean(chromeApi()?.runtime);
  const titleId = useId();

  useEffect(() => {
    const api = chromeApi();
    setError("");
    setApplication(null);
    setConfirmedId("");
    if (!api?.runtime || !applicationId) return;
    let mounted = true;
    const refresh = async () => {
      try {
        const result = await api.runtime!.sendMessage({ type: "GET_TAB_SCREENSHOT_APPLICATION", profileTabId, applicationId });
        if (!result?.ok) throw new Error(result?.error || "Unable to load this tab's prepared application.");
        if (!mounted) return;
        const item = result.item;
        setApplication(item && !item.capturedAt && item.applicationId === applicationId && item.profileTabId === profileTabId ? item : null);
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : "Unable to load this tab's prepared application.");
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
  }, [applicationId, profileTabId]);

  const selected = application?.applicationId === applicationId && application.profileTabId === profileTabId ? application : null;
  const takeScreenshot = async () => {
    if (!selected || captureRunning.current || busy) return;
    captureRunning.current = true;
    setIsCapturing(true);
    onCapturingChange(true);
    setError("");
    try {
      const result = await chromeApi()?.runtime?.sendMessage({
        type: "CAPTURE_APPLICATION_SCREENSHOT",
        tabId: selected.tabId,
        applicationId: selected.applicationId,
        profileTabId,
        confirmed: selected.submitted || confirmedId === selected.applicationId,
      });
      if (!result?.ok) throw new Error(result?.error || "Unable to save the screenshot.");
      setApplication(null);
      setConfirmedId("");
      onSaved(selected.applicationId);
      toast({
        title: "Application added",
        description: "Added to the application table. Screenshot saved for 8 days.",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save the screenshot.");
    } finally {
      captureRunning.current = false;
      setIsCapturing(false);
      onCapturingChange(false);
    }
  };

  return (
    <section data-submission-screenshot aria-labelledby={titleId} className="shrink-0 border-b border-border bg-card px-4 py-3 sm:px-8">
      <div className="mx-auto max-w-7xl space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={titleId} className="flex items-center gap-2 text-xs font-semibold">
            <Camera className="size-4" aria-hidden="true" /> Submission screenshot
          </h2>
          <Button type="button" size="sm" disabled={!available || !selected || isCapturing || busy || (!selected.submitted && confirmedId !== selected.applicationId)} onClick={() => void takeScreenshot()}>
            {isCapturing ? <RefreshCw className="size-4 animate-spin" /> : <Camera className="size-4" />}
            {isCapturing ? "Saving…" : "Take screenshot & add application"}
          </Button>
        </div>
        {selected && (
          <p className="text-xs font-medium">{[companyName, jobTitle].filter(Boolean).join(" · ")}</p>
        )}
        {selected && !selected.submitted && (
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={confirmedId === selected.applicationId}
              onChange={(event) => setConfirmedId(event.target.checked ? selected.applicationId : "")} />
            I submitted this application successfully and the confirmation page is open.
          </label>
        )}
        <p role={error ? "alert" : "status"} className={`flex items-start gap-1.5 text-xs leading-5 ${error ? "text-destructive" : "text-muted-foreground"}`}>
          {error || (!available ? "Screenshot capture is available in the Chrome extension."
            : !selected ? "No application is waiting for a screenshot in this profile tab. Generate a resume or load a prepared job here."
              : "After submitting, keep the confirmation page open and take its screenshot here.")}
        </p>
      </div>
    </section>
  );
}
