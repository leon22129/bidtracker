# Application capture verification

Checked the supplied public application links on 2026-11-03 using an isolated
browser profile. No applications were submitted and no accounts were created.

| Portal / posting | Findings and verification |
| --- | --- |
| Paylocity / Spatial Front, 4571186 | Reproduced blank country despite a visible selection, selected text leaking into question labels, and a referral option used as the question. Verified corrected extraction on the public application page. |
| Paylocity / TriVista, 4609216 | Same failures and fixes verified on this application's public first step. Later steps requiring personal information were not submitted. |
| Lever / Mom's Meals, ad595273-6929-4237-ab8e-e341e47d6cd2 | Reproduced skipped resume input, required markers in questions, and a placeholder saved as an answer. Verified corrected public-page extraction. Regression fixtures also check selected option labels without explanatory paragraphs. |
| Workable / Coretek, 81A804DAD6 | The application form loads asynchronously. Verified extraction after it appeared, with clean question/file labels. Regression fixtures cover uploaded filenames and the displayed telephone country code. |
| Rippling / Root, eb244920-c537-4fdc-a01c-0fc811a35630 | Reproduced skipped resume/cover-letter inputs and a country-code field labelled Search. Verified public-page field discovery; fixtures cover filenames, composite selections and country-code labels. |
| iCIMS / MRO, 1628 | Apply redirects into an embedded login flow. Full authenticated application steps remain unverified; existing browser tests cover frame capture and login exclusion. |
| Oracle / Claritev, 443 | Apply opens an email authentication entry screen. Later application questions remain unverified without candidate access. |
| UKG / Boise Cascade, ceab8df1-16ee-4dcf-988f-fec30679c78b | The supplied posting reports that the opportunity is unavailable. Its application could not be verified. |

The reader also supports hidden native selects with visible Select2, Chosen or
Kendo dropdown replacements. This is covered by a local browser fixture, not a
claim of verification on the inaccessible iCIMS, Oracle or UKG application steps.

Run `npm run test:form-capture` in `resume-builder-frontend` for the browser and
capture-storage regressions. Reduced portal markup lives in
`resume-builder-frontend/tests/fixtures/portal-fields.cjs`.

After rebuilding, reload the extension, refresh the application page, and use
**Load Last Job** to arm the intended draft. Previously missing answers need a new
observation of the application form; the reader does not reconstruct past answers.

Ashby submission capture was checked on 2026-11-04 against the public Spruce
posting `c06e4344-c7b0-4c1b-beb8-a9646594ff7c`. The application form loaded and its
visible fields were captured. No real application was submitted. Simulating a
same-document route change reproduced `This form step could not be captured.`:
Chrome retained the sending document's earlier URL while the form reader reported
the updated path. URL validation now accepts sanitized paths on the sending
frame's origin while retaining the tab, session and token checks.

The form-capture suite also loads the real extension into an isolated Chrome
profile and verifies `pushState`, `replaceState`, final answers, confirmation and
screenshot submission against local fixtures. The workflow browser test covers
recovery from an already stored capture error and the missing-answers warning.
Form answers are optional: the extension attempts to sync each recorded step,
but validation errors, network failures, or unavailable recorders do not block
the screenshot and application save. Previously saved answers are retained, and
one rejected step does not prevent other steps from syncing. Failed steps remain
available for retry until the application is successfully added.

The ADP-reported `Invalid application form capture` error originates in the API's
form-step validation. Previously, that failed sync prevented the extension from
reaching the separate screenshot/submission endpoint. Regression tests now cover
that exact API error during submission, including a restored pending job, partial
form data, and no form data. The workflow browser fixture verifies the successful
save and non-blocking warning; the user's authenticated ADP form was not inspected.

For an application already affected by this error, reload the rebuilt extension,
keep the confirmation page open, use **Load Last Job**, and retry **Take screenshot
& add application**. The old capture error becomes a warning instead of blocking
the screenshot. Answers rejected before the update cannot be reconstructed once
the form is gone; previously recorded answers are retained.
