import type {
  AiProfile,
  AiProfilesApi,
  CreateAiProfileInput,
  GenerateResumeInput,
  GenerateResumeResult,
  UpdateAiProfileInput,
} from "../../../shared/ai-profiles"
import type { WebAuthApi, WebAuthStatus } from "../../../shared/auth"
import {
  normalizeResumeCertifications,
  normalizeResumeEducation,
  normalizeResumePersonalInfo,
} from "../../../shared/resume-profile"

const API_BASE = (import.meta as any).env?.VITE_BIDTRACKER_API_URL || "http://127.0.0.1:3001/api"
const TOKEN_KEY = "bidtracker_token"

function createId() {
  return crypto.randomUUID()
}

function createProfile(input: CreateAiProfileInput): AiProfile {
  const now = Date.now()
  return {
    ...input,
    id: createId(),
    name: input.name.trim() || "Profile",
    careerPath: input.careerPath || "",
    personalInfo: normalizeResumePersonalInfo(input.personalInfo),
    education: normalizeResumeEducation(input.education),
    certifications: normalizeResumeCertifications(input.certifications),
    createdAt: now,
    updatedAt: now,
  }
}

const webAiProfiles: AiProfilesApi = {
  async list() {
    const response = await fetch(`${API_BASE}/workspaces/profiles/assigned`, {
      headers: { Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY) || ""}` },
    })
    if (!response.ok) throw new Error("Unable to load assigned profiles.")
    const profiles = await response.json() as Array<any>
    return profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      careerPath: profile.career_path || "",
      personalInfo: normalizeResumePersonalInfo(profile.personal_info),
      education: normalizeResumeEducation(profile.education),
      certifications: normalizeResumeCertifications(profile.certifications),
      updateHeadline: profile.update_headline ?? true,
      useGeneratedRoleTitles: profile.use_generated_role_titles ?? true,
      template: profile.template,
      saveInFolder: profile.save_in_folder,
      autoDownload: profile.auto_download,
      downloadJDWithPDF: profile.download_jd_with_pdf,
      useCompanyName: profile.use_company_name,
      generateCoverLetter: profile.generate_cover_letter,
      coverLetterTemplate: profile.cover_letter_template,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }))
  },
  async create(input) {
    throw new Error("Profiles are created and assigned in BidTracker.")
  },
  async update(input: UpdateAiProfileInput) {
    const response = await fetch(`${API_BASE}/workspaces/profiles/${input.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY) || ""}`,
      },
      body: JSON.stringify({
        full_name: input.personalInfo?.fullName || "",
        template: input.template,
        save_in_folder: input.saveInFolder,
        auto_download: input.autoDownload,
        download_jd_with_pdf: input.downloadJDWithPDF,
        use_company_name: input.useCompanyName,
        generate_cover_letter: input.generateCoverLetter,
        cover_letter_template: input.coverLetterTemplate,
      }),
    })
    const data = await response.json().catch(() => null) as any
    if (!response.ok) throw new Error(data?.message || "Unable to save profile settings.")
    return {
      ...input,
      careerPath: data.career_path || "",
      personalInfo: normalizeResumePersonalInfo(data.personal_info),
      education: normalizeResumeEducation(data.education),
      certifications: normalizeResumeCertifications(data.certifications),
      updateHeadline: data.update_headline,
      useGeneratedRoleTitles: data.use_generated_role_titles,
      template: data.template,
      saveInFolder: data.save_in_folder,
      autoDownload: data.auto_download,
      downloadJDWithPDF: data.download_jd_with_pdf,
      useCompanyName: data.use_company_name,
      generateCoverLetter: data.generate_cover_letter,
      coverLetterTemplate: data.cover_letter_template,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  },
  async delete(profileId) {
    throw new Error("Profiles are deleted in BidTracker.")
  },
  async generate(input: GenerateResumeInput): Promise<GenerateResumeResult> {
    const response = await fetch(`${API_BASE}/resume/profile-generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY) || ""}`,
      },
      body: JSON.stringify({
        profile_id: input.profileId,
        job_description: input.jobDescription,
        kind: input.kind,
        questions: input.questions,
        resume: input.resume,
      }),
    })
    const data = await response.json().catch(() => null) as { tailored_resume?: string; full_name?: string; error?: string } | null
    if (!response.ok) throw new Error(data?.error || `Generation failed (${response.status}).`)
    if (!data?.tailored_resume) throw new Error("The AI provider returned an empty response.")
    return { tailored_resume: data.tailored_resume, full_name: data.full_name }
  },
}

const webAuth: WebAuthApi = {
  async status(): Promise<WebAuthStatus> {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) return { authenticated: false }
    const response = await fetch(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) {
      localStorage.removeItem(TOKEN_KEY)
      return { authenticated: false }
    }
    const data = await response.json() as { username: string }
    return { authenticated: true, username: data.username }
  },
  async login(username, password) {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: username, password }),
    })
    const data = await response.json().catch(() => null) as { access_token?: string; user?: { username: string }; message?: string } | null
    if (!response.ok || !data?.access_token) throw new Error(data?.message || "Unable to sign in.")
    localStorage.setItem(TOKEN_KEY, data.access_token)
    return { authenticated: true, username: data.user?.username || username }
  },
  async logout() {
    localStorage.removeItem(TOKEN_KEY)
  },
}

export function installWebApis() {
  if (window.aiProfiles) return
  window.aiProfiles = webAiProfiles
  window.webAuth = webAuth
}
