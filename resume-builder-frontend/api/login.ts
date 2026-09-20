import { credentialsConfigured, credentialsMatch, setSessionCookie } from "./_auth"

export default function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." })
    return
  }

  if (!credentialsConfigured()) {
    res.status(500).json({ error: "Web login is not configured on the server." })
    return
  }

  const { username, password } = req.body || {}
  if (typeof username !== "string" || typeof password !== "string" || !credentialsMatch(username, password)) {
    res.status(401).json({ error: "Invalid username or password." })
    return
  }

  setSessionCookie(res, username.trim())
  res.status(200).json({ authenticated: true, username: username.trim() })
}
