import { createHmac, timingSafeEqual } from "node:crypto"
import { Buffer } from "node:buffer"

const COOKIE_NAME = "resume_session"
const SESSION_MAX_AGE = 60 * 60 * 24 * 7

type SessionPayload = {
  username: string
  exp: number
}

function secret() {
  return process.env.WEB_SESSION_SECRET?.trim() || ""
}

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url")
}

function sign(value: string) {
  return createHmac("sha256", secret()).update(value).digest("base64url")
}

function serializeSession(payload: SessionPayload) {
  const body = encode(JSON.stringify(payload))
  return `${body}.${sign(body)}`
}

function parseCookies(header: string | undefined) {
  return Object.fromEntries(
    (header || "").split(";").map((part) => {
      const separator = part.indexOf("=")
      return separator === -1
        ? [part.trim(), ""]
        : [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())]
    }).filter(([key]) => key),
  )
}

export function readSession(req: any): SessionPayload | null {
  if (!secret()) return null
  const value = parseCookies(req.headers?.cookie)[COOKIE_NAME]
  if (!value) return null

  const [body, signature] = value.split(".")
  if (!body || !signature) return null

  const expected = sign(body)
  const actualBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload
    return payload.exp > Date.now() ? payload : null
  } catch {
    return null
  }
}

export function setSessionCookie(res: any, username: string) {
  const value = serializeSession({ username, exp: Date.now() + SESSION_MAX_AGE * 1000 })
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}`)
}

export function clearSessionCookie(res: any) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`)
}

export function credentialsConfigured() {
  return Boolean(process.env.WEB_USERNAME?.trim() && process.env.WEB_PASSWORD && secret())
}

export function credentialsMatch(username: string, password: string) {
  return username === process.env.WEB_USERNAME?.trim() && password === process.env.WEB_PASSWORD
}
