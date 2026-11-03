# Melon Prompt Studio

A separate superadmin tool for building and testing Melon's prompt chains. This
repository and Vercel project are independent of HelloWorld_GenAI and Admin_GenAI;
they share the existing Melon Supabase database and Google sign-in provider.

## Features

- Create chains from scratch or use an editable image → funny angle → five captions
  template. Update names/descriptions and delete chain definitions.
- Create, edit and delete steps. Move a step up/down to any position. Each chain
  supports 1–5 steps for generation, with zero steps allowed while being built.
- Configure an enabled Gemini model, system instructions, user prompt template,
  temperature, text/image input, text/JSON output, and 64–2048 output tokens.
- Use `{{prompt}}` for the user's caption direction and `{{previous_response}}`
  for the preceding step's exact visible output. Substitution is single-pass.
- Upload PNG/JPEG/WebP source images up to 3 MB and generate captions through the
  selected chain. Images are attached only to image-input steps. Text/JSON output
  passes forward in order; final JSON arrays of strings display as caption cards.
- Browse generated media for one chain or every chain. Inspect real model outputs,
  submitted prompts, token counts (if supplied), processing times and failures.
- Switch among light, dark and system-default themes. Choice persists locally;
  system mode follows the operating system using CSS media queries.

“Generated media” in this caption app means AI-generated caption text paired with
an optional source image. The source image is uploaded, not synthesized by Gemini.
Studio runs are private experiments and do not create Melon feed posts. New chains
start disabled with weight 0 in the shared automatic mix. Existing chains show a
warning when active in Melon's mix: editing their shared prompts/models/order also
changes future Melon runs. Studio-specific input/output/token controls govern
Studio runs; the current Melon app keeps its original execution behavior.

## Setup

1. Use the existing Melon Supabase project with Admin_GenAI migrations
   `001-admin.sql`, `004-generation-admin.sql`, `005-connect-generation-pipeline.sql`
   and `006-admin-reference-details.sql` already applied.
2. Run this repository's `supabase/001-prompt-studio.sql` as database owner in that
   project's SQL Editor. **Keep RLS enabled.** It is idempotent and adds columns,
   guarded RPCs, private run metadata and the private `prompt-studio-assets` bucket.
3. Set the variables in `.env.example` using `.env.local` locally and Vercel's
   environment settings in production. Keep `.env.local` untracked. The app uses
   the public anon/publishable key with the signed-in user's session. It never
   requires a service-role key. Gemini credentials remain server-only.
4. In Supabase Authentication → URL Configuration → Redirect URLs, retain existing
   Melon/Admin entries and add the new production `/auth/callback`, commit-specific
   Vercel wildcard `/auth/callback`, and `http://localhost:3004/auth/callback` if
   developing locally. Google Cloud's authorized callback remains the shared
   Supabase `/auth/v1/callback`; it does not need a new OAuth client.
5. Sign in with an existing verified Google user whose profile has
   `is_superadmin = true`. Ordinary users and password-only sessions are denied.
   The existing signup allowlist hook still controls new account creation.

```sh
npm ci
npm run dev
npm test
npm run lint
npm run build
```

## Safety and consistency

Every data read, mutation and run RPC verifies the live Google superadmin flag.
Private tables revoke direct anonymous/authenticated browser grants; storage uses
restrictive policies so legacy broad policies cannot expose or replace Studio
uploads. Signed image previews expire after five minutes and bypass public image
optimization caches. No API keys are stored in provider/model records or prompts.
Only the fixed Google Gemini endpoint receives the server's Gemini key.

Edits serialize on the chain row and require the version shown in the editor.
Stale tabs cannot overwrite newer changes. Step reorder accepts every current step
exactly once and uses collision-free temporary positions within one transaction.
Active runs block edits/deletion; operations over 15 minutes old are marked failed
when an edit or another run starts. Provider execution has a 90-second overall
budget, per-call timeouts and one bounded retry for transient failures. Vercel
functions allow 120 seconds. Unsupported models/providers cannot execute.

Each request snapshots its steps before generation. Deleting a step/chain detaches
foreign keys while retaining run outputs, response text, model references and
instruction snapshots. Chain names are retained for Studio runs even after a
chain is deleted. Curated examples lose only the deleted chain link. Images with
recorded runs cannot be removed through storage cleanup. Token counts/timing for
old records remain unknown. Hidden thought parts are never stored or displayed.

## Validation

`npm test` covers pipeline sequencing, image/text handoff, exact submitted prompts,
JSON validation, truncation, retries, model restrictions, token validation,
placeholder safety, reordering boundaries, ID/revision validation, and file types.

Run `tests/studio-access.sql` only against a disposable database with Melon's test
fixture/schema and the migration installed. It rolls back and checks chain/step
CRUD, ordering, stale edits, cross-chain IDs, active-run protection, saved outputs,
source-image privacy, preserved deletion history, role revocation and denial of
anonymous/non-admin/password-only sessions. Never run test fixtures on production.
