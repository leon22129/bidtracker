# Resume Builder

A browser app that tailors your resume to any job description using the OpenAI API and returns a formatted, downloadable PDF.

## Getting started

```bash
npm install
npm run dev
```

Create an AI Profile, paste a job description, generate the resume, and download the PDF from the browser.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the Vite web app with hot reload |
| `npm run build` | Type-check and build the web app |
| `npm run preview` | Preview the production build |

## Architecture

- React and Vite provide the browser UI.
- Browser profiles are stored in local storage.
- Browser PDF downloads use the File System Access API when available, with a normal download fallback.
- `api/generate.ts` calls OpenAI server-side so the API key is never exposed to visitors.
- `api/login.ts`, `api/session.ts`, and `api/logout.ts` provide credential login with an HTTP-only signed session cookie.

## Hosting on Vercel

1. Import the repository into Vercel.
2. Add these environment variables:
   - `OPENAI_API_KEY` - the server-side OpenAI key.
   - `WEB_USERNAME` - the hosted app username.
   - `WEB_PASSWORD` - the hosted app password.
   - `WEB_SESSION_SECRET` - a long random value used to sign login sessions.
3. Deploy. The `vercel.json` configuration runs `npm run build` and serves `dist-web`.

This is a single shared credential setup. Add a database-backed user system and rate limiting before opening the site to multiple customers.
