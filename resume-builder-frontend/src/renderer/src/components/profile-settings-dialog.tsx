"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { TemplateSelector } from "@/components/template-selector"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Plus, Trash2, Check } from "lucide-react"
import {
  DEFAULT_PERSONAL_INFO,
  DEFAULT_EDUCATION,
  DEFAULT_CERTIFICATIONS,
  type PersonalInfo,
  type Education,
  type Certification,
} from "@/lib/parse-resume"
import { normalizeResumeCertifications, normalizeResumePersonalInfo, normalizeResumeEducation } from "../../../shared/resume-profile"
import type { AiProfile } from "../../../shared/ai-profiles"
import {
  COVER_LETTER_TEMPLATES,
  DEFAULT_COVER_LETTER_TEMPLATE,
  type CoverLetterTemplateId,
} from "@/lib/cover-letter-templates"
import { DEFAULT_TEMPLATE, type TemplateId } from "@/lib/pdf-templates"
import {
  getFriendlyErrorMessage,
  getResumeDetailsForProfile,
  clearLegacyResumeSettings,
} from "@/lib/profile-utils"

interface ProfileSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** undefined = create mode, AiProfile = edit mode */
  profile?: AiProfile
  legacyProfileId?: string | null
  onCreated?: (profile: AiProfile) => void
  onUpdated?: (profile: AiProfile) => void
  onDeleted?: () => void
}

export function ProfileSettingsDialog({
  open,
  onOpenChange,
  profile,
  legacyProfileId,
  onCreated,
  onUpdated,
  onDeleted,
}: ProfileSettingsDialogProps) {
  const isEdit = !!profile

  // Profile fields
  const [name, setName] = useState("")
  const [careerPath, setCareerPath] = useState("")

  // Contact details
  const [personalInfo, setPersonalInfo] = useState<PersonalInfo>({ ...DEFAULT_PERSONAL_INFO })
  const [updateHeadline, setUpdateHeadline] = useState(true)
  const [useGeneratedRoleTitles, setUseGeneratedRoleTitles] = useState(true)

  // Education
  const [education, setEducation] = useState<Education[]>(DEFAULT_EDUCATION.map((e) => ({ ...e })))
  const [certifications, setCertifications] = useState<Certification[]>(DEFAULT_CERTIFICATIONS.map((item) => ({ ...item })))

  // PDF & download
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateId>(DEFAULT_TEMPLATE)
  const [saveInFolder, setSaveInFolder] = useState(false)
  const [autoDownload, setAutoDownload] = useState(false)
  const [downloadJDWithPDF, setDownloadJDWithPDF] = useState(false)
  const [companyName, setCompanyName] = useState("")
  const [useCompanyName, setUseCompanyName] = useState(true)

  // Cover letter
  const [generateCoverLetter, setGenerateCoverLetter] = useState(false)
  const [coverLetterTemplate, setCoverLetterTemplate] = useState<CoverLetterTemplateId>(DEFAULT_COVER_LETTER_TEMPLATE)

  // Dialog state
  const [message, setMessage] = useState("")
  const [isRunning, setIsRunning] = useState(false)

  useEffect(() => {
    if (!open) return
    setMessage("")

    if (profile) {
      setName(profile.name)
      setCareerPath(profile.careerPath)
      setSelectedTemplate((profile.template as TemplateId | undefined) ?? DEFAULT_TEMPLATE)
      setSaveInFolder(profile.saveInFolder ?? false)
      setAutoDownload(profile.autoDownload ?? false)
      setDownloadJDWithPDF(profile.downloadJDWithPDF ?? false)
      setCompanyName(profile.companyName ?? "")
      setUseCompanyName(profile.useCompanyName ?? true)
      setGenerateCoverLetter(profile.generateCoverLetter ?? false)
      setCoverLetterTemplate(
        (profile.coverLetterTemplate as CoverLetterTemplateId | undefined) ?? DEFAULT_COVER_LETTER_TEMPLATE,
      )
      const details = getResumeDetailsForProfile(profile, legacyProfileId ?? null)
      setPersonalInfo(details.personalInfo)
      setUpdateHeadline(profile.updateHeadline ?? true)
      setUseGeneratedRoleTitles(profile.useGeneratedRoleTitles ?? true)
      setEducation(details.education)
      setCertifications(profile.certifications ?? [])
    } else {
      setName("")
      setCareerPath("")
      setSelectedTemplate(DEFAULT_TEMPLATE)
      setSaveInFolder(false)
      setAutoDownload(false)
      setDownloadJDWithPDF(false)
      setCompanyName("")
      setUseCompanyName(true)
      setGenerateCoverLetter(false)
      setCoverLetterTemplate(DEFAULT_COVER_LETTER_TEMPLATE)
      setPersonalInfo({ ...DEFAULT_PERSONAL_INFO })
      setUpdateHeadline(true)
      setUseGeneratedRoleTitles(true)
      setEducation(DEFAULT_EDUCATION.map((e) => ({ ...e })))
      setCertifications(DEFAULT_CERTIFICATIONS.map((item) => ({ ...item })))
    }
  }, [open, profile?.id])

  const buildPayload = () => ({
    name,
    careerPath,
    personalInfo: normalizeResumePersonalInfo(personalInfo),
    education: normalizeResumeEducation(education),
    certifications: normalizeResumeCertifications(certifications),
    updateHeadline,
    useGeneratedRoleTitles,
    template: selectedTemplate,
    saveInFolder,
    autoDownload,
    downloadJDWithPDF,
    companyName,
    useCompanyName,
    generateCoverLetter,
    coverLetterTemplate,
  })

  const handleSave = async () => {
    setMessage("")
    setIsRunning(true)
    try {
      if (isEdit && profile) {
        const updated = await window.aiProfiles.update({ id: profile.id, ...buildPayload() })
        clearLegacyResumeSettings()
        setMessage(`Saved ${updated.name}.`)
        onUpdated?.(updated)
      } else {
        const created = await window.aiProfiles.create(buildPayload())
        setMessage(`Created ${created.name}.`)
        onCreated?.(created)
      }
    } catch (err) {
      setMessage(getFriendlyErrorMessage(err, isEdit ? "Failed to save profile." : "Failed to create profile."))
    } finally {
      setIsRunning(false)
    }
  }

  const handleDelete = async () => {
    if (!profile || !window.confirm(`Delete profile "${profile.name}"?`)) return
    setIsRunning(true)
    try {
      await window.aiProfiles.delete(profile.id)
      onOpenChange(false)
      onDeleted?.()
    } catch (err) {
      setMessage(getFriendlyErrorMessage(err, "Failed to delete profile."))
      setIsRunning(false)
    }
  }

  const handleAddEducation = () => {
    if (education.length < 2) setEducation([...education, { degree: "", school: "", year: "" }])
  }

  const handleRemoveEducation = (index: number) => {
    if (education.length > 1) setEducation(education.filter((_, i) => i !== index))
  }

  const handleUpdateEducation = (index: number, field: keyof Education, value: string) => {
    const updated = [...education]
    updated[index] = { ...updated[index], [field]: value }
    setEducation(updated)
  }

  const handleAddCertification = () => {
    setCertifications([...certifications, { name: "", issuer: "", year: "" }])
  }

  const handleRemoveCertification = (index: number) => {
    setCertifications(certifications.filter((_, i) => i !== index))
  }

  const handleUpdateCertification = (index: number, field: keyof Certification, value: string) => {
    const updated = [...certifications]
    updated[index] = { ...updated[index], [field]: value }
    setCertifications(updated)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Resume Content & Settings</DialogTitle>
          <DialogDescription>
            {isEdit ? "Edit this profile and resume contact details." : "Create a profile and manage resume contact details."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Profile */}
          <div>
            <h3 className="text-sm font-medium mb-3">{isEdit ? "Edit Profile" : "Create Profile"}</h3>

            <Field>
              <FieldLabel>Profile Name</FieldLabel>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" />
            </Field>

            <Field className="mt-3">
              <FieldLabel>Career Path</FieldLabel>
              <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox checked={useGeneratedRoleTitles} onCheckedChange={(checked) => setUseGeneratedRoleTitles(checked === true)} />
                Use AI-generated role titles
              </label>
              <Textarea
                placeholder={`ScienceLogic\nSenior Backend Engineer, 12/2021 - 04/2026\n\nAllstate\nSenior Golang Engineer, 09/2019 - 11/2021`}
                className="min-h-45 font-mono text-sm"
                value={careerPath}
                onChange={(e) => setCareerPath(e.target.value)}
              />
            </Field>
          </div>

          {/* Contact Details */}
          <div>
            <h3 className="text-sm font-medium mb-3">Contact Details</h3>
            <FieldGroup>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field>
                  <FieldLabel>Full Name</FieldLabel>
                  <Input value={personalInfo.fullName} onChange={(e) => setPersonalInfo({ ...personalInfo, fullName: e.target.value })} />
                </Field>
                <Field>
                  <FieldLabel>Title</FieldLabel>
                  <Input value={personalInfo.title} onChange={(e) => setPersonalInfo({ ...personalInfo, title: e.target.value })} />
                  <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox checked={updateHeadline} onCheckedChange={(checked) => setUpdateHeadline(checked === true)} />
                    Update headline from AI
                  </label>
                </Field>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field>
                  <FieldLabel>Email</FieldLabel>
                  <Input type="email" value={personalInfo.email} onChange={(e) => setPersonalInfo({ ...personalInfo, email: e.target.value })} />
                </Field>
                <Field>
                  <FieldLabel>Phone</FieldLabel>
                  <Input value={personalInfo.phone} onChange={(e) => setPersonalInfo({ ...personalInfo, phone: e.target.value })} />
                </Field>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field>
                  <FieldLabel>Location</FieldLabel>
                  <Input value={personalInfo.location} onChange={(e) => setPersonalInfo({ ...personalInfo, location: e.target.value })} />
                </Field>
                <Field>
                  <FieldLabel>LinkedIn</FieldLabel>
                  <Input value={personalInfo.linkedin} onChange={(e) => setPersonalInfo({ ...personalInfo, linkedin: e.target.value })} />
                </Field>
              </div>
            </FieldGroup>
          </div>

          {/* Education */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium">Education</h3>
              {education.length < 2 && (
                <Button type="button" variant="outline" size="sm" onClick={handleAddEducation}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              )}
            </div>
            <div className="space-y-4">
              {education.map((edu, index) => (
                <div key={index} className="relative border rounded-lg p-4">
                  {education.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute top-2 right-2 h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemoveEducation(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                  <FieldGroup>
                    <Field>
                      <FieldLabel>Degree</FieldLabel>
                      <Input value={edu.degree} onChange={(e) => handleUpdateEducation(index, "degree", e.target.value)} />
                    </Field>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <Field>
                        <FieldLabel>School</FieldLabel>
                        <Input value={edu.school} onChange={(e) => handleUpdateEducation(index, "school", e.target.value)} />
                      </Field>
                      <Field>
                        <FieldLabel>Year</FieldLabel>
                        <Input value={edu.year} onChange={(e) => handleUpdateEducation(index, "year", e.target.value)} />
                      </Field>
                    </div>
                  </FieldGroup>
                </div>
              ))}
            </div>
          </div>

          {/* Certifications */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium">Certifications</h3>
              <Button type="button" variant="outline" size="sm" onClick={handleAddCertification}>
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>
            <div className="space-y-4">
              {certifications.map((certification, index) => (
                <div key={index} className="relative border rounded-lg p-4">
                  <Button type="button" variant="ghost" size="icon" className="absolute top-2 right-2 h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => handleRemoveCertification(index)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  <FieldGroup>
                    <Field>
                      <FieldLabel>Certification</FieldLabel>
                      <Input value={certification.name} onChange={(e) => handleUpdateCertification(index, "name", e.target.value)} placeholder="Certification name" />
                    </Field>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <Field>
                        <FieldLabel>Issuing Organization</FieldLabel>
                        <Input value={certification.issuer} onChange={(e) => handleUpdateCertification(index, "issuer", e.target.value)} placeholder="Organization" />
                      </Field>
                      <Field>
                        <FieldLabel>Year</FieldLabel>
                        <Input value={certification.year} onChange={(e) => handleUpdateCertification(index, "year", e.target.value)} placeholder="Year" />
                      </Field>
                    </div>
                  </FieldGroup>
                </div>
              ))}
            </div>
          </div>

          {/* PDF Template */}
          <div>
            <h3 className="text-sm font-medium mb-3">PDF Template</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Choose the PDF style used when downloading the generated resume.
            </p>
            <TemplateSelector value={selectedTemplate} onChange={setSelectedTemplate} />
          </div>

          {/* Cover Letter */}
          <div>
            <h3 className="text-sm font-medium mb-3">Cover Letter</h3>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <Checkbox checked={generateCoverLetter} onCheckedChange={(v) => setGenerateCoverLetter(Boolean(v))} />
                <div>
                  <div className="text-sm font-medium">Generate cover letter</div>
                  <p className="text-xs text-muted-foreground">
                    Appends a cover letter prompt to the generation request and downloads a cover letter PDF alongside
                    the resume.
                  </p>
                </div>
              </div>
              {generateCoverLetter && (
                <div className="ml-6">
                  <p className="text-xs text-muted-foreground mb-3">Choose the PDF style used for the cover letter.</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {COVER_LETTER_TEMPLATES.map((tpl) => (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => setCoverLetterTemplate(tpl.id)}
                        className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                          coverLetterTemplate === tpl.id
                            ? "border-primary bg-primary/5 text-primary"
                            : "border-border hover:border-muted-foreground"
                        }`}
                      >
                        <div className="font-medium">{tpl.name}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{tpl.description}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Download Options */}
          <div>
            <h3 className="text-sm font-medium mb-3">Download Options</h3>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <Checkbox checked={saveInFolder} onCheckedChange={(v) => setSaveInFolder(Boolean(v))} />
                <div>
                  <div className="text-sm font-medium">Save inside dated folder</div>
                  <p className="text-xs text-muted-foreground">
                    Creates a timestamped folder, optionally including the target company name.
                  </p>
                </div>
              </div>
              <div className="ml-6 flex items-start gap-3">
                <Checkbox
                  checked={autoDownload}
                  onCheckedChange={(v) => {
                    const enabled = Boolean(v)
                    setAutoDownload(enabled)
                    if (enabled) setSaveInFolder(true)
                  }}
                />
                <div>
                  <div className="text-sm font-medium">Automatically download when ready</div>
                  <p className="text-xs text-muted-foreground">
                    Saves the generated resume right away. If no save folder is configured yet, the folder picker opens first.
                  </p>
                </div>
              </div>
              <div className="ml-6 flex items-start gap-3">
                <Checkbox
                  checked={downloadJDWithPDF}
                  onCheckedChange={(v) => { if (saveInFolder) setDownloadJDWithPDF(Boolean(v)) }}
                  disabled={!saveInFolder}
                />
                <div>
                  <div className="text-sm font-medium">Also save job description</div>
                  <p className="text-xs text-muted-foreground">
                    Saves the pasted job description as job-description.txt beside the PDF.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Checkbox checked={useCompanyName} onCheckedChange={(v) => setUseCompanyName(Boolean(v))} />
                <div>
                  <div className="text-sm font-medium">Include company name in output name</div>
                  <p className="text-xs text-muted-foreground">
                    Uses the extracted or edited target company name in folder and file names.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {message && (
          <p className="border-t pt-3 text-xs text-muted-foreground">{message}</p>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {isEdit && (
              <Button type="button" variant="ghost" onClick={handleDelete} disabled={isRunning}>
                <Trash2 className="h-4 w-4 mr-1" />
                Delete
              </Button>
            )}
          </div>
          <Button type="button" onClick={handleSave} disabled={isRunning}>
            {isEdit ? (
              <><Check className="h-4 w-4 mr-1" />Save Profile</>
            ) : (
              <><Plus className="h-4 w-4 mr-1" />Create Profile</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
