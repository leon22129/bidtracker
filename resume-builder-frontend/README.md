# Resume Builder

A browser app that tailors your resume to any job description using the OpenAI API and returns a formatted, downloadable PDF.

## Getting started

```bash
npm install
npm run dev
```

Create an AI Profile, paste a job description, generate the resume, and download the PDF from the browser.

## Job-page scanning and application answers

When installed as the Chrome extension, Resume Builder scans the active tab for JobPosting metadata and common job-description containers. If nothing reliable is found, paste or edit the job description manually.

The same scan collects visible application questions. Questions present during resume generation are sent with the resume request; later pages can be handled with **Scan Next Page** and the existing backend conversation. Review the generated answers, choose **Autofill Profile + Answers**, and verify the form before continuing. Contact and optional demographic fields use saved profile values rather than AI inference; veteran status uses the fixed non-veteran default. The extension never submits an application, and file uploads remain manual.

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
