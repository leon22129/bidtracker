import type { ResumeData } from "@/lib/parse-resume";
import type { PageQuestion } from "@/lib/extension-storage";

export type PreparedTabJob = {
  applicationId: string;
  url: string;
  companyName: string;
  jobTitle: string;
  description: string;
  submittedAt?: string | null;
};

export type ProfileTabState = {
  profileId: string;
  jobDescription: string;
  scannedJobUrl: string | null;
  preparedJob: PreparedTabJob | null;
  resumeData: ResumeData | null;
  conversationId: string | null;
  coverLetterText: string | null;
  applicationQuestions: string;
  scannedQuestions: PageQuestion[];
  applicationAnswers: Array<{ question: string; answer: string }>;
  answersReadOnly: boolean;
  workflowTab: "resume" | "questions";
  selectedTemplate: string;
  coverLetterTemplate: string;
};

export function readProfileTabState(key: string, profileId: string): ProfileTabState | null {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null") as ProfileTabState | null;
    return saved?.profileId === profileId ? saved : null;
  } catch {
    return null;
  }
}
