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

## Profile generation and download settings

Open **Profiles**, select a profile, and save its options:

- **Generate cover letter** includes a cover letter with the next generated resume.
- **Download as a directory** puts the resume, cover letter, and optional job
  description in the same dated application folder. By default, the extension uses
  `Resumes` inside Chrome Downloads. Choose another folder or save a different
  Downloads subfolder in extension **Settings → Profile download locations**.
- **Include company name in directory name** adds the target company to the
  dated application directory, for example `2026-11-05_09-30-00 - Acme/Resume.pdf`.
  The PDF filenames stay `Resume.pdf` and `Cover Letter.pdf`, including when
  downloading without a directory.

These switches are saved per profile. Folder locations are saved separately on each
browser. Changing the location does not move existing files. Saving options retains
the assigned workspace and any existing automatic-download preference. Download
errors appear in the preview instead of reporting success or saving somewhere else.

The browser workflow check covers option persistence, generation after settings
changes, real resume and cover-letter PDF creation, native folder writes, Chrome
Downloads filenames, disabled options, and failed downloads.

## Required extension version

The backend requires the Resume Builder version in `resume-builder-frontend/package.json`
or newer. Every extension API request, including login and screenshot uploads, sends `X-Resume-Builder-Version`.
Older, missing, or invalid versions receive HTTP 426 with an update-required message.
Resume generation, answers, draft restoration/submission, profile settings, and screenshot
uploads require this header even when the client sends no extension origin. Shared dashboard
routes continue to support normal web requests.

Super admins can open **Extension** in BidTracker to view the required version and save an HTTP(S)
download URL. The required version is read-only and comes from the deployed backend build.
Outdated clients receive that version and download URL in the HTTP 426 response. The
extension shows an update alert with **Download latest version** below it on login or the next
API request. The button opens the configured link in a new tab and preserves the login token.
Previously saved version values and `RESUME_BUILDER_MIN_VERSION` are ignored; saved download links remain available.

Deploy the `20261104000000_extension_release` database migration with the backend. Existing
extension installations need the build containing the download button installed once; older
builds can show only their existing text alert. Make the matching extension download available
before deploying the backend that requires it.

To release a version, update `package.json`, the root package entries
in `package-lock.json`, and `src/renderer/public/manifest.json` together; the build checks that
the package and manifest versions match. Run `npm run build`, distribute `dist-web`, and reload
the extension in Chrome. Then rebuild and restart the backend to require that version; no manual
version entry in super admin is needed. Backend build, development startup, type-check, and test
commands generate their version metadata automatically. The Windows launcher rebuilds the backend
when the extension package or manifest changes. Compiled backend deployments include the version
and do not need the extension source files at runtime.

## Submission screenshots

Each profile tab has a **Submission screenshot** section. Generating a resume keeps the JD,
linked job page, and prepared documents available while you apply. After submitting successfully,
keep the confirmation page open, check the confirmation box, and click **Take screenshot & add
application**. Only after the screenshot and application are saved does that profile tab clear
the completed JD, page link, documents, and answers. A failed save keeps the work available for
retry. Other profile tabs and a new JD already entered for the next job are preserved.

Form answers are optional. The extension saves captured answers when possible and continues
adding the application and screenshot if form capture or answer syncing fails. Saved answers
are retained, and a successful save shows a brief notice when some answers could not be recorded.

Pending jobs are restored when the side panel is reopened. Completed jobs can be restored with
**Load Last Job**. Uploaded images are available in BidTracker for eight days. Refresh the
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
