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
