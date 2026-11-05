"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { TemplateSelector } from "@/components/template-selector"
import { COVER_LETTER_TEMPLATES, DEFAULT_COVER_LETTER_TEMPLATE, type CoverLetterTemplateId } from "@/lib/cover-letter-templates"
import { DEFAULT_TEMPLATE, type TemplateId } from "@/lib/pdf-templates"
import type { AiProfile } from "../../../shared/ai-profiles"
import { getFriendlyErrorMessage } from "@/lib/profile-utils"
import { toast } from "@/components/ui/use-toast"

export function ProfileSettingsOnlyDialog({
  open,
  profile,
  onOpenChange,
  onUpdated,
}: {
  open: boolean
  profile?: AiProfile
  onOpenChange: (open: boolean) => void
  onUpdated: (profile: AiProfile) => void
}) {
  const [template, setTemplate] = useState<TemplateId>(DEFAULT_TEMPLATE)
  const [generateCoverLetter, setGenerateCoverLetter] = useState(false)
  const [coverLetterTemplate, setCoverLetterTemplate] = useState<CoverLetterTemplateId>(DEFAULT_COVER_LETTER_TEMPLATE)
  const [saveInFolder, setSaveInFolder] = useState(false)
  const [downloadJDWithPDF, setDownloadJDWithPDF] = useState(false)
  const [useCompanyName, setUseCompanyName] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")

  useEffect(() => {
    if (!open || !profile) return
    setTemplate((profile.template as TemplateId | undefined) ?? DEFAULT_TEMPLATE)
    setGenerateCoverLetter(profile.generateCoverLetter ?? false)
    setCoverLetterTemplate((profile.coverLetterTemplate as CoverLetterTemplateId | undefined) ?? DEFAULT_COVER_LETTER_TEMPLATE)
    setSaveInFolder(profile.saveInFolder ?? false)
    setDownloadJDWithPDF(profile.downloadJDWithPDF ?? false)
    setUseCompanyName(profile.useCompanyName ?? true)
    setMessage("")
  }, [open, profile])

  async function save() {
    if (!profile) return
    setBusy(true)
    setMessage("")
    try {
      const updated = await window.aiProfiles.update({
        id: profile.id,
        name: profile.name,
        careerPath: profile.careerPath,
        personalInfo: profile.personalInfo,
        education: profile.education,
        certifications: profile.certifications,
        template,
        generateCoverLetter,
        coverLetterTemplate,
        saveInFolder,
        downloadJDWithPDF,
        useCompanyName,
      })
      onUpdated(updated)
      setMessage("Settings saved.")
      toast({ title: "Settings saved", description: "Your resume settings were saved successfully." })
    } catch (error) {
      setMessage(getFriendlyErrorMessage(error, "Unable to save profile settings."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Profile settings: {profile?.name}</DialogTitle>
          <DialogDescription>Choose cover letter, download, and PDF options for this profile.</DialogDescription>
        </DialogHeader>
        <fieldset disabled={busy} className="space-y-6 py-4">
          <section className="space-y-4">
            <h3 className="text-sm font-medium">Cover letter</h3>
            <label htmlFor="profile-cover-letter" className="flex items-center gap-3 text-sm">
              <Checkbox id="profile-cover-letter" checked={generateCoverLetter} onCheckedChange={(value) => setGenerateCoverLetter(value === true)} />
              Generate cover letter
            </label>
            <p className="text-xs text-muted-foreground">Include a cover letter with the next resume you generate.</p>
            {generateCoverLetter && (
              <div className="grid gap-2 sm:grid-cols-3">
                {COVER_LETTER_TEMPLATES.map((item) => (
                  <button key={item.id} type="button" aria-pressed={coverLetterTemplate === item.id} onClick={() => setCoverLetterTemplate(item.id)} className={`rounded-md border px-3 py-2 text-left text-sm ${coverLetterTemplate === item.id ? "border-primary bg-primary/5" : "border-border"}`}>
                    <div className="font-medium">{item.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{item.description}</div>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-4">
            <h3 className="text-sm font-medium">Download options</h3>
            <label htmlFor="profile-save-in-folder" className="flex items-center gap-3 text-sm">
              <Checkbox id="profile-save-in-folder" checked={saveInFolder} onCheckedChange={(value) => setSaveInFolder(value === true)} />
              Download as a directory
            </label>
            {saveInFolder && <p className="text-xs text-muted-foreground">Choose the download folder in Settings under Profile download locations.</p>}
            <label htmlFor="profile-download-jd" className="flex items-center gap-3 pl-6 text-sm">
              <Checkbox id="profile-download-jd" checked={downloadJDWithPDF} disabled={!saveInFolder} onCheckedChange={(value) => setDownloadJDWithPDF(value === true)} />
              Also save job description
            </label>
            <label htmlFor="profile-company-name" className="flex items-center gap-3 text-sm">
              <Checkbox id="profile-company-name" checked={useCompanyName} onCheckedChange={(value) => setUseCompanyName(value === true)} />
              Include company name in directory name
            </label>
            <p className="text-xs text-muted-foreground">Applies when downloading as a directory. Files are named Resume.pdf and Cover Letter.pdf.</p>
          </section>
          <details className="space-y-3">
            <summary className="cursor-pointer text-sm font-medium">Resume PDF template</summary>
            <TemplateSelector value={template} onChange={setTemplate} />
          </details>
        </fieldset>
        {message && <p role="status" className="border-t pt-3 text-xs text-muted-foreground">{message}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Close</Button>
          <Button type="button" onClick={() => void save()} disabled={busy || !profile}>{busy ? "Saving..." : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
