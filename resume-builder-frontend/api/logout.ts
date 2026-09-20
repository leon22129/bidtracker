import { clearSessionCookie } from "./_auth"

export default function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." })
    return
  }

  clearSessionCookie(res)
  res.status(200).json({ authenticated: false })
}
