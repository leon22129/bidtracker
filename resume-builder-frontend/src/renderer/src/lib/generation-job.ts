type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>
type JobStatus = {
  job_id: string
  status: "queued" | "running" | "completed" | "failed"
  result?: unknown
  message?: string
}
type SocketOptions = { apiBaseUrl: string; token: string; version: string }
type SocketOutcome = "ready" | "rejected" | "unavailable"

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function waitForNotification(jobId: string, options: SocketOptions): Promise<SocketOutcome> {
  return new Promise((resolve) => {
    let socket: WebSocket | undefined
    let timer: ReturnType<typeof setTimeout>
    let finished = false
    const finish = (outcome: SocketOutcome) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      if (socket) {
        socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null
        socket.close()
      }
      resolve(outcome)
    }
    const arm = (delay: number) => {
      clearTimeout(timer)
      timer = setTimeout(() => finish("unavailable"), delay)
    }
    try {
      const url = new URL(`${options.apiBaseUrl.replace(/\/+$/, "")}/resume/jobs/events`)
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
      socket = new WebSocket(url)
      arm(10_000)
      socket.onopen = () => socket!.send(JSON.stringify({
        type: "subscribe", job_id: jobId, token: options.token, version: options.version,
      }))
      socket.onmessage = (event) => {
        let message: { type?: string; job_id?: string; status?: string }
        try { message = JSON.parse(event.data) } catch { return }
        if (!message) return
        if (message.type === "heartbeat") { arm(65_000); return }
        if (message.job_id !== jobId) return
        if (message.type === "subscribed" || message.type === "status") arm(65_000)
        if (message.type === "status" && ["completed", "failed"].includes(message.status || "")) finish("ready")
      }
      socket.onerror = () => finish("unavailable")
      socket.onclose = (event) => finish(event.code === 1008 ? "rejected" : "unavailable")
    } catch { finish("unavailable") }
  })
}

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
export async function generateWithJob(apiFetch: ApiFetch, path: string, payload: unknown, scope: string, socketOptions?: SocketOptions): Promise<unknown> {
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
  const acceptedAt = Date.now()
  if ((job.status === "queued" || job.status === "running") && socketOptions?.token && typeof WebSocket !== "undefined") {
    for (let attempt = 0; attempt < 3; attempt++) {
      const outcome = await waitForNotification(job.job_id, socketOptions)
      if (outcome !== "unavailable") {
        // Fetch the saved result through the regular authenticated API, including fresh access checks.
        job = await requestJson(apiFetch, `/resume/jobs/${encodeURIComponent(job.job_id)}`, { method: "GET" })
        break
      }
      if (attempt < 2) await pause(1000 * (attempt + 1))
    }
  }
  let pollDelay = Math.max(0, 50_000 - (Date.now() - acceptedAt))
  while (job.status === "queued" || job.status === "running") {
    await pause(pollDelay)
    job = await requestJson(apiFetch, `/resume/jobs/${encodeURIComponent(job.job_id)}`, { method: "GET" })
    pollDelay = 3000
  }
  forget()
  if (job.status === "failed") throw new Error(job.message || "Generation failed. Please try again.")
  return job.result
}
