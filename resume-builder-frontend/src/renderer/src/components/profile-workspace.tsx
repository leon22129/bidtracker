"use client";

import { useState, useEffect, useRef } from "react";
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
import { Spinner } from "@/components/ui/spinner";
import { ToastAction } from "@/components/ui/toast";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/use-toast";
import { ResumePreview } from "@/components/resume-preview";
import { FunnyLoadingBar } from "@/components/funny-loading-bar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  FileDown,
  AlertCircle,
  Briefcase,
  Check,
  Pencil,
  Plus,
} from "lucide-react";
import {
  type ResumeData,
  type PersonalInfo,
  type Education,
  type Certification,
  normalizeSkills,
} from "@/lib/parse-resume";
import type { AiProfile, GeneratedApplication } from "../../../shared/ai-profiles";
import {
  generateCoverLetterPDF,
  DEFAULT_COVER_LETTER_TEMPLATE,
  type CoverLetterTemplateId,
} from "@/lib/cover-letter-templates";
import { DEFAULT_TEMPLATE, type TemplateId } from "@/lib/pdf-templates";
import {
  getFriendlyErrorMessage,
  parseGeneratedResume,
  getResumeDetailsForProfile,
} from "@/lib/profile-utils";
import { chooseProfileDirectory, getCurrentBrowserTabUrl, getProfileDownloadPaths } from "@/lib/extension-storage";

interface ProfileWorkspaceProps {
  profile: AiProfile;
  tabLabel: string;
  legacyProfileId: string | null;
  onProfileUpdated: (updated: AiProfile) => void;
  onGeneratingChange: (profileId: string, generating: boolean) => void;
  onGenerationComplete: (profileId: string, companyName?: string) => void;
  triggerPreview: boolean;
  onPreviewTriggered: () => void;
  settingsOpen: boolean;
  isActive: boolean;
}

export function ProfileWorkspace({
  profile,
  tabLabel,
  legacyProfileId,
  onProfileUpdated,
  onGeneratingChange,
  onGenerationComplete,
  triggerPreview,
  onPreviewTriggered,
  settingsOpen,
  isActive,
}: ProfileWorkspaceProps) {
  // Operational settings synced from profile
  const [selectedTemplate, setSelectedTemplate] =
    useState<TemplateId>(DEFAULT_TEMPLATE);
  const [companyName, setCompanyName] = useState("");
  const [useCompanyName, setUseCompanyName] = useState(true);
  const [useGeneratedRoleTitles, setUseGeneratedRoleTitles] = useState(true);
  const [saveInFolder, setSaveInFolder] = useState(false);
  const [autoDownload, setAutoDownload] = useState(false);
  const [downloadJDWithPDF, setDownloadJDWithPDF] = useState(false);
  const [generateCoverLetter, setGenerateCoverLetter] = useState(false);
  const [coverLetterTemplate, setCoverLetterTemplate] =
    useState<CoverLetterTemplateId>(DEFAULT_COVER_LETTER_TEMPLATE);
  const [personalInfo, setPersonalInfo] = useState<PersonalInfo>({
    fullName: "",
    title: "",
    email: "",
    phone: "",
    location: "",
    linkedin: "",
  });
  const [education, setEducation] = useState<Education[]>([
    { degree: "", school: "", year: "" },
  ]);
  const [certifications, setCertifications] = useState<Certification[]>([]);

  // Per-generation data
  const [jobDescription, setJobDescription] = useState("");
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [coverLetterText, setCoverLetterText] = useState<string | null>(null);
  const [applicationQuestions, setApplicationQuestions] = useState("");
  const [applicationAnswers, setApplicationAnswers] = useState<Array<{ question: string; answer: string }>>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingAnswers, setIsGeneratingAnswers] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isAddingApplication, setIsAddingApplication] = useState(false);
  const [error, setError] = useState("");
  const [applicationError, setApplicationError] = useState("");
  const [generatedApplication, setGeneratedApplication] = useState<GeneratedApplication | null>(null);

  // UI state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewEditable, setPreviewEditable] = useState(false);
  const [downloadLocationPromptOpen, setDownloadLocationPromptOpen] = useState(false);

  const syncFromProfile = (p: AiProfile) => {
    setSelectedTemplate(
      (p.template as TemplateId | undefined) ?? DEFAULT_TEMPLATE,
    );
    const nextAutoDownload = p.autoDownload ?? false;
    setSaveInFolder(p.saveInFolder ?? nextAutoDownload);
    setAutoDownload(nextAutoDownload);
    setCompanyName(p.companyName ?? "");
    setUseCompanyName(p.useCompanyName ?? true);
    setUseGeneratedRoleTitles(p.useGeneratedRoleTitles ?? true);
    setDownloadJDWithPDF(p.downloadJDWithPDF ?? false);
    setGenerateCoverLetter(p.generateCoverLetter ?? false);
    setCoverLetterTemplate(
      (p.coverLetterTemplate as CoverLetterTemplateId | undefined) ??
        DEFAULT_COVER_LETTER_TEMPLATE,
    );
    const details = getResumeDetailsForProfile(p, legacyProfileId);
    setPersonalInfo(details.personalInfo);
    setEducation(details.education);
    setCertifications(p.certifications ?? []);
  };

  useEffect(() => {
    syncFromProfile(profile);
  }, [profile, legacyProfileId]);

  useEffect(() => {
    onGeneratingChange(profile.id, isGenerating);
  }, [isGenerating]);

  useEffect(() => {
    if (triggerPreview) {
      setPreviewOpen(true);
      onPreviewTriggered();
    }
  }, [triggerPreview]);

  const handleProfileUpdated = (updated: AiProfile) => {
    syncFromProfile(updated);
    onProfileUpdated(updated);
  };

  const handleGenerate = async () => {
    if (!jobDescription.trim()) {
      setError("Please enter a job description");
      return;
    }
    setError("");
    setGeneratedApplication(null);
    setIsGenerating(true);

    const shouldGenerateCoverLetter = profile.generateCoverLetter ?? generateCoverLetter;
    const activeCoverLetterTemplate =
      (profile.coverLetterTemplate as CoverLetterTemplateId | undefined) ?? coverLetterTemplate;
    const shouldUseCompanyName = profile.useCompanyName ?? useCompanyName;
    const shouldAutoDownload = profile.autoDownload ?? autoDownload;
    const shouldSaveInFolder = profile.saveInFolder ?? saveInFolder;

    try {
      const tabUrl = await getCurrentBrowserTabUrl();
      const data = await window.aiProfiles.generate({
        profileId: profile.id,
        workspaceId: profile.workspaceId,
        url: tabUrl,
        jobDescription,
        kind: "resume",
      });
      if (data.duplicate) {
        const existing = data.existingApplication;
        const location = existing
          ? ` It already exists in ${existing.workspace_name} as application #${existing.number}.`
          : "";
        const reason = `This job URL has already been added.${location}`;
        setError(reason);
        if (isActive) toast({ title: "Duplicate job", description: reason });
        return;
      }
      if (data.banned) {
        const reason = "This job URL is on the banned list and was not sent to OpenAI.";
        setError(reason);
        if (isActive) toast({ title: "Banned job", description: reason });
        return;
      }
      if (data.eligible === false) {
        const reason = data.reason || "This position did not pass the eligibility check.";
        setError(reason);
        if (isActive) toast({ title: "Position skipped", description: reason });
        return;
      }
      const generatedContent = data.tailored_resume || "";

      console.log(generatedContent);

      if (!generatedContent)
        throw new Error("No response received from the selected profile");

      const parsed = parseGeneratedResume(generatedContent);

      if (parsed.error) {
        const msg = String(parsed.error).trim();
        if (isActive) toast({ title: "Generation skipped", description: msg });
        setError(msg);
        return;
      }

      const effectiveCompanyName = (parsed.target_company ?? companyName ?? "").trim();
      if (effectiveCompanyName) {
        setCompanyName(effectiveCompanyName);
      }

      const generatedPersonalInfo = {
        ...personalInfo,
        fullName: data.full_name?.trim() || personalInfo.fullName || profile.personalInfo.fullName,
        ...(profile.updateHeadline ?? true) && parsed.main_title?.trim()
          ? { title: parsed.main_title.trim() }
          : { title: personalInfo.title },
      };
      if (generatedPersonalInfo !== personalInfo) setPersonalInfo(generatedPersonalInfo);

      const effectiveCoverLetterText = shouldGenerateCoverLetter ? (parsed.coverletter ?? null) : null;
      setCoverLetterText(effectiveCoverLetterText);
      const workexperience = (parsed.workexperience || []).map((experience) => ({
        ...experience,
        role: (profile.useGeneratedRoleTitles ?? useGeneratedRoleTitles)
          ? experience.role
          : experience.original_role || experience.role,
      }));

      const nextResumeData = {
        personalInfo: generatedPersonalInfo,
        education,
        certifications,
        summary: parsed.summary || "",
        skills: normalizeSkills(parsed.skills),
        workexperience,
        annualSalary: parsed.annual_salary?.trim() || "",
        hourlyRate: parsed.hourly_rate?.trim() || "",
        rateInJd: parsed.rate_in_jd,
      };

      setResumeData(nextResumeData);
      setGeneratedApplication(data.application ?? null);
      setApplicationAnswers([]);

      if (shouldAutoDownload) {
        await handleDownloadPDF(
          nextResumeData,
          effectiveCompanyName || companyName || undefined,
          shouldGenerateCoverLetter,
          activeCoverLetterTemplate,
          shouldUseCompanyName,
          shouldSaveInFolder,
          effectiveCoverLetterText,
        );
      }

      onGenerationComplete(profile.id, effectiveCompanyName || undefined);
    } catch (err) {
      console.error("Generation error:", err);
      const msg = getFriendlyErrorMessage(
        err,
        "Failed to generate resume with the selected profile.",
      );
      setError(msg);
      if (isActive) toast({ title: "Generation Failed", description: msg });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAddApplication = async () => {
    if (!generatedApplication || !profile.workspaceId || isAddingApplication) return;
    setError("");
    setIsAddingApplication(true);
    try {
      const result = await window.aiProfiles.addGeneratedApplication(
        profile.workspaceId,
        generatedApplication,
      );
      if (result.duplicate) {
        const existing = result.existingApplication;
        const location = existing
          ? ` It already exists in ${existing.workspace_name} as application #${existing.number}.`
          : "";
        throw new Error(`This application has already been added.${location}`);
      }
      if (!result.success) throw new Error("The application could not be added.");
      setGeneratedApplication(null);
      if (isActive) toast({
        title: "Application added",
        description: `${generatedApplication.job_title || "Job"}${generatedApplication.company_name ? ` at ${generatedApplication.company_name}` : ""}`,
      });
    } catch (err) {
      const msg = getFriendlyErrorMessage(err, "Failed to add the application.");
      setError(msg);
      if (isActive) toast({ title: "Application Not Added", description: msg });
    } finally {
      setIsAddingApplication(false);
    }
  };

  const handleGenerateAnswers = async () => {
    if (!resumeData) {
      setApplicationError("Generate a resume before answering application questions.");
      return;
    }

    const questions = applicationQuestions
      .split("\n")
      .map((question) => question.trim())
      .filter(Boolean);
    if (!questions.length) {
      setApplicationError("Enter at least one application question.");
      return;
    }

    setApplicationError("");
    setIsGeneratingAnswers(true);
    try {
      const data = await window.aiProfiles.generate({
        profileId: profile.id,
        kind: "applicationAnswers",
        jobDescription,
        questions,
        resume: resumeData,
      });
      const responseText = (data.tailored_resume || "")
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
      const parsed = JSON.parse(responseText) as {
        answers?: Array<{ question?: unknown; answer?: unknown }>;
      };
      const answers = (parsed.answers ?? [])
        .filter((item) => typeof item.question === "string" && typeof item.answer === "string")
        .map((item) => ({ question: item.question as string, answer: item.answer as string }));
      if (answers.length !== questions.length) {
        throw new Error("The AI returned an incomplete set of application answers.");
      }
      setApplicationAnswers(answers);
    } catch (err) {
      const msg = getFriendlyErrorMessage(err, "Failed to generate application answers.");
      setApplicationError(msg);
      if (isActive) toast({ title: "Answer Generation Failed", description: msg });
    } finally {
      setIsGeneratingAnswers(false);
    }
  };

  const handleDownloadPDF = async (
    overrideData?: ResumeData,
    overrideCompanyName?: string,
    overrideGenerateCoverLetter?: boolean,
    overrideCoverLetterTemplate?: CoverLetterTemplateId,
    overrideUseCompanyName?: boolean,
    overrideSaveInFolder?: boolean,
    overrideCoverLetterText?: string | null,
  ) => {
    const targetResumeData = overrideData ?? resumeData;
    if (!targetResumeData || isDownloading) return;
    setError("");
    setIsDownloading(true);

    try {
      const { generateResumePDF } = await import("@/lib/pdf-templates");
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm1 = String(now.getMinutes()).padStart(2, "0");
      const ss = String(now.getSeconds()).padStart(2, "0");
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      const yyyy = String(now.getFullYear());
      const effectiveGenerateCoverLetter =
        overrideGenerateCoverLetter ?? (profile.generateCoverLetter ?? generateCoverLetter);
      const effectiveCoverLetterTemplate =
        overrideCoverLetterTemplate ??
        ((profile.coverLetterTemplate as CoverLetterTemplateId | undefined) ?? coverLetterTemplate);
      const effectiveUseCompanyName =
        overrideUseCompanyName ?? (profile.useCompanyName ?? useCompanyName);
      const effectiveSaveInFolder =
        overrideSaveInFolder ?? (profile.saveInFolder ?? saveInFolder);
      const targetCoverLetterText = overrideCoverLetterText ?? coverLetterText;
      const targetCompanyName = (overrideCompanyName ?? companyName ?? "").trim();
      const safeCompany =
        effectiveUseCompanyName && targetCompanyName
          ? targetCompanyName.replace(/[^a-zA-Z0-9 _-]/g, "_")
          : "";
      const safeFolder = `${yyyy}-${mm}-${dd}_${hh}-${mm1}-${ss}${safeCompany ? ` - ${safeCompany}` : ""}`;
      const safeFullName = "Resume";
      const savedJobDescription = downloadJDWithPDF
        ? targetResumeData.rateInJd === false && targetResumeData.annualSalary && targetResumeData.hourlyRate
          ? `${jobDescription.trim()}\n\nEstimated Salary Expectation (salary not mentioned in this JD)\nAnnual: ${targetResumeData.annualSalary}\nHourly: ${targetResumeData.hourlyRate}`
          : jobDescription
        : undefined;

      let folderPath: string | undefined;
      const shouldSaveInFolder = effectiveSaveInFolder || autoDownload;

      let downloadPath: string | undefined;
      if (shouldSaveInFolder) {
        const paths = await getProfileDownloadPaths();
        downloadPath = paths[profile.id];
        if (!downloadPath) {
          if (isGenerating) {
            throw new Error("Choose a download location in Settings before enabling automatic download.");
          }
          setIsDownloading(false);
          setDownloadLocationPromptOpen(true);
          return;
        }
        const r = await generateResumePDF(
          targetResumeData,
          `${safeFullName}.pdf`,
          true,
          selectedTemplate,
          safeFolder,
          savedJobDescription,
          profile.id,
          downloadPath,
        );
        folderPath = r.folderPath;
        if (effectiveGenerateCoverLetter && targetCoverLetterText) {
          await generateCoverLetterPDF(
            {
              text: targetCoverLetterText,
              personalInfo,
              companyName: targetCompanyName || "",
            },
            `Cover Letter.pdf`,
            true,
            effectiveCoverLetterTemplate,
            safeFolder,
            profile.id,
            downloadPath,
          );
        }
      } else {
        const filename = `${safeFullName}.pdf`;
        const r = await generateResumePDF(
          targetResumeData,
          filename,
          false,
          selectedTemplate,
          undefined,
        );
        folderPath = r.folderPath;
        if (effectiveGenerateCoverLetter && targetCoverLetterText) {
          const clFilename = `Cover Letter.pdf`;
          await generateCoverLetterPDF(
            {
              text: targetCoverLetterText,
              personalInfo,
              companyName: targetCompanyName || "",
            },
            clFilename,
            false,
            effectiveCoverLetterTemplate,
            undefined,
          );
        }
      }

      const hasCoverLetter = effectiveGenerateCoverLetter && !!targetCoverLetterText;
      setError("");
      if (isActive) toast({
        title: hasCoverLetter
          ? "Resume + Cover Letter Downloaded"
          : "Resume Downloaded",
        description: folderPath || (shouldSaveInFolder && downloadPath
          ? `Saved under ${downloadPath}`
          : "Saved to Chrome Downloads"),
        action: folderPath ? (
          <ToastAction
            altText="Open downloaded folder"
            onClick={() => {
              if (folderPath) {
                const fileUrl = folderPath.startsWith("file://")
                  ? folderPath
                  : `file:///${folderPath.replace(/\\/g, "/")}`;
                window.open(fileUrl, "_blank", "noopener,noreferrer");
                return;
              }

              if (isActive) toast({
                title: "Folder location unavailable",
                description:
                  "Your browser saved the file but does not expose its local path to open Windows Explorer.",
              });
            }}
          >
            Open folder
          </ToastAction>
        ) : undefined,
      });
    } catch (err) {
      console.error("PDF generation error:", err);
      setError(getFriendlyErrorMessage(err, "Failed to download the PDF. Please try again."));
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="max-w-[1400px] mx-auto py-8 px-4 sm:px-10 lg:px-20 h-full flex flex-col overflow-hidden">
      <div className={`relative flex-1 min-h-0 ${previewOpen || settingsOpen ? "overflow-hidden" : "overflow-y-auto"}`}>
      <div className="grid items-start gap-6">
      <div className="order-1 min-w-0">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2">
                <Briefcase className="h-5 w-5" />
                Job Description
              </CardTitle>
              <CardDescription className="mt-2">
                Paste the job description below, then click Generate.
              </CardDescription>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={`w-72 shrink-0 rounded-md border px-3 py-2 text-sm ${
                    resumeData?.annualSalary && resumeData.hourlyRate
                      ? resumeData.rateInJd
                        ? "border-green-500/50 bg-green-50 text-green-950 dark:bg-green-950/30 dark:text-green-100"
                        : "border-pink-500/50 bg-pink-50 text-pink-950 dark:bg-pink-950/30 dark:text-pink-100"
                      : ""
                  }`}
                >
                  <div className="font-medium">Salary Expectation</div>
                  {resumeData?.annualSalary && resumeData.hourlyRate ? (
                    <>
                      <div>Annual: {resumeData.annualSalary}</div>
                      <div>Hourly: {resumeData.hourlyRate}</div>
                    </>
                  ) : (
                    <div className="text-muted-foreground">Generate resume</div>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {resumeData?.annualSalary && resumeData.hourlyRate
                  ? resumeData.rateInJd
                    ? "This salary expectation comes from the job description."
                    : "This salary expectation is estimated from research."
                  : "Generate a resume to calculate the salary expectation."}
              </TooltipContent>
            </Tooltip>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
        <Textarea
          placeholder={`Paste the job description here...

  Example:
  Senior Software Engineer
  Requirements:
  - 5+ years of experience with JavaScript, React, Node.js
  - Experience with cloud platforms (AWS, GCP)
  - Strong system design skills
  ...`}
          className="min-h-[280px] max-h-[55vh] overflow-y-auto font-mono text-sm"
          value={jobDescription}
          onChange={(e) => {
          setJobDescription(e.target.value);
          setError("");
          }}
        />

        {error && (
          <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex gap-3 flex-wrap">
          <Button disabled={isGenerating} onClick={() => void handleGenerate()}>
            {isGenerating ? "Generating..." : "Generate Resume"}
          </Button>
          <Button
          variant="outline"
          onClick={() => setPreviewOpen(true)}
          disabled={!resumeData}
          >
          Preview Resume
          </Button>
          {generatedApplication && (
            <Button
              variant="outline"
              onClick={() => void handleAddApplication()}
              disabled={isAddingApplication || isGenerating}
            >
              {isAddingApplication ? (
                <Spinner className="h-4 w-4 mr-2" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              {isAddingApplication ? "Adding..." : "Add Application"}
            </Button>
          )}
        </div>
        </CardContent>
      </Card>
      </div>

      <div className="order-2 min-w-0">
      <Card>
        <CardHeader>
          <CardTitle>Application Questions</CardTitle>
          <CardDescription>
            Enter one question per line. Answers use the generated resume and job description.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            placeholder="Why are you interested in this role?\nDescribe a relevant project or achievement."
            value={applicationQuestions}
            onChange={(event) => {
              setApplicationQuestions(event.target.value);
              setApplicationError("");
            }}
            disabled={!resumeData || isGeneratingAnswers}
          />
          {applicationError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{applicationError}</AlertDescription>
            </Alert>
          )}
          <Button
            variant="outline"
            onClick={() => void handleGenerateAnswers()}
            disabled={!resumeData || isGeneratingAnswers || isGenerating}
          >
            {isGeneratingAnswers ? "Writing Answers..." : "Generate Answers"}
          </Button>
          {applicationAnswers.length > 0 && (
            <div className="space-y-4">
              {applicationAnswers.map((item, index) => (
                <div key={`${item.question}-${index}`} className="space-y-2">
                  <div className="font-medium">{item.question}</div>
                  <Textarea value={item.answer} readOnly className="min-h-28" />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      </div>
      </div>
      <FunnyLoadingBar isLoading={isGenerating || isGeneratingAnswers} profileName={tabLabel || profile.name || undefined} />
      </div>

      {/* Preview dialog */}
      <Dialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        modal={false}
      >
      {previewOpen && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-black/50"
          onClick={() => setPreviewOpen(false)}
        />
      )}
      <DialogContent
        className="sm:max-w-4xl h-[90vh] flex flex-col overflow-hidden"
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
        <DialogTitle>Preview</DialogTitle>
        <DialogDescription>
          Review and edit your tailored resume
          {generateCoverLetter && coverLetterText
          ? " and cover letter"
          : ""}{" "}
          before downloading
        </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="resume" className="mt-2 flex-1 overflow-hidden flex flex-col">
        <TabsList>
          <TabsTrigger value="resume">Resume</TabsTrigger>
          {generateCoverLetter && coverLetterText && (
          <TabsTrigger value="coverletter">Cover Letter</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="resume" className="flex-1 overflow-y-auto">
          {resumeData && (
          <div className="border rounded-lg overflow-hidden shadow-sm my-4">
            <ResumePreview
            data={resumeData}
            editable={previewEditable}
            onDataChange={setResumeData}
            />
          </div>
          )}
        </TabsContent>

        {generateCoverLetter && coverLetterText && (
          <TabsContent value="coverletter" className="flex-1 overflow-y-auto">
          <div className="my-4 space-y-3">
            <p className="text-xs text-muted-foreground">
            Edit the cover letter text below before downloading.
            </p>
            <Textarea
            className="max-h-[50vh] overflow-y-auto font-mono text-sm leading-relaxed"
            value={coverLetterText ?? ""}
            onChange={(e) => setCoverLetterText(e.target.value)}
            />
          </div>
          </TabsContent>
        )}
        </Tabs>

        <DialogFooter className="gap-2 sm:flex-wrap shrink-0">
        <Button variant="outline" onClick={() => setPreviewOpen(false)}>
          Close
        </Button>
        <Button
          variant="outline"
          onClick={() => setPreviewEditable((v) => !v)}
        >
          {previewEditable ? (
          <Check className="h-4 w-4 mr-2" />
          ) : (
          <Pencil className="h-4 w-4 mr-2" />
          )}
          {previewEditable ? "Done" : "Edit"}
        </Button>
        {useCompanyName && (
          <div className="flex min-w-[280px] flex-1 items-center gap-3">
          <label
            htmlFor={`company-${profile.id}`}
            className="shrink-0 text-sm font-medium text-muted-foreground"
          >
            Target Company
          </label>
          <Input
            id={`company-${profile.id}`}
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Company name"
            className="min-w-0"
          />
          </div>
        )}
        <Button onClick={() => void handleDownloadPDF()} disabled={isDownloading}>
          {isDownloading ? (
          <>
            <Spinner className="h-4 w-4 mr-2" />
            Downloading
          </>
          ) : (
          <>
            <FileDown className="h-4 w-4 mr-2" />
            Download PDF
          </>
          )}
        </Button>
        </DialogFooter>
      </DialogContent>
      </Dialog>

      <Dialog open={downloadLocationPromptOpen} onOpenChange={setDownloadLocationPromptOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Choose a download folder</DialogTitle>
            <DialogDescription>
              Select a folder for {profile.name || "this profile"}. Resume AI will remember it for future downloads.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDownloadLocationPromptOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                void chooseProfileDirectory(profile.id).then((selectedPath) => {
                  if (!selectedPath) return;
                  setDownloadLocationPromptOpen(false);
                  void handleDownloadPDF();
                }).catch((err) => {
                  if ((err as DOMException)?.name === "AbortError") return;
                  setError(getFriendlyErrorMessage(err, "Unable to choose a download folder."));
                });
              }}
            >
              Choose folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
