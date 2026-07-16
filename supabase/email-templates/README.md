# Dinner with Jesus — branded auth email templates

These replace Supabase's default plain-text/generic-styled auth emails. They cannot be installed by an automated process — Supabase has no API-less way to do this, and this repo's workflow deliberately never holds Supabase Dashboard/Management API credentials. **Steve (or whoever holds Dashboard access) must paste these in by hand.**

## How to install each one

1. Supabase Dashboard → the Dinner with Jesus project (`mvswwnonafjencqumxvv`) → **Authentication → Email Templates**.
2. Pick the template name listed below, switch it to source/HTML view, and replace the entire body with the matching file's contents here.
3. Save.
4. Send yourself a real test of that flow (sign up a throwaway address, request a password reset, etc.) and confirm the email renders as expected and the button actually works.

| Supabase template name | File | Notes |
|---|---|---|
| **Confirm signup** | `confirm-signup.html` | Uses `{{ .ConfirmationURL }}`. |
| **Reset Password** | `reset-password.html` | Uses `{{ .ConfirmationURL }}`. Only resolves to the branded "Create a New Password" screen if the redirect target is correct — see below. |
| **Change Email Address** | `change-email.html` | Uses `{{ .ConfirmationURL }}`. Supabase sends this same template to both the old and new address; the copy is written to make sense either way. |

## Not installed — confirmed unused by this app

- **Invite user** — the app never calls Supabase's admin invite API. Family/table invites work entirely through an in-app share message (a 6-character code, shared via `navigator.share` or clipboard from `OnboardingPage.jsx`/`TablePage.jsx`) — no Supabase email is ever sent for this. Nothing to install.
- **Magic Link** — not used anywhere in the client (`signInWithOtp` doesn't appear in the codebase). Auth is email + password only.
- **Reauthentication** — not used; no client code calls `reauthenticate()`.

If any of these three become real features later, branded templates should be written for them at that point — building them now for unused flows isn't worth the effort.

## Required Dashboard configuration (also cannot be done from this repo)

For the **Reset Password** email to land users on the actual "Create a New Password" screen instead of the app's normal sign-in/home screen, two things must both be true in **Authentication → URL Configuration**:

1. **Site URL** should be `https://flippingtables.ai` (or whatever the canonical production domain is).
2. **Redirect URLs** allow-list must include `https://flippingtables.ai/reset-password` (and the equivalent for any preview/staging domain in use). The app itself always requests `{current origin}/reset-password` as the redirect target (see `src/pages/AuthPage.jsx`) — Supabase will refuse or fall back to the default Site URL for any redirect target not on this allow-list, so if this isn't added, the link may still misbehave even with the correct email template installed.

Also worth checking while in this section: **Auth → Rate Limits** (confirm the email rate limit is reasonable for production, not left at a testing-only default) and **Auth → SMTP Settings** (confirm whether a custom SMTP provider is configured, or the project is still on Supabase's default/shared sender — fine for now given current volume, but worth knowing before wider launch).

## Logo asset used

All three templates reference `https://flippingtables.ai/icons/icon-512.png` — the app's existing PWA icon, already public (see `vercel.json`'s `/icons/(.*)` route). No new image asset was created; this repo's author has no image-generation capability. If a dedicated email-header lockup (different from the app icon) is wanted later, that's a design task for a human or an image-generation tool, not a code change.

## Design notes

Light warm-ivory outer background with a dark navy "card" (matching the app's own `--bg`/`--gold` palette) — this is a deliberate compromise: full-bleed dark backgrounds render inconsistently across email clients (especially Outlook desktop and some dark-mode auto-inversion), but a contained dark card on a light canvas is both reliable and unmistakably on-brand. Georgia is used as the heading font (a web-safe serif standing in for the app's Lora, which most email clients won't load) and the system sans-serif stack for body text. Every template includes visible brand text ("Dinner with Jesus") alongside the logo image, so the identity is clear even with images blocked — the default state in many inboxes on first open.
