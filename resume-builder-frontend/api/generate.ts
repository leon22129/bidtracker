import { credentialsConfigured, readSession } from "./_auth"

const OPENAI_API_URL = "https://api.openai.com/v1/responses"
const OPENAI_MODEL = "gpt-5.6-sol"

type RequestBody = {
  prompt?: unknown
}

type OpenAIResponse = {
  error?: { message?: string }
  output_text?: string
  output?: Array<{
    type?: string
    role?: string
    content?: Array<{ type?: string; text?: string }>
  }>
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." })
    return
  }

  if (!credentialsConfigured() || !readSession(req)) {
    res.status(401).json({ error: "Sign in before generating a resume." })
    return
  }

  const prompt = (req.body as RequestBody | undefined)?.prompt
  if (typeof prompt !== "string" || !prompt.trim()) {
    res.status(400).json({ error: "A prompt is required." })
    return
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    res.status(500).json({ error: "The server is missing OPENAI_API_KEY." })
    return
  }

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: OPENAI_MODEL, input: prompt }),
    })
    const data = await response.json().catch(() => null) as OpenAIResponse | null

    if (!response.ok) {
      res.status(response.status).json({ error: data?.error?.message || "OpenAI request failed." })
      return
    }

    const outputText = data?.output
      ?.filter((item) => item.type === "message" && item.role === "assistant")
      .flatMap((item) => item.content ?? [])
      .filter((item) => item.type === "output_text")
      .map((item) => item.text ?? "")
      .join("")
    const content = (data?.output_text || outputText)?.trim()

    if (!content) {
      res.status(502).json({ error: "OpenAI returned an empty response." })
      return
    }

    res.status(200).json({ tailored_resume: content })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reach OpenAI."
    res.status(502).json({ error: message })
  }
}
