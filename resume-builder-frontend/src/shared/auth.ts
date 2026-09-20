export type WebAuthStatus = {
  authenticated: boolean
  username?: string
  message?: string
}

export type WebAuthApi = {
  status: () => Promise<WebAuthStatus>
  login: (username: string, password: string) => Promise<WebAuthStatus>
  logout: () => Promise<void>
}
