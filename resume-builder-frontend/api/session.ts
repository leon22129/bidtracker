import { credentialsConfigured, readSession } from "./_auth"

export default function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." })
    return
  }

  if (!credentialsConfigured()) {
    res.status(500).json({ error: "Web login is not configured on the server." })
    return
  }

  const session = readSession(req)
  if (!session) {
    res.status(200).json({ authenticated: false })
    return
  }

  res.status(200).json({ authenticated: true, username: session.username })
}
