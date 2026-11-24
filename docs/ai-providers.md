# AI provider integration

Reviewed 2026-11-24. Configure **Account → AI generation** with a default model and API key.
Profiles inherit their admin's current account settings unless an admin saves a model and separate key
in **Dashboard → a profile → AI settings → Set profile override**. Generation uses the effective settings
for resumes, cover letters, eligibility checks, and application answers, including requests from bidders.
Account changes affect inherited profiles only. **Use account defaults** clears the profile override and
its keys. Model and key always come from the same configuration. Its creating admin and super admins may
manage a profile's settings; bidders and bidder managers cannot access them. Keys are encrypted with the
existing server secret and never returned to the browser. Environment keys are never used.

## Endpoints and authentication

| Platform | `target_url` (POST) | Authentication |
| --- | --- | --- |
| OpenAI API | `https://api.openai.com/v1/responses` | `Authorization: Bearer <API key>` |
| Gemini Developer API | `https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse` | `x-goog-api-key` |
| Claude API | `https://api.anthropic.com/v1/messages` | SDK sends `Authorization: Bearer <API key>`, `anthropic-version: 2023-06-01` |

Gemini's JSON equivalent is `.../models/{model}:generateContent`. These integrations use the direct
provider APIs, rather than Vertex AI or Bedrock credentials. Endpoint URLs are fixed by the server.
See [Google's REST examples](https://aistudio.google.com/docs/text-generation?generate-content=true)
and [Anthropic's API overview](https://platform.claude.com/docs/en/api/overview).

## Model catalog and prices

USD per million text tokens, standard paid processing:

| Model ID | Input | Cached input | Output | Cache write (5 min) |
| --- | ---: | ---: | ---: | ---: |
| `gemini-4-hydrogen` (default) | 1.50 | 0.075 | 7.50 | — |
| `gemini-4-carbon` | 2.00 | 0.10 | 10.00 | — |
| `gemini-4-neon` | 3.00 | 0.15 | 15.00 | — |
| `gemini-4-argon` | 2.00 | 0.10 | 10.00 | — |
| `gemini-3.8-flash` | 0.75 | 0.075 | 3.75 | — |
| `claude-sonnet-5-5` (default) | 2.00 | 0.10 | 10.00 | 2.50 |
| `claude-haiku-5-5` | 0.10 | 0.01 | 0.50 | 0.125 |
| `claude-opus-5-5` | 4.00 | 0.20 | 20.00 | 5.00 |
| `claude-fable-5-2` | 8.00 | 0.20 | 40.00 | 10.00 |
| `claude-sonnet-5` | 2.00 | 0.20 | 10.00 | 2.50 |
| `claude-sonnet-4-6` | 3.00 | 0.30 | 15.00 | 3.75 |
| `claude-haiku-4-5-20251001` | 1.00 | 0.10 | 5.00 | 1.25 |

Carbon and Argon change to $4 input / $0.20 cached / $20 output on 2026-12-01. Gemini 3.8 Flash changes
to $1.50 input / $0.15 cached / $7.50 output on 2027-01-01. The catalog and cost estimates switch
automatically at those UTC dates. Haiku 5.5 prompts above 100,000 tokens use $0.50 input /
$0.05 cached / $2.50 output / $0.625 cache writes, including cached tokens when selecting the tier.
Prices exclude taxes, tools, regional premiums, batch/priority discounts and free-tier allowances.
Sources: [Google pricing](https://aistudio.google.com/docs/pricing),
[Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing),
[Gemini models](https://aistudio.google.com/docs/models),
[Claude models](https://platform.claude.com/docs/en/models/overview).

The OpenAI selector also includes these exact snapshots alongside their model family aliases:

| Model ID | Input | Cached input | Output |
| --- | ---: | ---: | ---: |
| `gpt-5.5-2026-04-23` | 5.00 | 0.50 | 30.00 |
| `gpt-5.1-2025-11-13` | 1.25 | 0.125 | 10.00 |
| `gpt-5-mini-2025-08-07` | 0.25 | 0.025 | 2.00 |

Snapshot IDs are saved and sent to OpenAI exactly as selected. GPT-5.1 and GPT-5 mini retain their
provider's deprecated label. GPT-5.5 prompts above 272,000 input tokens use 2× input/cached rates and
1.5× output rates. Sources: [GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5),
[GPT-5.1](https://developers.openai.com/api/docs/models/gpt-5.1),
[GPT-5 mini](https://developers.openai.com/api/docs/models/gpt-5-mini).

## Provider behavior

- Resume and cover-letter content share one generation request. A disabled cover-letter setting
  instructs the model to return an empty letter; unwanted letter text is also excluded from saved results.
  The backend validates resume field types, career entries and requested cover letters before preparing
  documents. Local question context is created with the validated resume in one write, after generation
  succeeds. Rejected jobs and provider failures do not create empty conversation records.
- Job descriptions with company/title headers skip the separate identity-extraction call. When that
  call is needed, its token usage is included in the application total alongside eligibility and resume
  generation. Provider request logs include duration and token counts for measuring actual latency/cost.
- The extension loads PDF rendering and template code on the first download, keeping it out of startup
  and settings screens. Resume and cover-letter downloads use the same candidate details from the
  generated resume, including during automatic downloads.
- OpenAI generation uses the official `openai` package and `client.responses.create()`. The SDK also
  handles legacy conversation history and retention cleanup. Version 6 is pinned for the backend's
  Node 20 runtime. SDK retries are disabled so the application's bounded retry policy applies once.
  Raw SDK responses retain the existing stream handling, request IDs and usage accounting. New sessions
  still use local reference context with `store: false`; legacy provider conversations remain supported.
  Installing the SDK does not change token prices or create a billing discount.
- Gemini has a shared 1,048,576-token context window; this app caps each streaming response at 65,536
  tokens and does not use long decode. Claude's listed models have 1M context and 128K maximum output,
  except Haiku 4.5, which has 200K context and 64K maximum output.
- Haiku 4.5 uses extended thinking with budgets of 1,024 / 4,096 / 8,192 tokens for low / medium / high
  effort, capped at half the output limit to leave room for the answer. Thinking is disabled when the
  available budget is below the API's 1,024-token minimum. Other listed Claude models use adaptive
  thinking. See [extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking).
- Thinking counts toward output limits and costs. Gemini thought parts and Claude thinking blocks are
  excluded from returned text. Claude does not report a separate thinking-token count here.
- Gemini uses implicit caching. Claude marks reusable reference context with a five-minute cache
  breakpoint; writes are billed separately from ordinary input and cache hits. Discounts require
  qualifying prompt lengths and reuse; they are not guaranteed.
- Claude generation uses the official `@anthropic-ai/sdk`. Application-question follow-ups use its
  message-thread helper with `message-threads-2026-08-12`: the first request creates a thread, and later
  requests send the latest response ID and new questions. Top-level prompt caching is enabled on each
  turn. IDs reduce repeated uploads; cached input tokens produce billing savings, and SDK usage fields
  continue to report cache reads and writes separately. Existing saved answers still avoid repeat API calls.
- Threads are isolated by application, API key, endpoint, model, candidate facts, reference material,
  instructions and thinking configuration. Concurrent turns are serialized. The SDK replays its local
  history if a remote thread expires and can fall back to ordinary cached messages if threads are
  unsupported. Refused, interrupted or exhausted turns are discarded before another generation.
- Thread history stays in process memory, with a five-minute idle lifetime, at most eight successful
  turns per thread and a 256,000-character history limit. The cache prunes to 64 idle/active entries
  when possible without evicting active work. After eviction or server restart, a new thread starts
  from the saved resume/job context and current question. No database migration is needed for threads.
- Gemini free-tier content can be used for product improvement; use a paid project for candidate data.
  Claude API credits are separate from a chat subscription. API billing, model access, region and
  rate limits must be enabled for the saved account.
- Requests carry local context and never send OpenAI conversation IDs to the new providers.
  No tools are enabled. Output is parsed with the workflow's existing JSON validation.
- HTTP rate limits and transient failures use bounded retries and honor `Retry-After`. Interrupted
  streams are retried, which can incur another charge. Output exhaustion gets one larger-budget retry;
  refusals, safety blocks, authentication failures and other incomplete endings are not accepted as
  successful documents. Content logging stays off by default and credentials are redacted.

References: [Gemini thinking and limits](https://aistudio.google.com/docs/thinking?generate-content=true),
[OpenAI SDK](https://developers.openai.com/api/docs/libraries),
[Claude thinking](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking),
[Claude caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching),
[Claude message threads](https://platform.claude.com/docs/en/build-with-claude/message-threads),
[Anthropic TypeScript SDK](https://platform.claude.com/docs/en/api/sdks/typescript),
[Claude streaming](https://platform.claude.com/docs/en/build-with-claude/streaming).

## Installation and checks

Apply `npm run prisma:deploy` from `backend`, regenerate Prisma, then build/restart the backend and
frontend. PostgreSQL and legacy SQLite migrations preserve existing keys, model selection and prompt.
The `20261123010000_profile_ai_settings` migration creates empty override storage, leaving account
settings intact. Existing and new profiles use account defaults until explicitly customized. Override
keys bind encryption to the profile and provider. Reassigning a profile to another bidder does not
change its override or owning admin's defaults. Account-level base resume prompts remain on Account.
On Windows, stop the local backend before regenerating Prisma if it holds the engine DLL open.

`npm run check:ai -- <workspace-id>` checks the profile's effective model availability without generating
text. `npm run test:ai-settings` verifies migrations and authenticated settings using a disposable
PostgreSQL schema. Native provider request tests use recorded response shapes and mocked network
calls; live generation still requires a valid paid/account-enabled provider key.
