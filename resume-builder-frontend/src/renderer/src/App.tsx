"use client";

import { useState, useEffect, useRef } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Toaster } from "@/components/ui/toaster";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertCircle,
  Plus,
  Loader2,
  X,
  Pencil,
  Trash2,
  LogOut,
  User,
  Settings,
} from "lucide-react";
import type { AiProfile } from "../../shared/ai-profiles";
import type { WebAuthStatus } from "../../shared/auth";
import { ProfileWorkspace } from "@/components/profile-workspace";
import { ProfileSettingsOnlyDialog } from "@/components/profile-settings-only-dialog";
import { ExtensionSettingsDialog } from "@/components/extension-settings-dialog";
import { toast } from "@/components/ui/use-toast";
import { ToastAction } from "@/components/ui/toast";
import {
  getFriendlyErrorMessage,
  STORAGE_KEY_ACTIVE_TAB,
} from "@/lib/profile-utils";
import { getApiBaseUrl, getCurrentBrowserTabKey, setApiBaseUrl } from "@/lib/extension-storage";

const STORAGE_KEY_OPEN_TABS = "resume_open_profile_tabs_v2";

// ─── Tab model ────────────────────────────────────────────────────────────────

interface Tab {
  tabId: string;
  profileId: string;
  label: string;
}

function generateTabLabel(profile: AiProfile, existingTabs: Tab[]): string {
  const base = profile.name || "Unnamed";
  const siblingLabels = new Set(
    existingTabs.filter((t) => t.profileId === profile.id).map((t) => t.label),
  );
  if (!siblingLabels.has(base)) return base;
  let n = 2;
  while (siblingLabels.has(`${base} - ${n}`)) n++;
  return `${base} - ${n}`;
}

function persistTabs(storagePrefix: string, tabs: Tab[]) {
  localStorage.setItem(`${storagePrefix}:${STORAGE_KEY_OPEN_TABS}`, JSON.stringify(tabs));
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function Home() {
  const [profiles, setProfiles] = useState<AiProfile[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("");
  const [generatingProfiles, setGeneratingProfiles] = useState<Set<string>>(
    new Set(),
  );
  const [pendingResultTabIds, setPendingResultTabIds] = useState<Set<string>>(
    new Set(),
  );
  const [tabCompanyNames, setTabCompanyNames] = useState<
    Record<string, string>
  >({});

  const [webAuthStatus, setWebAuthStatus] = useState<WebAuthStatus | null>(
    null,
  );
  const [webUsername, setWebUsername] = useState("");
  const [webPassword, setWebPassword] = useState("");
  const [webAuthMessage, setWebAuthMessage] = useState("");
  const [isWebAuthRunning, setIsWebAuthRunning] = useState(false);
  const [backendUrl, setBackendUrl] = useState("");
  const [backendUrlMessage, setBackendUrlMessage] = useState("");
  const [storagePrefix, setStoragePrefix] = useState("resume_ai:standalone");
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Profile settings dialog (edit mode)
  const [settingsProfileId, setSettingsProfileId] = useState<string | null>(
    null,
  );

  // Which profile's preview to trigger
  const [triggerPreviewFor, setTriggerPreviewFor] = useState<string | null>(
    null,
  );

  const legacyProfileIdRef = useRef<string | null>(null);
  const notificationDismissersRef = useRef<Map<string, () => void>>(new Map());

  useEffect(() => {
    const chromeApi = (globalThis as { chrome?: { runtime?: {
      sendMessage: (message: unknown) => Promise<any>;
      onMessage: {
        addListener: (listener: (message: any) => void) => void;
        removeListener: (listener: (message: any) => void) => void;
      };
    } } }).chrome;
    if (!chromeApi?.runtime) return;

    const showScreenshotToast = (item: { tabId: number; applicationId: string }) => {
      let dismissToast: (() => void) | undefined;
      const { dismiss } = toast({
        title: "Application submitted",
        description: "Save the visible confirmation page with this application.",
        duration: Infinity,
        action: (
          <ToastAction
            altText="Take screenshot"
            onClick={async () => {
              dismissToast?.();
              toast({ title: "Taking screenshot…", description: "Keep the submitted page open." });
              const result = await chromeApi.runtime!.sendMessage({
                type: "CAPTURE_APPLICATION_SCREENSHOT",
                tabId: item.tabId,
                applicationId: item.applicationId,
              }).catch((error: unknown) => ({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              }));
              if (result?.ok) {
                toast({
                  title: "Screenshot saved",
                  description: "It will remain attached to the application for 8 days.",
                });
              } else {
                toast({
                  variant: "destructive",
                  title: "Screenshot not saved",
                  description: result?.error || "Please try again.",
                  duration: Infinity,
                  action: (
                    <ToastAction altText="Try again" onClick={() => showScreenshotToast(item)}>
                      Try again
                    </ToastAction>
                  ),
                });
              }
            }}
          >
            Take screenshot
          </ToastAction>
        ),
      });
      dismissToast = dismiss;
    };

    const onMessage = (message: any) => {
      if (message?.type === "APPLICATION_SCREENSHOT_READY") {
        showScreenshotToast({ tabId: Number(message.tabId), applicationId: message.applicationId });
      }
    };
    chromeApi.runtime.onMessage.addListener(onMessage);
    void chromeApi.runtime.sendMessage({ type: "GET_PENDING_SCREENSHOTS" })
      .then((result: any) => {
        const latest = Array.isArray(result?.items) ? result.items.at(-1) : null;
        if (latest) showScreenshotToast(latest);
      })
      .catch(() => undefined);
    return () => chromeApi.runtime!.onMessage.removeListener(onMessage);
  }, []);

  // ─── Data loading ────────────────────────────────────────────────────────────

  const loadData = async (prefix = storagePrefix) => {
    try {
      const loadedProfiles = await window.aiProfiles.list();
      setProfiles(loadedProfiles);

      // Restore tabs from storage
      const savedTabs: Tab[] = (() => {
        try {
          return JSON.parse(
            localStorage.getItem(`${prefix}:${STORAGE_KEY_OPEN_TABS}`) || "[]",
          );
        } catch {
          return [];
        }
      })();
      const validTabs = savedTabs.filter((t) =>
        loadedProfiles.some((p) => p.id === t.profileId),
      );
      let initialTabs: Tab[];
      if (validTabs.length > 0) {
        initialTabs = validTabs;
      } else {
        initialTabs = loadedProfiles.map((p) => ({
          tabId: crypto.randomUUID(),
          profileId: p.id,
          label: p.name || "Unnamed",
        }));
        persistTabs(prefix, initialTabs);
      }
      setTabs(initialTabs);

      // Restore active tab
      const savedActiveTabId =
        localStorage.getItem(`${prefix}:${STORAGE_KEY_ACTIVE_TAB}`) || "";
      const resolvedActiveTabId =
        initialTabs.find((t) => t.tabId === savedActiveTabId)?.tabId ||
        initialTabs[0]?.tabId ||
        "";
      setActiveTabId(resolvedActiveTabId);
      if (resolvedActiveTabId)
        localStorage.setItem(`${prefix}:${STORAGE_KEY_ACTIVE_TAB}`, resolvedActiveTabId);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void getApiBaseUrl().then(setBackendUrl).catch(() => setBackendUrlMessage("Unable to load backend URL."));
    void getCurrentBrowserTabKey().then((tabKey) => {
      const prefix = `resume_ai:${tabKey}`;
      setStoragePrefix(prefix);
      legacyProfileIdRef.current = localStorage.getItem(`${prefix}:${STORAGE_KEY_ACTIVE_TAB}`);
      return window.webAuth.status().then((status) => {
        setWebAuthStatus(status);
        if (status.authenticated) void loadData(prefix);
      }).catch((err) => {
        setWebAuthStatus({ authenticated: false });
        setWebAuthMessage(getFriendlyErrorMessage(err, "Unable to reach the backend. Check the API URL and connection."));
      });
    })
      .catch((err) => {
        setWebAuthStatus({ authenticated: false });
        setWebAuthMessage(getFriendlyErrorMessage(err, "Unable to check your login."));
      });
  }, []);

  useEffect(() => {
    const handleInvalidAuth = () => {
      setWebAuthStatus({ authenticated: false });
      setProfiles([]);
      setTabs([]);
      setActiveTabId("");
      setWebAuthMessage("Your session expired. Please sign in again.");
    };
    window.addEventListener("resume-ai-auth-invalid", handleInvalidAuth);
    return () => window.removeEventListener("resume-ai-auth-invalid", handleInvalidAuth);
  }, []);

  const handleWebLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setWebAuthMessage("");
    setIsWebAuthRunning(true);
    try {
      const status = await window.webAuth.login(webUsername, webPassword);
      setWebAuthStatus(status);
      setWebPassword("");
      if (status.authenticated) await loadData(storagePrefix);
    } catch (err) {
      setWebAuthMessage(getFriendlyErrorMessage(err, "Unable to sign in."));
    } finally {
      setIsWebAuthRunning(false);
    }
  };

  const handleBackendUrlSave = async () => {
    try {
      await setApiBaseUrl(backendUrl);
      setBackendUrlMessage("Backend URL saved.");
    } catch (err) {
      setBackendUrlMessage(err instanceof Error ? err.message : "Unable to save backend URL.");
    }
  };

  const handleWebLogout = async () => {
    await window.webAuth.logout();
    setWebAuthStatus({ authenticated: false });
    setProfiles([]);
    setTabs([]);
    setActiveTabId("");
    setSettingsOpen(false);
  };

  // ─── Tab operations ──────────────────────────────────────────────────────────

  const handleTabClick = (tabId: string) => {
    setActiveTabId(tabId);
    localStorage.setItem(`${storagePrefix}:${STORAGE_KEY_ACTIVE_TAB}`, tabId);
    setPendingResultTabIds((prev) => {
      const next = new Set(prev);
      next.delete(tabId);
      return next;
    });
    const tab = tabs.find((t) => t.tabId === tabId);
    if (tab) {
      const dismiss = notificationDismissersRef.current.get(
        tab.profileId + ":" + tabId,
      );
      if (dismiss) {
        dismiss();
        notificationDismissersRef.current.delete(tab.profileId + ":" + tabId);
      }
    }
  };

  const handleOpenTab = (profileId: string) => {
    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) return;
    const newTabId = crypto.randomUUID();
    setTabs((prev) => {
      const newTab: Tab = {
        tabId: newTabId,
        profileId,
        label: generateTabLabel(profile, prev),
      };
      const next = [...prev, newTab];
      persistTabs(storagePrefix, next);
      return next;
    });
    setActiveTabId(newTabId);
    localStorage.setItem(`${storagePrefix}:${STORAGE_KEY_ACTIVE_TAB}`, newTabId);
  };

  const handleCloseTab = (tabId: string) => {
    const closingTab = tabs.find((t) => t.tabId === tabId);
    if (closingTab) {
      const key = closingTab.profileId + ":" + tabId;
      const dismiss = notificationDismissersRef.current.get(key);
      if (dismiss) {
        dismiss();
        notificationDismissersRef.current.delete(key);
      }
    }
    setPendingResultTabIds((prev) => {
      const next = new Set(prev);
      next.delete(tabId);
      return next;
    });
    setTabCompanyNames((prev) => {
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
    setTabs((prev) => {
      const next = prev.filter((t) => t.tabId !== tabId);
      persistTabs(storagePrefix, next);
      if (activeTabId === tabId) {
        const idx = prev.findIndex((t) => t.tabId === tabId);
        const nextActive =
          next[Math.max(0, idx - 1)]?.tabId || next[0]?.tabId || "";
        setActiveTabId(nextActive);
        if (nextActive)
          localStorage.setItem(`${storagePrefix}:${STORAGE_KEY_ACTIVE_TAB}`, nextActive);
        else localStorage.removeItem(`${storagePrefix}:${STORAGE_KEY_ACTIVE_TAB}`);
      }
      return next;
    });
  };

  // ─── Profile operations ──────────────────────────────────────────────────────

  const handleProfileUpdated = (updated: AiProfile) => {
    setProfiles((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    // Update tab labels for this profile
    setTabs((prev) => {
      const profileTabs = prev.filter((t) => t.profileId === updated.id);
      if (profileTabs.length === 0) return prev;
      const base = updated.name || "Unnamed";
      let n = 1;
      return prev.map((t) => {
        if (t.profileId !== updated.id) return t;
        const label = n === 1 ? base : `${base} - ${n}`;
        n++;
        return { ...t, label };
      });
    });
  };

  const handleGeneratingChange = (tabId: string, generating: boolean) => {
    setGeneratingProfiles((prev) => {
      const next = new Set(prev);
      generating ? next.add(tabId) : next.delete(tabId);
      return next;
    });
    if (generating) {
      setPendingResultTabIds((prev) => {
        const next = new Set(prev);
        next.delete(tabId);
        return next;
      });
    }
  };

  const handleGenerationComplete = (
    profileId: string,
    tabId: string,
    companyName?: string,
  ) => {
    const profile = profiles.find((p) => p.id === profileId);
    const tab = tabs.find((t) => t.tabId === tabId);
    if (companyName) {
      setTabCompanyNames((prev) => ({ ...prev, [tabId]: companyName }));
    }
    setPendingResultTabIds((prev) => {
      const next = new Set(prev);
      next.add(tabId);
      return next;
    });
    const key = profileId + ":" + tabId;
    const oldDismiss = notificationDismissersRef.current.get(key);
    if (oldDismiss) oldDismiss();
    let dismissNotification: (() => void) | undefined;
    const { dismiss } = toast({
      title: `${tab?.label || profile?.name || "Profile"} — Resume Ready`,
      description: "Generation complete and the application was saved. Click View to preview and download.",
      duration: Infinity,
      action: (
        <ToastAction
          altText="View"
          onClick={() => {
            handleTabClick(tabId);
            setTriggerPreviewFor(tabId);
            dismissNotification?.();
          }}
        >
          View
        </ToastAction>
      ),
    });
    dismissNotification = dismiss;
    notificationDismissersRef.current.set(key, dismiss);
  };

  // ─── Browser login ──────────────────────────────────────────────────────────

  if (!webAuthStatus) {
    return (
      <main className="min-h-screen bg-background px-5 py-10">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-lg items-center justify-center">
          <Card className="w-full border-white/10 bg-card/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Sign in
              </CardTitle>
              <CardDescription>Checking your account session.</CardDescription>
            </CardHeader>
            <CardContent><Spinner /></CardContent>
          </Card>
        </div>
      </main>
    );
  }

  if (!webAuthStatus.authenticated) {
    return (
      <main className="min-h-screen bg-background px-5 py-10">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-lg items-center justify-center">
          <Card className="w-full border-white/10 bg-card/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Sign in to Resume Builder
              </CardTitle>
              <CardDescription>Use the credentials provided for your account.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-6 space-y-2 border-b pb-5">
                <Field>
                  <FieldLabel htmlFor="logged-out-backend-url">Backend API URL</FieldLabel>
                  <div className="flex gap-2">
                    <Input
                      id="logged-out-backend-url"
                      value={backendUrl}
                      onChange={(event) => setBackendUrl(event.target.value)}
                      placeholder="http://127.0.0.1:3001/api"
                      type="url"
                    />
                    <Button type="button" variant="outline" onClick={() => void handleBackendUrlSave()}>
                      Save
                    </Button>
                  </div>
                  {backendUrlMessage && (
                    <p className="text-xs text-muted-foreground">{backendUrlMessage}</p>
                  )}
                </Field>
              </div>
              <form className="space-y-5" onSubmit={handleWebLogin}>
                <Field>
                  <FieldLabel htmlFor="web-username">Username</FieldLabel>
                  <Input
                    id="web-username"
                    value={webUsername}
                    onChange={(event) => setWebUsername(event.target.value)}
                    autoComplete="username"
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="web-password">Password</FieldLabel>
                  <Input
                    id="web-password"
                    type="password"
                    value={webPassword}
                    onChange={(event) => setWebPassword(event.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </Field>
                {webAuthMessage && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{webAuthMessage}</AlertDescription>
                  </Alert>
                )}
                <Button type="submit" className="w-full" disabled={isWebAuthRunning}>
                  {isWebAuthRunning ? "Signing in..." : "Sign in"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  // ─── Main app ─────────────────────────────────────────────────────────────────

  const activeTab = tabs.find((t) => t.tabId === activeTabId);

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="sticky top-0 z-20 border-b border-white/[0.08] bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-black text-primary-foreground">RB</span>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">Resume Builder</h1>
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Workspace · v{__APP_VERSION__}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Profiles dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="sm">
                  Profiles
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                {profiles.length === 0 ? (
                  <DropdownMenuItem disabled>No profiles yet</DropdownMenuItem>
                ) : (
                  profiles.map((profile) => (
                    <DropdownMenuItem
                      key={profile.id}
                      onSelect={(e) => e.preventDefault()}
                      className="flex items-center gap-2 pr-1"
                    >
                      <span className="flex-1 truncate text-sm">
                        {profile.name || "Unnamed"}
                      </span>
                      <button
                        type="button"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation()
                          setSettingsProfileId(profile.id)
                        }}
                        className="shrink-0 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>


            <Button type="button" variant="ghost" size="icon-sm" onClick={() => void handleWebLogout()} aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => setSettingsOpen(true)} aria-label="Open settings">
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="sticky top-16 z-10 border-b border-white/[0.06] bg-background/95">
        <div className="mx-auto max-w-7xl px-4 sm:px-8">
          <div className="flex items-center gap-1 overflow-x-auto py-2">
            {tabs.map((tab) => {
              const isActive = tab.tabId === activeTabId;
              const isGenerating = generatingProfiles.has(tab.tabId);
              const hasPendingResult = pendingResultTabIds.has(tab.tabId);
              const tabCompanyName = tabCompanyNames[tab.tabId];
              return (
                <div
                  key={tab.tabId}
                  className={`group flex items-center gap-1 rounded-lg border transition-colors ${
                    isActive
                      ? "border-primary/30 bg-primary/10"
                      : "border-transparent hover:bg-white/[0.04]"
                  }`}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => handleTabClick(tab.tabId)}
                        className={`flex items-center gap-1.5 py-1.5 pl-3 pr-2 text-xs font-medium whitespace-nowrap transition-colors ${
                          isActive
                            ? "text-primary"
                            : "text-muted-foreground group-hover:text-foreground"
                        }`}
                      >
                        {isGenerating && (
                          <Loader2 className="h-3 w-3 animate-spin text-primary" />
                        )}
                        {hasPendingResult && !isActive && !isGenerating && (
                          <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                        )}
                        {tab.label}
                      </button>
                    </TooltipTrigger>
                    {tabCompanyName && (
                      <TooltipContent side="bottom">
                        {tabCompanyName}
                      </TooltipContent>
                    )}
                  </Tooltip>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCloseTab(tab.tabId);
                    }}
                    className="mr-1 flex h-5 w-5 items-center justify-center rounded text-muted-foreground opacity-60 transition-opacity hover:bg-accent hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100"
                    aria-label={`Close ${tab.label} tab`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}

            {/* + dropdown: open new tab for any profile */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground"
                  aria-label="Open profile tab"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                {profiles.length === 0 ? (
                  <DropdownMenuItem disabled>
                    No assigned profiles
                  </DropdownMenuItem>
                ) : (
                  profiles.map((profile) => {
                    const openCount = tabs.filter(
                      (t) => t.profileId === profile.id,
                    ).length;
                    return (
                      <DropdownMenuItem
                        key={profile.id}
                        onSelect={() => handleOpenTab(profile.id)}
                      >
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="font-medium truncate">
                            {profile.name || "Unnamed"}
                          </span>
                          {openCount > 0 && (
                            <span className="text-xs text-muted-foreground">
                              {openCount} tab{openCount > 1 ? "s" : ""} open
                            </span>
                          )}
                        </div>
                      </DropdownMenuItem>
                    );
                  })
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Content area — flex-1 so it fills the remaining viewport height */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {/* Empty state */}
        {tabs.length === 0 && (
          <div className="mx-auto max-w-3xl px-5 py-24 text-center">
            <h2 className="text-xl font-semibold mb-2">No tabs open</h2>
            <p className="text-muted-foreground mb-6">
              {profiles.length > 0
                ? "Use the + button to open a profile tab."
                : "No profiles have been assigned to this account."}
            </p>
          </div>
        )}

        {/* Profile workspaces — all mounted, toggled by CSS display */}
        {tabs.map((tab) => {
          const profile = profiles.find((p) => p.id === tab.profileId);
          if (!profile) return null;
          return (
            <div
              key={tab.tabId}
              className="h-full"
              style={{ display: tab.tabId === activeTabId ? undefined : "none" }}
            >
              <ProfileWorkspace
                profile={profile}
                tabLabel={tab.label}
                legacyProfileId={legacyProfileIdRef.current}
                onProfileUpdated={handleProfileUpdated}
                onGeneratingChange={(_, generating) =>
                  handleGeneratingChange(tab.tabId, generating)
                }
                onGenerationComplete={(profileId, companyName) =>
                  handleGenerationComplete(profileId, tab.tabId, companyName)
                }
                triggerPreview={triggerPreviewFor === tab.tabId}
                onPreviewTriggered={() => setTriggerPreviewFor(null)}
                settingsOpen={settingsProfileId === profile.id}
                isActive={tab.tabId === activeTabId}
              />
            </div>
          );
        })}
      </div>

      {/* Edit Profile Dialog */}
      {settingsProfileId && (
        <ProfileSettingsOnlyDialog
          open={!!settingsProfileId}
          onOpenChange={(open) => {
            if (!open) setSettingsProfileId(null);
          }}
          profile={profiles.find((p) => p.id === settingsProfileId)}
          onUpdated={handleProfileUpdated}
        />
      )}

      <ExtensionSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        profiles={profiles}
        username={webAuthStatus.username}
        onLogout={() => void handleWebLogout()}
      />


      <Toaster />
    </main>
  );
}
