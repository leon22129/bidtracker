# Resume Builder

A browser app that tailors your resume to any job description using the OpenAI API and returns a formatted, downloadable PDF.

## Getting started

```bash
npm install
npm run dev
```

Create an AI Profile, paste a job description, generate the resume, and download the PDF from the browser.

## Job descriptions and application answers

Paste or enter the job description manually. When installed as the Chrome extension, open the job posting and use **Link current page** to associate its URL with the description before generating a resume.

Enter or paste application questions one per line, then use **Generate Answers** to write answers using the resume's existing backend conversation. Review the generated answers and copy them into the application form manually. Contact details and sensitive fields must also be entered manually. The extension generates documents and answers; entering form values, uploading files, and submitting applications are manual steps.

## Required extension version

The backend requires Resume Builder **0.9.3 or newer** by default. Every extension API
request, including login and screenshot uploads, sends `X-Resume-Builder-Version`.
Older, missing, or invalid versions receive HTTP 426 with an update-required message.
Resume generation, answers, draft restoration/submission, profile settings, and screenshot
uploads require this header even when the client sends no extension origin. Shared dashboard
routes continue to support normal web requests.

Super admins can open **Extension** in BidTracker to save the latest version and an HTTP(S)
download URL. That version becomes the minimum immediately, including for existing sessions.
Outdated clients receive the release version and download URL in the HTTP 426 response. The
extension shows an update alert with **Download latest version** below it on login or the next
API request. The button opens the configured link in a new tab and preserves the login token.
Without a saved release, `RESUME_BUILDER_MIN_VERSION` remains the server's fallback minimum.

Deploy the `20261104000000_extension_release` database migration with the backend. Existing
extension installations need the build containing the download button installed once; older
builds can show only their existing text alert. Publish a link users can access before saving
the release settings.

To release a version, update `package.json`, the root package entries
in `package-lock.json`, and `src/renderer/public/manifest.json` together; the build checks that
the package and manifest versions match. Run `npm run build`, distribute `dist-web`, and reload
the extension in Chrome. Deploying the backend check is required to reject older installations.

## Submission screenshots

The Chrome extension keeps a **Submission screenshots** section below the profile tabs. After
generating an application, select it there and click **Take screenshot** while its confirmation
page is still open. The button is always in the same place and does not depend on a toast or
automatic submission detection. Saved status and upload errors appear in the section; retry with
the same button. Multiple applications remain selectable when generated in the same browser tab.

Recent applications and saved status are retained locally for eight days and restored when the
side panel is reopened. Uploaded images are available in BidTracker for eight days. Refresh the
workspace table and click **View screenshot** in the pinned **Screenshot** column beside **#**.
In the viewer, use **Right Arrow** for the next screenshot and **Left Arrow** for the previous one,
following the table's current filters and sort order and skipping applications without active
screenshots. **Escape** closes the viewer; **Download** saves the current PNG.
If the original tab was closed, reopen the confirmation page and use **Load last application** to
associate that page with the workspace's most recent application before taking its screenshot.
No screenshot can be recovered from a closed page unless it was already captured and uploaded.

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
