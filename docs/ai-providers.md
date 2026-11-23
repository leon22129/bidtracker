# Gemini and Claude integration

Reviewed 2026-11-23. Configure **Account → AI generation** with a separate API key for each provider.
The workspace's owning admin pays for generation. Keys are encrypted with the existing server secret;
they never go to the browser or fall back to environment credentials.

## Endpoints and authentication

| Platform | `target_url` (POST) | Authentication |
| --- | --- | --- |
| Gemini Developer API | `https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse` | `x-goog-api-key` |
| Claude API | `https://api.anthropic.com/v1/messages` | `x-api-key`, `anthropic-version: 2023-06-01` |

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
| `claude-sonnet-5-5` (default) | 2.00 | 0.10 | 10.00 | 2.50 |
| `claude-haiku-5-5` | 0.10 | 0.01 | 0.50 | 0.125 |
| `claude-opus-5-5` | 4.00 | 0.20 | 20.00 | 5.00 |
| `claude-fable-5-2` | 8.00 | 0.20 | 40.00 | 10.00 |

Carbon and Argon change to $4 input / $0.20 cached / $20 output on 2026-12-01. The catalog and cost
estimates switch automatically at that UTC date. Haiku prompts above 100,000 tokens use $0.50 input /
$0.05 cached / $2.50 output / $0.625 cache writes, including cached tokens when selecting the tier.
Prices exclude taxes, tools, regional premiums, batch/priority discounts and free-tier allowances.
Sources: [Google pricing](https://aistudio.google.com/docs/pricing),
[Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing),
[Gemini models](https://aistudio.google.com/docs/models),
[Claude models](https://platform.claude.com/docs/en/models/overview).

## Provider behavior

- Gemini has a shared 1,048,576-token context window; this app caps each streaming response at 65,536
  tokens and does not use long decode. Claude's listed models have 1M context and 128K maximum output.
- Thinking counts toward output limits and costs. Gemini thought parts and Claude thinking blocks are
  excluded from returned text. Claude does not report a separate thinking-token count here.
- Gemini uses implicit caching. Claude marks reusable reference context with a five-minute cache
  breakpoint; writes are billed separately from ordinary input and cache hits. Discounts require
  qualifying prompt lengths and reuse; they are not guaranteed.
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
[Claude thinking](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking),
[Claude caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching),
[Claude streaming](https://platform.claude.com/docs/en/build-with-claude/streaming).

## Installation and checks

Apply `npm run prisma:deploy` from `backend`, regenerate Prisma, then build/restart the backend and
frontend. PostgreSQL and legacy SQLite migrations preserve existing keys, model selection and prompt.
On Windows, stop the local backend before regenerating Prisma if it holds the engine DLL open.

`npm run check:ai -- <admin-email-or-id>` checks the saved model's availability without generating
text. `npm run test:ai-settings` verifies migrations and authenticated settings using a disposable
PostgreSQL schema. Native provider request tests use recorded response shapes and mocked network
calls; live generation still requires a valid paid/account-enabled provider key.
