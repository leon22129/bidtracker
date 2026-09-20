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
import { authStorage, getApiBaseUrl } from "@/lib/extension-storage"

function createId() {
  return crypto.randomUUID()
}

class UnauthorizedError extends Error {
  constructor() {
    super("Your session has expired. Please sign in again.")
    this.name = "UnauthorizedError"
  }
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await authStorage.getToken()
  const headers = new Headers(init.headers)
  if (token) headers.set("Authorization", `Bearer ${token}`)
  const response = await fetch(`${await getApiBaseUrl()}${path}`, { ...init, headers })
  if (response.status === 401) {
    await authStorage.clearToken()
    window.dispatchEvent(new CustomEvent("resume-ai-auth-invalid"))
    throw new UnauthorizedError()
  }
  return response
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
    const response = await apiFetch("/workspaces/profiles/assigned")
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
    const response = await apiFetch(`/workspaces/profiles/${input.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
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
    const response = await apiFetch("/resume/profile-generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
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
    const token = await authStorage.getToken()
    if (!token) return { authenticated: false }
    const response = await apiFetch("/auth/me")
    if (!response.ok) {
      return { authenticated: false }
    }
    const data = await response.json() as { username: string }
    return { authenticated: true, username: data.username }
  },
  async login(username, password) {
    const response = await apiFetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: username, password }),
    })
    const data = await response.json().catch(() => null) as { access_token?: string; user?: { username: string }; message?: string } | null
    if (!response.ok || !data?.access_token) throw new Error(data?.message || "Unable to sign in.")
    await authStorage.setToken(data.access_token)
    return { authenticated: true, username: data.user?.username || username }
  },
  async logout() {
    await authStorage.clearToken()
  },
}

export function installWebApis() {
  if (window.aiProfiles) return
  window.aiProfiles = webAiProfiles
  window.webAuth = webAuth
}
