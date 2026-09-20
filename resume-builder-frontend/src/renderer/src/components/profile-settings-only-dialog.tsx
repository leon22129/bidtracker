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
  const [updateHeadline, setUpdateHeadline] = useState(true)
  const [useGeneratedRoleTitles, setUseGeneratedRoleTitles] = useState(true)
  const [template, setTemplate] = useState<TemplateId>(DEFAULT_TEMPLATE)
  const [generateCoverLetter, setGenerateCoverLetter] = useState(false)
  const [coverLetterTemplate, setCoverLetterTemplate] = useState<CoverLetterTemplateId>(DEFAULT_COVER_LETTER_TEMPLATE)
  const [saveInFolder, setSaveInFolder] = useState(false)
  const [autoDownload, setAutoDownload] = useState(false)
  const [downloadJDWithPDF, setDownloadJDWithPDF] = useState(false)
  const [useCompanyName, setUseCompanyName] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")

  useEffect(() => {
    if (!open || !profile) return
    setUpdateHeadline(profile.updateHeadline ?? true)
    setUseGeneratedRoleTitles(profile.useGeneratedRoleTitles ?? true)
    setTemplate((profile.template as TemplateId | undefined) ?? DEFAULT_TEMPLATE)
    setGenerateCoverLetter(profile.generateCoverLetter ?? false)
    setCoverLetterTemplate((profile.coverLetterTemplate as CoverLetterTemplateId | undefined) ?? DEFAULT_COVER_LETTER_TEMPLATE)
    setSaveInFolder(profile.saveInFolder ?? false)
    setAutoDownload(profile.autoDownload ?? false)
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
        updateHeadline,
        useGeneratedRoleTitles,
        template,
        generateCoverLetter,
        coverLetterTemplate,
        saveInFolder,
        autoDownload,
        downloadJDWithPDF,
        useCompanyName,
      })
      onUpdated(updated)
      setMessage("Settings saved.")
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
          <DialogTitle>Resume settings: {profile?.name}</DialogTitle>
          <DialogDescription>Profile identity and resume content are managed in BidTracker. Only generation and download settings can be changed here.</DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <section className="space-y-3">
            <h3 className="text-sm font-medium">Title settings</h3>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={useGeneratedRoleTitles} onCheckedChange={(value) => setUseGeneratedRoleTitles(value === true)} />
              Use AI-generated role titles
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={updateHeadline} onCheckedChange={(value) => setUpdateHeadline(value === true)} />
              Update headline from AI
            </label>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-medium">PDF template</h3>
            <TemplateSelector value={template} onChange={setTemplate} />
          </section>

          <section className="space-y-4">
            <h3 className="text-sm font-medium">Cover letter</h3>
            <label className="flex items-center gap-3 text-sm">
              <Checkbox checked={generateCoverLetter} onCheckedChange={(value) => setGenerateCoverLetter(value === true)} />
              Generate cover letter
            </label>
            {generateCoverLetter && (
              <div className="grid gap-2 sm:grid-cols-3">
                {COVER_LETTER_TEMPLATES.map((item) => (
                  <button key={item.id} type="button" onClick={() => setCoverLetterTemplate(item.id)} className={`rounded-md border px-3 py-2 text-left text-sm ${coverLetterTemplate === item.id ? "border-primary bg-primary/5" : "border-border"}`}>
                    <div className="font-medium">{item.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{item.description}</div>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-4">
            <h3 className="text-sm font-medium">Download options</h3>
            <label className="flex items-center gap-3 text-sm">
              <Checkbox checked={saveInFolder} onCheckedChange={(value) => setSaveInFolder(value === true)} />
              Save inside dated folder
            </label>
            <label className="flex items-center gap-3 pl-6 text-sm">
              <Checkbox checked={autoDownload} onCheckedChange={(value) => { const enabled = value === true; setAutoDownload(enabled); if (enabled) setSaveInFolder(true) }} />
              Automatically download when ready
            </label>
            <label className="flex items-center gap-3 pl-6 text-sm">
              <Checkbox checked={downloadJDWithPDF} disabled={!saveInFolder} onCheckedChange={(value) => setDownloadJDWithPDF(value === true)} />
              Also save job description
            </label>
            <label className="flex items-center gap-3 text-sm">
              <Checkbox checked={useCompanyName} onCheckedChange={(value) => setUseCompanyName(value === true)} />
              Include company name in output name
            </label>
          </section>
        </div>
        {message && <p className="border-t pt-3 text-xs text-muted-foreground">{message}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Close</Button>
          <Button type="button" onClick={() => void save()} disabled={busy || !profile}>{busy ? "Saving..." : "Save settings"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
