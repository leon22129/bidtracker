import { useEffect, useState } from "react"
import { Folder, Settings } from "lucide-react"
import type { AiProfile } from "../../../shared/ai-profiles"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { chooseProfileDirectory, getApiBaseUrl, getProfileDirectoryHandle, getProfileDownloadPaths, setApiBaseUrl, setProfileDownloadPath } from "@/lib/extension-storage"

type ExtensionSettingsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  profiles: AiProfile[]
  username?: string
  onLogout: () => void
}

export function ExtensionSettingsDialog({ open, onOpenChange, profiles, username, onLogout }: ExtensionSettingsDialogProps) {
  const [apiUrl, setApiUrl] = useState("")
  const [downloadPaths, setDownloadPaths] = useState<Record<string, string>>({})
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [directoryNames, setDirectoryNames] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    setError("")
    setMessage("")
    void Promise.all([getApiBaseUrl(), getProfileDownloadPaths(), Promise.all(profiles.map(async (profile) => [profile.id, (await getProfileDirectoryHandle(profile.id))?.name || ""] as const))]).then(([url, paths, handles]) => {
      setApiUrl(url)
      setDownloadPaths(paths)
      setDirectoryNames(Object.fromEntries(handles))
    }).catch(() => setError("Unable to load extension settings."))
  }, [open])

  const saveApiUrl = async () => {
    try {
      const previousApiUrl = await getApiBaseUrl()
      await setApiBaseUrl(apiUrl)
      if (previousApiUrl.replace(/\/+$/, "") !== apiUrl.trim().replace(/\/+$/, "")) {
        onLogout()
        return
      }
      setMessage("Backend URL saved.")
      setError("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save backend URL.")
    }
  }

  const chooseDirectory = async (profileId: string) => {
    try {
      const name = await chooseProfileDirectory(profileId)
      if (name) {
        setDirectoryNames((current) => ({ ...current, [profileId]: name }))
        setDownloadPaths((current) => ({ ...current, [profileId]: name }))
        setMessage("Download location saved.")
        setError("")
      }
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return
      setError(err instanceof Error ? err.message : "Unable to choose download location.")
    }
  }

  const savePath = async (profileId: string) => {
    try {
      await setProfileDownloadPath(profileId, downloadPaths[profileId] || "")
      setMessage("Download location saved.")
      setError("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save download location.")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Settings className="h-5 w-5" /> Settings</DialogTitle>
          <DialogDescription>Configure Resume AI for this browser.</DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          <section className="space-y-2">
            <label htmlFor="extension-api-url" className="text-sm font-medium">Backend API URL</label>
            <div className="flex gap-2">
              <Input id="extension-api-url" value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} placeholder="http://localhost:3001/api" />
              <Button type="button" onClick={() => void saveApiUrl()}>Save</Button>
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-medium">Profile download locations</h3>
              <p className="text-xs text-muted-foreground">Relative paths are applied through Chrome Downloads, for example Resumes/Go.</p>
            </div>
            {profiles.map((profile) => (
              <div key={profile.id} className="space-y-1">
                <label htmlFor={`download-path-${profile.id}`} className="text-sm">{profile.name || "Unnamed profile"}</label>
                <div className="flex items-center gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
                    <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{directoryNames[profile.id] || downloadPaths[profile.id] || "No folder selected"}</span>
                  </div>
                  <Button type="button" variant="outline" onClick={() => void chooseDirectory(profile.id)}>
                    {directoryNames[profile.id] ? "Change" : "Choose"}
                  </Button>
                </div>
              </div>
            ))}
          </section>

          {username && <p className="text-sm text-muted-foreground">Signed in as {username}</p>}
          {message && <Alert><AlertDescription>{message}</AlertDescription></Alert>}
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        </div>
        <DialogFooter>
          <Button type="button" variant="destructive" onClick={onLogout}>Log out</Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}