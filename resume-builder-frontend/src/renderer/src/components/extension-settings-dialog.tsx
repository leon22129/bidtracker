import { useEffect, useState } from "react"
import { Settings } from "lucide-react"
import type { AiProfile } from "../../../shared/ai-profiles"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { getApiBaseUrl, setApiBaseUrl } from "@/lib/extension-storage"
import { ProfileDownloadLocation } from "@/components/profile-download-location"

type ExtensionSettingsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  profiles: AiProfile[]
  username?: string
  onLogout: () => void
}

export function ExtensionSettingsDialog({ open, onOpenChange, profiles, username, onLogout }: ExtensionSettingsDialogProps) {
  const [apiUrl, setApiUrl] = useState("")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) return
    setError("")
    setMessage("")
    void getApiBaseUrl().then(setApiUrl).catch(() => setError("Unable to load extension settings."))
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
                <p className="text-sm">{profile.name || "Unnamed profile"}</p>
                <ProfileDownloadLocation key={String(open)} profileId={profile.id} />
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
