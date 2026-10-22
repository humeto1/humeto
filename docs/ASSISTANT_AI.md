# Humeto Assistant AI

The server uses OpenAI Responses API with structured task intents. The only allowed model is `gpt-5.4-mini`, pinned in code; model environment overrides cannot select another model. No automatic model fallback is enabled.

Set `HUMETO_AGENT_PROVIDER=openai` and private `CHATGPT_HUMETO_API` (or legacy `OPENAI_API_KEY`). Restart after environment changes. These variables must never be public or committed. Vercel needs its own environment configuration and redeployment.

Requests include the message, up to eight history entries and up to 100 authorized task summaries. Responses are schema validated. Task mutations remain permission checked and require Apply. Explicit project names are matched in the current workspace, with a preview before creating a missing project. This integration interprets task commands; it does not enable arbitrary CRM operations, external messaging or form submission.

Local mode remains available with `HUMETO_AGENT_PROVIDER=local`. Network and authentication failures are reported without silently changing providers or applying actions.

The provider's shared daily promotional allowance is not an app-enforced token budget. Only the eligible selected model is used, but organization usage from other apps can consume that allowance.

## Verification, 2026-10-23

Build passed. Initial live request returned HTTP 401 Unauthorized for the saved key; successful live operation is pending an active replacement key. No real tasks were changed during the connection check.
