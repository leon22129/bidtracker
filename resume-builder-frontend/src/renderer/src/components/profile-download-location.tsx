import { useEffect, useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { chooseProfileDirectory, clearProfileDirectoryHandle, getProfileDirectoryHandle, getProfileDownloadPaths, setProfileDownloadPath } from "@/lib/extension-storage"

export function ProfileDownloadLocation({ profileId, disabled = false }: { profileId: string; disabled?: boolean }) {
  const inputId = useId()
  const [path, setPath] = useState("Resumes")
  const [savedPath, setSavedPath] = useState("Resumes")
  const [directoryName, setDirectoryName] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true
    void Promise.all([getProfileDownloadPaths(), getProfileDirectoryHandle(profileId)]).then(([paths, handle]) => {
      if (!active) return
      setPath(handle ? "Resumes" : paths[profileId] || "Resumes")
      setSavedPath(paths[profileId] || "Resumes")
      setDirectoryName(handle?.name || "")
    }).catch(() => { if (active) setError("Unable to load the download location.") })
    return () => { active = false }
  }, [profileId])

  async function saveLocation(chooseFolder: boolean) {
    setBusy(true)
    setMessage("")
    setError("")
    try {
      if (chooseFolder) {
        const name = await chooseProfileDirectory(profileId)
        if (!name) return
        setDirectoryName(name)
      } else {
        await setProfileDownloadPath(profileId, path)
        await clearProfileDirectoryHandle(profileId)
        setSavedPath((await getProfileDownloadPaths())[profileId] || "Resumes")
        setDirectoryName("")
      }
      setMessage("Download location saved for this browser.")
    } catch (err) {
      if ((err as DOMException)?.name !== "AbortError") setError(err instanceof Error ? err.message : "Unable to save the download location.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <fieldset disabled={disabled || busy} className="space-y-2 rounded-md border p-3 text-sm">
      <p>Current folder: <span className="font-medium">{directoryName || `Chrome Downloads/${savedPath}`}</span></p>
      <Button type="button" variant="outline" size="sm" onClick={() => void saveLocation(true)}>Choose folder</Button>
      <div className="space-y-1">
        <label htmlFor={inputId}>Folder under Chrome Downloads</label>
        <div className="flex flex-wrap gap-2">
          <Input id={inputId} value={path} onChange={(event) => setPath(event.target.value)} placeholder="Resumes/My profile" className="min-w-0 flex-1" />
          <Button type="button" variant="outline" size="sm" onClick={() => void saveLocation(false)}>Use Downloads folder</Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">The location is saved separately on this browser. Each application gets its own dated subfolder.</p>
      {message && <p role="status" className="text-xs">{message}</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </fieldset>
  )
}
