type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>
type JobStatus = {
  job_id: string
  status: "queued" | "running" | "completed" | "failed"
  result?: unknown
  message?: string
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

async function requestJson(apiFetch: ApiFetch, path: string, init: RequestInit): Promise<JobStatus> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await apiFetch(path, { ...init, signal: AbortSignal.timeout(20_000), cache: "no-store" })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new RequestError(data?.message || `Generation request failed (${response.status}).`, response.status)
      if (!data?.job_id || !["queued", "running", "completed", "failed"].includes(data.status)) {
        throw new RequestError("The server returned an invalid generation status.", 502)
      }
      return data
    } catch (error) {
      const temporary = error instanceof RequestError ? error.status >= 500 || error.status === 408
        : error instanceof TypeError || (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name))
      if (!temporary) throw error
      if (attempt >= 3) throw new Error("Connection interrupted. Retry to check the same generation; it may still be running.")
      await pause(1000 * 2 ** attempt)
    }
  }
}

/** Persist only an opaque request ID, so a lost response/reload can reconnect without paying twice. */
export async function generateWithJob(apiFetch: ApiFetch, path: string, payload: unknown, scope: string): Promise<unknown> {
  const body = JSON.stringify(payload)
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${scope}\n${path}\n${body}`))
  const key = "resume-ai-generation:" + Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")
  let pending: { id: string; createdAt: number } | null = null
  try { pending = JSON.parse(sessionStorage.getItem(key) || "null") } catch { /* Storage may be unavailable. */ }
  if (!pending?.id || !pending.createdAt || Date.now() - pending.createdAt >= 24 * 60 * 60 * 1000) {
    pending = { id: crypto.randomUUID(), createdAt: Date.now() }
  }
  try { sessionStorage.setItem(key, JSON.stringify(pending)) } catch { /* Retries within this call still reuse the ID. */ }
  const forget = () => { try { sessionStorage.removeItem(key) } catch { /* Optional storage. */ } }
  let job: JobStatus
  try {
    job = await requestJson(apiFetch, path, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Generation-Id": pending.id }, body,
    })
  } catch (error) {
    // A rejected submission did not start generation. Keep the ID on transport failures.
    if (error instanceof RequestError && error.status < 500) forget()
    throw error
  }
  const startedAt = Date.now()
  while (job.status === "queued" || job.status === "running") {
    await pause(Date.now() - startedAt < 30_000 ? 1500 : 3000)
    job = await requestJson(apiFetch, `/resume/jobs/${encodeURIComponent(job.job_id)}`, { method: "GET" })
  }
  forget()
  if (job.status === "failed") throw new Error(job.message || "Generation failed. Please try again.")
  return job.result
}
