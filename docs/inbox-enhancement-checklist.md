# Inbox AI Assistant Enhancement — Checklist

> Living tracker for the 4-phase Inbox AI Assistant build.
> Check items off as each sub-feature is implemented and verified.

---

## KB Fixes (Pre-requisite) — All Done

- [x] Fix 1: Auto-synced badge on list cards checks `source: 'onboarding'` entries (not total count)
- [x] Fix 2: Form-sourced entries read-only in KB detail with "Edit in form" hover
- [x] Fix 3: Lock icon replaced with Pencil icon on form-sourced hover button
- [x] Fix 4: `isFirstPublish` renamed to `isOnboarding` across OnboardingView (15 occurrences)
- [x] Fix 5: Auto-sync badge pulses during recompose (indigo ring + spinning sparkles + "Syncing to AI..." text)
- [x] Fix 6: FAQ changes already sync via `triggerRecompose` (verified — no fix needed)
- [x] Fix 7: "Add manual entry" renamed to "Add custom entry" in all locations

---

## Phase A — Tab Layout + Inquiry Detection

- [x] A1: Right pane split into "Details" tab and "Assistant" tab
- [x] A2: "Details" tab contains SLA + Booking + Ticket Details + Host info (compact)
- [x] A3: "Assistant" tab is default-active when ticket loads
- [x] A4: Inquiry detector parses guest messages into discrete inquiry objects `{ type, detail, confidence }`
- [x] A5: Conversation Summary card with numbered inquiry bullets
- [x] A6: 4 new mock tickets added (Wi-Fi, Late Checkout, Noise, Multi-topic)
- [x] A7: "Analyzing..." skeleton on ticket switch (500ms delay)

## Phase B — Context Aggregator

- [x] B1: Per-inquiry KB relevance scoring (reuses existing engine via InquiryDetector.ts)
- [x] B2: Synthesized fact list per inquiry with full KB content display
- [x] B3: Source chips with KB entry names (Auto-synced / Custom / Seed data, clickable deep-links)
- [x] B4: Internal entries visually distinguished (amber accent + "Agent-only" badge)
- [x] B5: Raw score badges ("42pt") removed — replaced with plain match reason text

## Phase C — Smart Reply Composer

- [x] C1: Per-inquiry decision cards with Yes / No / Custom toggles
- [x] C2: Optional agent note per decision card (textarea for Custom)
- [x] C3: "Compose Message" button assembles multi-paragraph reply
- [x] C4: Reply uses host tone + guest name + agent decisions + KB data
- [x] C5: Composed reply populates textarea for agent review before send
- [x] C6: Old "AI Draft" stub replaced with "AI Suggest" that opens Assistant tab

## Phase D — Polish & Edge Cases

- [x] D1: "Ask AI" free-text input below assistant panel (KB-grounded search)
- [x] D2: Confidence badges per inquiry (High / Medium / Low)
- [x] D3: Tone preview label on compose ("Using Delta Luxe's Professional & High-End tone")
- [x] D4: Source attribution tags shown after reply is composed (green "Sources Referenced" section)
- [x] D5: Empty state when no relevant KB entries found (with "Add entries in KB" link)
- [x] D6: Auto-trigger animation when switching tickets (analyzing skeleton + fade-in)

---

## Phase E — Analytics & Reporting Dashboard

- [x] E1: New `/analytics` route with `AnalyticsView.tsx` + sidebar nav item (BarChart3 icon, "A" shortcut)
- [x] E2: KPI summary cards — Open Tickets, Avg Response, SLA Compliance, AI Resolution Rate (with trend indicators)
- [x] E3: Ticket Volume area chart (14-day default, 7d / 14d / 30d toggle) with total / resolved / AI-auto overlays
- [x] E4: Channel Distribution donut chart (Airbnb, Booking.com, Phone, WhatsApp, Email)
- [x] E5: Inquiry Type horizontal bar chart (matches InquiryDetector categories)
- [x] E6: Resolution Breakdown funnel — AI auto-resolved / Agent resolved / Escalated / Open (progress bars + insight card)
- [x] E7: Per-Client Performance cards — per-host metrics (tickets, resolved, avg response, SLA %, AI resolution %) with trend badges
- [x] E8: Recent Activity feed — live timeline of resolves, AI actions, task dispatches, KB updates, escalations
- [x] E9: Live Operations Snapshot — real-time counts from AppContext (open tickets, pending tasks, dispatched, KB entries)
- [x] E10: Keyboard shortcut "A" registered + added to shortcuts modal

---

## Phase F — Real AI Integration (OpenRouter)

- [x] F1: AI touchpoint audit — identified 5 touchpoints, 2 upgraded to real API (Compose Reply, Ask AI), 3 kept as-is (Inquiry Detection, Doc Extract KB, Doc Extract Onboarding)
- [x] F2: `/src/app/ai/prompts.ts` — Separate file for all LLM prompts with `{{placeholder}}` interpolation, easily editable
- [x] F3: `/src/app/ai/openrouter.ts` — OpenRouter API client (`callOpenRouter`) with full debug logging to debug store
- [x] F4: `/src/app/ai/debug-store.ts` — In-memory debug log store (50-entry cap) with subscribe/unsubscribe pattern
- [x] F5: `/src/app/components/shared/AIDebugPanel.tsx` — Slide-out debug console showing system prompt, user prompt, AI response, HTTP status, latency, token usage per call (feature-flagged by devMode)
- [x] F6: API key + model selector in Settings > My Preferences > AI Configuration (localStorage-persisted, show/hide toggle)
- [x] F7: `AssistantPanel.tsx` Compose Reply — real OpenRouter call when API key set, template fallback when not
- [x] F8: `AssistantPanel.tsx` Ask AI — real OpenRouter call when API key set, keyword fallback when not
- [x] F9: "Live AI" / "Template" badge in Assistant panel header
- [x] F10: "Debug" button in Inbox header bar (visible only when devMode is on)
- [x] F11: AppContext extended with `openRouterApiKey`, `aiModel` (both localStorage-persisted)
- [x] F12: Graceful error handling — API errors fall back to template logic + toast notification

---

## New Mock Tickets

| ID | Guest | Property | Room | Inquiry Type | Host |
|----|-------|----------|------|-------------|------|
| t-103 | Sarah Chen | Villa Azure | Entire Villa | Wi-Fi connectivity | Delta Luxe |
| t-104 | Marcus Weber | Shinjuku Lofts | Room 301 | Late checkout request | Urban Stays |
| t-105 | Yuki Tanaka | Shinjuku Lofts | Room 202 | Noise complaint | Urban Stays |
| t-106 | James Park | Villa Azure | Entire Villa | Multi-topic (directions + Wi-Fi) | Delta Luxe |

---

## Integration Points Verified

- [x] Auto-synced KB entries surface correctly in assistant panel
- [x] `sectionId` enables "Edit in form" deep-links from source chips
- [x] Room-scoped entries precision-match when ticket specifies a room
- [x] `internal` flag drives visual hierarchy (agent-only entries highlighted)
- [x] Custom entries equally discoverable alongside auto-synced

---

## File Manifest

| File | Purpose |
|------|---------|
| `/src/app/components/views/InboxView.tsx` | Main inbox view with tabbed right pane |
| `/src/app/components/inbox/AssistantPanel.tsx` | AI Assistant tab (inquiry cards, KB facts, decisions, compose, Ask AI) |
| `/src/app/components/inbox/InquiryDetector.ts` | Pure functions: pattern matching, KB scoring, fact synthesis, reply composition |
| `/src/app/data/mock-data.ts` | 6 mock tickets (2 original + 4 new) |
| `/src/app/components/views/AnalyticsView.tsx` | Analytics dashboard with KPIs, charts (recharts), per-host metrics, activity feed |
| `/src/app/ai/prompts.ts` | All LLM prompts (editable templates with `{{placeholder}}` interpolation) |
| `/src/app/ai/openrouter.ts` | OpenRouter API client with debug logging |
| `/src/app/ai/debug-store.ts` | In-memory AI debug log store (subscribe pattern) |
| `/src/app/components/shared/AIDebugPanel.tsx` | Slide-out AI debug console (devMode feature flag) |
| `/docs/inbox-enhancement-checklist.md` | This file |