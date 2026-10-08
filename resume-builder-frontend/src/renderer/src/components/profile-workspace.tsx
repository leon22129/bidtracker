"use client";

import { useState, useEffect } from "react";
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
  RefreshCw,
  ClipboardCheck,
  Eye,
  History,
  UserRound,
  MapPin,
  Mail,
  Phone,
  Linkedin,
  MessagesSquare,
} from "lucide-react";
import {
  type ResumeData,
  type PersonalInfo,
  type Education,
  type Certification,
  normalizeSkills,
} from "@/lib/parse-resume";
import type { AiProfile, ApplicationQuestionInput } from "../../../shared/ai-profiles";
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
import {
  canScanCurrentPage,
  chooseProfileDirectory,
  fillCurrentPageAnswers,
  getCurrentBrowserTabUrl,
  getCurrentPageContext,
  getProfileDownloadPaths,
  type PageQuestion,
} from "@/lib/extension-storage";

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

function formatQuestionEditorLine(item: PageQuestion): string {
  if (!item.options.length) return item.question;
  const instruction = item.fieldType === "checkbox" ? "Choose one or more." : "Choose Only one.";
  return `${item.question} ${instruction} ${item.options.join("/")}`;
}

function questionInputFromEditorLine(line: string, scannedQuestions: PageQuestion[]): ApplicationQuestionInput {
  const scanned = scannedQuestions.find((item) =>
    item.question === line || formatQuestionEditorLine(item) === line,
  );
  return {
    question: scanned?.question ?? line,
    options: scanned?.options ?? [],
  };
}

function comparableJobUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const ignored = new Set([
      "source", "src", "ref", "referrer", "trackingid", "trk", "trkinfo", "position",
      "pagenum", "origin", "originalsubdomain", "savedsearchid", "refid", "eburl", "from",
      "lipi", "licu", "fbclid", "gclid", "mc_cid", "mc_eid", "ittk", "sid", "jobclick",
      "campaignid", "clickid", "applyflowversion",
    ]);
    const params = new URLSearchParams();
    [...url.searchParams.keys()].sort().forEach((key) => {
      const lower = key.toLowerCase();
      if (ignored.has(lower) || ["utm_", "gh_", "ref_"].some((prefix) => lower.startsWith(prefix))) return;
      url.searchParams.getAll(key).forEach((value) => params.append(lower, value));
    });
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
    const query = params.toString();
    return `${host}${path}${query ? `?${query}` : ""}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

function formatAddressLines(personalInfo: PersonalInfo): string[] {
  const cityStateZip = [
    personalInfo.city?.trim(),
    [personalInfo.state?.trim(), personalInfo.zip?.trim()].filter(Boolean).join(" "),
  ].filter(Boolean).join(", ");
  const structured = [
    personalInfo.address1?.trim(),
    cityStateZip,
    personalInfo.county?.trim() ? `County: ${personalInfo.county.trim()}` : "",
    personalInfo.country?.trim(),
  ].filter(Boolean);
  return structured.length ? structured : [personalInfo.location?.trim()].filter(Boolean);
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
    firstName: "",
    middleName: "",
    lastName: "",
    title: "",
    email: "",
    phone: "",
    location: "",
    country: "",
    address1: "",
    city: "",
    county: "",
    state: "",
    zip: "",
    linkedin: "",
    gender: "",
    hispanicLatino: "",
    ethnicity: "",
    requiresSponsorship: "",
    legallyAuthorizedUs: "",
    usWorkStatus: "",
  });
  const [education, setEducation] = useState<Education[]>([
    { degree: "", school: "", year: "" },
  ]);
  const [certifications, setCertifications] = useState<Certification[]>([]);

  // Per-generation data
  const [jobDescription, setJobDescription] = useState("");
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [coverLetterText, setCoverLetterText] = useState<string | null>(null);
  const [applicationQuestions, setApplicationQuestions] = useState("");
  const [scannedQuestions, setScannedQuestions] = useState<PageQuestion[]>([]);
  const [applicationAnswers, setApplicationAnswers] = useState<Array<{ question: string; answer: string }>>([]);
  const [answersReadOnly, setAnswersReadOnly] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingAnswers, setIsGeneratingAnswers] = useState(false);
  const [isScanningPage, setIsScanningPage] = useState(false);
  const [isFillingPage, setIsFillingPage] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isLoadingLastApplication, setIsLoadingLastApplication] = useState(false);
  const [error, setError] = useState("");
  const [applicationError, setApplicationError] = useState("");
  const [pageScanMessage, setPageScanMessage] = useState("");
  const [questionScanMessage, setQuestionScanMessage] = useState("");
  const [pageFillMessage, setPageFillMessage] = useState("");

  // UI state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewEditable, setPreviewEditable] = useState(false);
  const [downloadLocationPromptOpen, setDownloadLocationPromptOpen] = useState(false);
  const [workflowTab, setWorkflowTab] = useState<"resume" | "questions">("resume");
  const addressLines = formatAddressLines(personalInfo);

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
    setConversationId(null);
    setCompanyName("");
    setApplicationAnswers([]);
    setAnswersReadOnly(false);
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
      if (data.jobDescription?.trim()) setJobDescription(data.jobDescription.trim());
      if (data.duplicate) {
        const existing = data.existingApplication;
        const location = existing
          ? ` It already exists in ${existing.workspace_name} as application #${existing.number}.`
          : "";
        const reason = data.duplicateType === "job_fingerprint"
          ? `A recent application has the same company and job title.${location}`
          : `This job URL has already been added.${location}`;
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

      const generatedJobTitle = data.application?.job_title?.trim() ?? "";
      const generatedCompanyName = data.application?.company_name?.trim() ?? "";
      if (!generatedJobTitle || !generatedCompanyName) {
        const missing = [
          !generatedCompanyName ? "company name" : null,
          !generatedJobTitle ? "job title" : null,
        ].filter(Boolean).join(" and ");
        const msg = `Resume generation did not return a ${missing}. The application cannot be saved.`;
        setCompanyName("");
        setError(msg);
        toast({ title: "Application Details Missing", description: msg });
        return;
      }

      const parsed = parseGeneratedResume(generatedContent);

      if (parsed.error) {
        const msg = String(parsed.error).trim();
        if (isActive) toast({ title: "Generation skipped", description: msg });
        setError(msg);
        return;
      }

      const effectiveCompanyName = generatedCompanyName;
      setCompanyName(effectiveCompanyName);

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
      if (!data.conversationId) {
        throw new Error("The server did not create an application-question conversation.");
      }
      setConversationId(data.conversationId);
      setApplicationAnswers(data.answers ?? []);
      setAnswersReadOnly(false);

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
      toast({ title: "Generation Failed", description: msg });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleLoadLastApplication = async () => {
    if (!profile.workspaceId || isLoadingLastApplication) return;
    setIsLoadingLastApplication(true);
    setError("");
    try {
      const saved = await window.aiProfiles.loadLastApplication(profile.workspaceId);
      const loadedResume = saved.resume as ResumeData;
      if (!loadedResume || typeof loadedResume !== "object" || !loadedResume.personalInfo) {
        throw new Error("The saved resume is not valid.");
      }

      setJobDescription(saved.job_description ?? "");
      setResumeData(loadedResume);
      setPersonalInfo(loadedResume.personalInfo);
      setEducation(loadedResume.education ?? []);
      setCertifications(loadedResume.certifications ?? []);
      setCompanyName(saved.company_name ?? "");
      setConversationId(saved.conversation_id);
      setCoverLetterText(saved.cover_letter_text);
      let restoredHistory = {
        questions: saved.questions ?? [],
        answers: saved.answers ?? [],
      };
      let historyRestoreFailed = false;
      if ((!saved.questions || !saved.answers) && saved.conversation_id) {
        try {
          restoredHistory = await window.aiProfiles.loadConversationAnswers(saved.conversation_id);
        } catch {
          historyRestoreFailed = true;
        }
      }
      const restoredQuestions: PageQuestion[] = restoredHistory.questions.map((item) => ({
        question: item.question,
        options: item.options ?? [],
        fieldType: item.options?.length ? "select" : "text",
        sensitive: false,
      }));
      setApplicationQuestions(restoredQuestions.map(formatQuestionEditorLine).join("\n"));
      setScannedQuestions(restoredQuestions);
      setApplicationAnswers(restoredHistory.answers);
      setAnswersReadOnly(true);
      if (restoredHistory.answers.length) setWorkflowTab("questions");
      setApplicationError("");
      if (saved.template) setSelectedTemplate(saved.template as TemplateId);
      if (saved.cover_letter_template) {
        setCoverLetterTemplate(saved.cover_letter_template as CoverLetterTemplateId);
      }
      if (saved.cover_letter_text) setGenerateCoverLetter(true);

      let mismatch = false;
      try {
        const currentUrl = await getCurrentBrowserTabUrl();
        mismatch = comparableJobUrl(currentUrl) !== comparableJobUrl(saved.url);
      } catch {
        // Standalone mode has no active browser tab to compare.
      }

      const conversationNote = restoredHistory.answers.length
        ? ` Restored ${restoredHistory.answers.length} saved application answer${restoredHistory.answers.length === 1 ? "" : "s"}.`
        : !saved.conversation_id
          ? " The saved documents were restored, but no application answers were saved."
          : historyRestoreFailed
          ? " The documents were restored, but conversation history could not be retrieved."
          : " The conversation is available, but it does not contain application answers yet.";
      const description = mismatch
        ? `The active page URL does not match the restored application (${saved.company_name || saved.job_title || saved.url}).${conversationNote}`
        : `Restored ${saved.company_name || saved.job_title || "your last generated application"}.${conversationNote}`;
      toast({
        title: mismatch ? "Application URL does not match" : "Last application loaded",
        description,
        variant: mismatch ? "destructive" : "default",
      });
    } catch (err) {
      const message = getFriendlyErrorMessage(err, "Unable to load the last application.");
      setError(message);
      toast({ title: "Could Not Load Last Application", description: message, variant: "destructive" });
    } finally {
      setIsLoadingLastApplication(false);
    }
  };

  const handleScanPage = async (scope: "page" | "questions" = "page") => {
    const questionsOnly = scope === "questions";
    if (!canScanCurrentPage()) {
      const message = "Page scanning is available in the Chrome extension. You can paste the content manually.";
      if (questionsOnly) setQuestionScanMessage(message);
      else setPageScanMessage(message);
      return;
    }
    setIsScanningPage(true);
    if (questionsOnly) setQuestionScanMessage("");
    else setPageScanMessage("");
    try {
      const context = await getCurrentPageContext({ includeQuestions: questionsOnly });
      const nonSensitiveQuestions = context.questions.filter((item) => !item.sensitive);
      const safeQuestions = nonSensitiveQuestions.slice(0, 50);
      const sensitiveCount = context.questions.length - nonSensitiveQuestions.length;
      const omittedCount = nonSensitiveQuestions.length - safeQuestions.length;
      const choiceCount = safeQuestions.filter((item) => item.options.length).length;

      if (!questionsOnly && context.jobDescription.trim()) {
        setJobDescription(context.jobDescription.trim());
        setError("");
      }
      if (questionsOnly) {
        setApplicationQuestions(safeQuestions.map(formatQuestionEditorLine).join("\n"));
        setScannedQuestions(safeQuestions);
        setApplicationAnswers([]);
        setAnswersReadOnly(false);
        setApplicationError("");
        setPageFillMessage("");
      }

      const parts = [
        ...(!questionsOnly ? [context.jobDescription.trim()
          ? "Job description found"
          : "No job description was identified; paste it manually"] : []),
        ...(questionsOnly ? [safeQuestions.length
          ? `${safeQuestions.length} application question${safeQuestions.length === 1 ? "" : "s"} found`
          : "no application questions found on this page"] : []),
      ];
      if (questionsOnly && sensitiveCount) parts.push(`${sensitiveCount} sensitive field${sensitiveCount === 1 ? " was" : "s were"} excluded from AI and will use saved profile values when available`);
      if (questionsOnly && choiceCount) parts.push(`allowed choices captured for ${choiceCount} question${choiceCount === 1 ? "" : "s"}`);
      if (questionsOnly && omittedCount) parts.push(`${omittedCount} extra field${omittedCount === 1 ? " was" : "s were"} omitted from the 50-question limit`);
      const message = `${parts.join("; ")}.`;
      if (questionsOnly) setQuestionScanMessage(message);
      else setPageScanMessage(message);
    } catch (err) {
      const message = getFriendlyErrorMessage(err, "This page could not be scanned. Enter the content manually.");
      if (questionsOnly) setQuestionScanMessage(message);
      else setPageScanMessage(message);
    } finally {
      setIsScanningPage(false);
    }
  };

  const handleFillPage = async () => {
    setIsFillingPage(true);
    setPageFillMessage("");
    try {
      const result = await fillCurrentPageAnswers(applicationAnswers, personalInfo, coverLetterText ?? undefined);
      const skipped = result.skipped
        ? ` ${result.skipped} answer${result.skipped === 1 ? "" : "s"} could not be safely matched and must be entered manually.`
        : "";
      const skippedDetails = result.skippedQuestions.length
        ? ` Skipped: ${result.skippedQuestions.slice(0, 5).join("; ")}.`
        : "";
      setPageFillMessage(`Filled ${result.filled} profile or answer field${result.filled === 1 ? "" : "s"}.${skipped}${skippedDetails} Review the page before continuing.`);
    } catch (err) {
      setPageFillMessage(getFriendlyErrorMessage(err, "The answers could not be filled on this page."));
    } finally {
      setIsFillingPage(false);
    }
  };

  const handleGenerateAnswers = async () => {
    if (!resumeData || !conversationId) {
      setApplicationError("Generate a resume before answering application questions.");
      return;
    }

    const questionLines = applicationQuestions
      .split("\n")
      .map((question) => question.trim())
      .filter(Boolean);
    if (!questionLines.length) {
      setApplicationError("Enter at least one application question.");
      return;
    }
    const questions = questionLines.map((question) =>
      questionInputFromEditorLine(question, scannedQuestions),
    );

    setApplicationError("");
    setIsGeneratingAnswers(true);
    try {
      const data = await window.aiProfiles.generate({
        profileId: profile.id,
        kind: "applicationAnswers",
        conversationId,
        questions,
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
      if (answers.length !== questionLines.length) {
        throw new Error("The AI returned an incomplete set of application answers.");
      }
      setApplicationAnswers(answers);
      setAnswersReadOnly(false);
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
        overrideGenerateCoverLetter ?? (
          Boolean(overrideCoverLetterText ?? coverLetterText) ||
          (profile.generateCoverLetter ?? generateCoverLetter)
        );
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
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <UserRound className="h-5 w-5" />
            Personal Information
          </CardTitle>
          <CardDescription>
            The contact details used for this profile's resume and application autofill.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <div className="min-w-0 rounded-md border bg-muted/30 p-3">
              <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <UserRound className="h-3.5 w-3.5" /> Full name
              </div>
              <div className="truncate text-sm font-medium" title={personalInfo.fullName || undefined}>
                {personalInfo.fullName || "Not provided"}
              </div>
            </div>
            <div className="min-w-0 rounded-md border bg-muted/30 p-3 sm:col-span-2">
              <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" /> Full address
              </div>
              {addressLines.length ? (
                <div className="text-sm font-medium" title={addressLines.join(", ")}>
                  {addressLines.map((line) => <div key={line} className="truncate">{line}</div>)}
                </div>
              ) : <div className="text-sm font-medium">Not provided</div>}
            </div>
            <div className="min-w-0 rounded-md border bg-muted/30 p-3">
              <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Mail className="h-3.5 w-3.5" /> Email
              </div>
              {personalInfo.email ? (
                <a className="block truncate text-sm font-medium text-primary hover:underline" href={`mailto:${personalInfo.email}`} title={personalInfo.email}>
                  {personalInfo.email}
                </a>
              ) : <div className="text-sm font-medium">Not provided</div>}
            </div>
            <div className="min-w-0 rounded-md border bg-muted/30 p-3">
              <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Phone className="h-3.5 w-3.5" /> Phone
              </div>
              {personalInfo.phone ? (
                <a className="block truncate text-sm font-medium text-primary hover:underline" href={`tel:${personalInfo.phone}`} title={personalInfo.phone}>
                  {personalInfo.phone}
                </a>
              ) : <div className="text-sm font-medium">Not provided</div>}
            </div>
            <div className="min-w-0 rounded-md border bg-muted/30 p-3">
              <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Linkedin className="h-3.5 w-3.5" /> LinkedIn
              </div>
              {personalInfo.linkedin ? (
                <a
                  className="block truncate text-sm font-medium text-primary hover:underline"
                  href={/^https?:\/\//i.test(personalInfo.linkedin) ? personalInfo.linkedin : `https://${personalInfo.linkedin}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={personalInfo.linkedin}
                >
                  {personalInfo.linkedin}
                </a>
              ) : <div className="text-sm font-medium">Not provided</div>}
            </div>
          </div>
        </CardContent>
      </Card>
      </div>

      <Tabs
        value={workflowTab}
        onValueChange={(value) => setWorkflowTab(value as "resume" | "questions")}
        className="order-2 min-w-0 gap-4"
      >
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl p-1.5">
          <TabsTrigger
            value="resume"
            className="h-auto min-w-0 flex-col items-start gap-1 whitespace-normal rounded-lg px-4 py-3 text-left"
          >
            <span className="flex items-center gap-2 font-semibold">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                {resumeData ? <Check className="h-3.5 w-3.5" /> : "1"}
              </span>
              <Briefcase className="h-4 w-4" />
              Resume Generation
            </span>
            <span className="hidden pl-8 text-xs font-normal text-muted-foreground sm:block">
              Scan the job, generate files, and review the result
            </span>
          </TabsTrigger>
          <TabsTrigger
            value="questions"
            className="h-auto min-w-0 flex-col items-start gap-1 whitespace-normal rounded-lg px-4 py-3 text-left"
          >
            <span className="flex items-center gap-2 font-semibold">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                {applicationAnswers.length ? <Check className="h-3.5 w-3.5" /> : "2"}
              </span>
              <MessagesSquare className="h-4 w-4" />
              Application Questions
            </span>
            <span className="hidden pl-8 text-xs font-normal text-muted-foreground sm:block">
              Scan questions, write answers, and fill the application
            </span>
          </TabsTrigger>
        </TabsList>

      <TabsContent value="resume" className="mt-0">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2">
                <Briefcase className="h-5 w-5" />
                Job Description & Resume
              </CardTitle>
              <CardDescription className="mt-2">
                Scanned from the active job page when possible. You can always edit or paste it manually.
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

        <div className="space-y-2">
          <p className="text-sm font-semibold text-foreground">Job page actions</p>
          <div className="max-w-xl">
            <Button
              type="button"
              onClick={() => void handleScanPage("page")}
              disabled={isScanningPage || isGenerating}
              className="group h-auto min-h-14 w-full justify-start whitespace-normal border border-blue-800 bg-blue-700 px-4 py-3 text-left text-white shadow-sm hover:bg-blue-800 hover:text-white focus-visible:border-blue-900 focus-visible:ring-blue-500/60 disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-600 disabled:opacity-100 dark:border-blue-400 dark:bg-blue-700 dark:hover:bg-blue-600 dark:disabled:border-slate-700 dark:disabled:bg-slate-800 dark:disabled:text-slate-400"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-white/15">
                <RefreshCw className={isScanningPage ? "animate-spin" : ""} />
              </span>
              <span className="min-w-0">
                <span className="block font-semibold">
                  {isScanningPage ? "Scanning Current Page..." : "Scan Current Page"}
                </span>
                <span className="block text-xs font-normal text-blue-100 group-disabled:text-current">
                  Import the active job description
                </span>
              </span>
            </Button>
          </div>
          {pageScanMessage && <p className="text-sm text-muted-foreground">{pageScanMessage}</p>}
        </div>

        {error && (
          <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-3">
          <div className="flex gap-3 flex-wrap">
            <Button disabled={isGenerating} onClick={() => void handleGenerate()}>
              {isGenerating ? "Generating..." : "Generate Resume"}
            </Button>
            <Button
              onClick={() => setPreviewOpen(true)}
              disabled={!resumeData}
              className="min-h-10 border border-violet-800 bg-violet-700 px-4 text-white shadow-sm hover:bg-violet-800 hover:text-white focus-visible:border-violet-900 focus-visible:ring-violet-500/60 disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-600 disabled:opacity-100 dark:border-violet-400 dark:bg-violet-700 dark:hover:bg-violet-600 dark:disabled:border-slate-700 dark:disabled:bg-slate-800 dark:disabled:text-slate-400"
            >
              <Eye />
              Preview Resume
            </Button>
            {resumeData && (
              <Button variant="secondary" onClick={() => setWorkflowTab("questions")}>
                Continue to Application Questions
                <MessagesSquare className="h-4 w-4" />
              </Button>
            )}
          </div>
          <Button
            type="button"
            onClick={() => void handleLoadLastApplication()}
            disabled={!profile.workspaceId || isLoadingLastApplication || isGenerating}
            className="group h-auto min-h-14 w-full max-w-xl justify-start whitespace-normal border border-slate-950 bg-slate-900 px-4 py-3 text-left text-white shadow-sm hover:bg-slate-700 hover:text-white focus-visible:border-slate-950 focus-visible:ring-slate-500/60 disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-600 disabled:opacity-100 dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white dark:hover:text-slate-950 dark:disabled:border-slate-700 dark:disabled:bg-slate-800 dark:disabled:text-slate-400"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-white/15 dark:bg-black/10">
              <History className={isLoadingLastApplication ? "animate-spin" : ""} />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold">
                {isLoadingLastApplication ? "Loading Last Application..." : "Load Last Application"}
              </span>
              <span className="block text-xs font-normal text-slate-200 group-disabled:text-current dark:text-slate-600 dark:group-disabled:text-current">
                Restore its resume and saved answers
              </span>
            </span>
          </Button>
        </div>
        </CardContent>
      </Card>
      </TabsContent>

      <TabsContent value="questions" className="mt-0">
      <Card>
        <CardHeader>
          <CardTitle>Application Questions</CardTitle>
          <CardDescription>
            Click Scan Questions on each application page, then edit the results or enter one question per line.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!resumeData && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                You can scan questions now. Generate or load a resume in Step 1 before asking AI to write answers.
              </AlertDescription>
            </Alert>
          )}
          {resumeData && !conversationId && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                The resume is available, but its answer conversation has expired. Generate a new resume to write new answers.
              </AlertDescription>
            </Alert>
          )}
          <Textarea
            placeholder="Why are you interested in this role?\nDescribe a relevant project or achievement."
            value={applicationQuestions}
            onChange={(event) => {
              setApplicationQuestions(event.target.value);
              setApplicationError("");
            }}
            disabled={isGenerating || isGeneratingAnswers}
          />
          {applicationError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{applicationError}</AlertDescription>
            </Alert>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              type="button"
              onClick={() => void handleScanPage("questions")}
              disabled={isScanningPage || isGeneratingAnswers}
              className="min-h-10 border border-blue-800 bg-blue-700 px-4 text-white shadow-sm hover:bg-blue-800 hover:text-white focus-visible:border-blue-900 focus-visible:ring-blue-500/60 disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-600 disabled:opacity-100 dark:border-blue-400 dark:bg-blue-700 dark:hover:bg-blue-600 dark:disabled:border-slate-700 dark:disabled:bg-slate-800 dark:disabled:text-slate-400"
            >
              <RefreshCw className={isScanningPage ? "animate-spin" : ""} />
              {isScanningPage ? "Scanning Questions..." : "Scan Questions"}
            </Button>
            <Button
              onClick={() => void handleGenerateAnswers()}
              disabled={!resumeData || !conversationId || isGeneratingAnswers || isGenerating || isScanningPage}
              className="min-h-10 border border-violet-800 bg-violet-700 px-4 text-white shadow-sm hover:bg-violet-800 hover:text-white focus-visible:border-violet-900 focus-visible:ring-violet-500/60 disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-600 disabled:opacity-100 dark:border-violet-400 dark:bg-violet-700 dark:hover:bg-violet-600 dark:disabled:border-slate-700 dark:disabled:bg-slate-800 dark:disabled:text-slate-400"
            >
              <MessagesSquare />
              {isGeneratingAnswers ? "Writing Answers..." : "Generate Answers"}
            </Button>
            <Button
              type="button"
              onClick={() => void handleFillPage()}
              disabled={isFillingPage || isGeneratingAnswers}
            >
              <ClipboardCheck className="h-4 w-4 mr-2" />
              {isFillingPage ? "Filling Page..." : "Autofill Profile + Answers"}
            </Button>
          </div>
          {questionScanMessage && <p className="text-sm text-muted-foreground">{questionScanMessage}</p>}
          {pageFillMessage && <p className="text-sm text-muted-foreground">{pageFillMessage}</p>}
          {applicationAnswers.length > 0 && (
            <div className="space-y-4">
              {applicationAnswers.map((item, index) => (
                <div key={`${item.question}-${index}`} className="space-y-2">
                  <div className="font-medium">{item.question}</div>
                  <Textarea
                    value={item.answer}
                    className={`min-h-28 ${answersReadOnly ? "bg-muted" : ""}`}
                    readOnly={answersReadOnly}
                    onChange={(event) => setApplicationAnswers((current) => current.map((answer, answerIndex) =>
                      answerIndex === index ? { ...answer, answer: event.target.value } : answer,
                    ))}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      </TabsContent>
      </Tabs>
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
            onChange={(e) => {
              setCompanyName(e.target.value);
            }}
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
