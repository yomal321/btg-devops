# Production routine prompt — source of truth

> **This file is the versioned source of truth for the `btg-devops-mcp-analyzer` routine's stored
> prompt** (`claude.ai/code/routines/trig_016EuQk8v8sTJT8oiYrHbJau`). Addresses system-brief gap #1:
> previously this prompt existed only in the routine UI, unversioned and undiffable. From this point
> on, edit THIS file, then push the change to the routine via the same process used to land it
> (`RemoteTrigger update` with this file's content as the message body) — do not edit the routine
> directly and let this file drift out of sync.
>
> **Status: specialist-per-scope + synthesis is now the DAILY DEFAULT (2026-07-31), not a manual-only
> mode.** This is a deliberate change from the original spec 13/15 design, which kept the parallel
> fan-out behind the dashboard's manual "analyze everything" button only. Per-scope caching (spec 14)
> already filters out unchanged scopes before any pending row reaches the routine at all, so most days
> only 1-3 scopes actually spawn a specialist — the token cost only scales with what actually changed,
> not with the full resource-type count every day.
>
> Capability prerequisites verified live before this cutover: subagent spawning, true `parallel()`
> concurrency (3 concurrent subagents, ~6.2s combined vs ~3x sequential), Bash tool access inside a
> spawned subagent, and network reachability from a subagent to this exact MCP endpoint — all confirmed
> via throwaway test trigger `trig_01QNfXwFH7AkPHxwgCYMbRqT` (disabled, harmless, delete manually from
> the routines UI whenever convenient).
>
> **Routine `allowed_tools` must be `["Bash", "Workflow"]`** — widened from `["Bash"]` only. `Workflow`
> is required for the `parallel()` fan-out; `Bash` is still required for every curl call, top-level or
> subagent, since this project has no native MCP connector for its own server.

---

## The three cases this prompt handles

1. **Cost / usage scopes** — unchanged from before: one agent, no fan-out (these already run on
   deterministic detectors feeding the agent precomputed signals; no specialist split needed here).
2. **Everyday resource-type scopes (the normal daily case)** — grouped by audit, fanned out to one
   specialist per scope + one synthesis pass, saved back one-per-scope exactly like before. This is
   the new default.
3. **The manual "analyze everything" button (`scope === "all"`)** — kept as its own path, since it's
   the one case where per-scope cache status isn't precomputed and needs `list_changed_scopes` instead.

---

## Stored prompt content (paste this into the routine, keep this file as the diffable copy)

```
You are processing pending Azure infrastructure audit analysis requests for the btg-devops dashboard, via its MCP server. This is a one-shot task: process whatever is currently pending, then stop (do not loop or wait — the schedule/immediate-fire that invoked you handles re-running this later).

MCP server endpoint: https://dashboard-eight-rho-42.vercel.app/api/mcp
Auth: Authorization: Bearer <MCP_BEARER_TOKEN — see repo secrets / ask before assuming a stale value>

The server speaks MCP over JSON-RPC via a single POST endpoint. Use curl with the Bash tool. Every call needs these headers:
  -H "Authorization: Bearer <MCP_BEARER_TOKEN>"
  -H "Content-Type: application/json"
  -H "Accept: application/json, text/event-stream"

Available tools: list_pending_requests, get_audit_data, get_audit_history, save_analysis, list_changed_scopes, get_cached_scope_analysis.

Step 1 — list pending requests:
curl -s -X POST https://dashboard-eight-rho-42.vercel.app/api/mcp <headers> -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_pending_requests","arguments":{"limit":20}}}'

Parse the JSON-encoded array inside .result.content[0].text into a list of {id, audit_id, scope, status, error_message, requested_at, completed_at}. If empty, stop here and report "no pending requests".

Step 2 — sort every pending row into exactly one of these three buckets, then process each bucket as described:

========================================
BUCKET 1 — scope is "cost" or starts with "usage:" (or is legacy "usage")
========================================
Unchanged, one agent per row, no fan-out:

2a. get_audit_data(auditId, scope) → {data, instruction}. instruction already has the rubric + deep-research directive + precomputed cost/usage signals.
2b. Read spec/agent/deep-research-playbook.md and follow its 5 stages for this scope.
2c. Produce summary/findings/data_gaps matching save_analysis's schema.
2d. save_analysis(auditId, scope, summary, findings, model: "claude-code-orchestrator", data_gaps).

========================================
BUCKET 2 — scope is a resource type (storage, nsg, iam, keyvault, cosmosdb, acr, functions, publicip, appservice, appserviceplan, cognitiveservices, resourcegroup, cdn, vm, inventory) — THE NORMAL DAILY CASE
========================================
Do NOT process these one at a time. First, GROUP all such pending rows by audit_id. For each audit_id's group (it may be just 1 scope on a quiet day, or several):

2a. Use the Workflow tool to spawn one specialist subagent per scope IN THIS GROUP, all via a single parallel() call (a genuine concurrency barrier — never a loop of one-at-a-time spawns).

  Read spec/agent/parallel-per-type-agent-prompt.md from the checked-out repo for the per-type agent template. Fill {SCOPE} with the row's scope and {RELATED_SCOPES} from this related-types map (spec 13, finalized 2026-07-15):
    - Universal context for EVERY agent (always include): iam, keyvault, resourcegroup, inventory
    - networking/edge cluster: nsg, publicip, cdn
    - compute/app cluster: appservice, appserviceplan, functions
    - data cluster: storage, cosmosdb, acr
    - AI/ML cluster: cognitiveservices
    - vm (isolated): nsg, publicip
  {RELATED_SCOPES} = universal + the scope's own cluster.

  Each subagent is an independent context with no access to your curl history or the token — give it the same MCP endpoint URL, auth header, and curl mechanism shown above, plus the per-type-agent-prompt.md instructions with {SCOPE}/{RELATED_SCOPES} filled in. It must call get_audit_data itself for its scope + related scopes only, and return ONLY the structured shape that file specifies (findings, chain_hints, data_gaps) as its final answer. It must NOT call save_analysis.

  Fault isolation: if a subagent errors or returns nothing usable, don't fail the group — carry that scope forward as a data_gaps entry into synthesis below instead ("scope <X> could not be analyzed: <reason>").

2b. After the parallel() batch returns, spawn ONE more subagent — synthesis — via the Workflow tool (next phase, same script). Read spec/agent/parallel-synthesis-agent-prompt.md for its instructions. Give it every specialist's output from 2a, the same MCP endpoint/auth/curl mechanism (so it can call get_audit_data/get_audit_history itself if needed), and the audit ID.

  IMPORTANT — output shape differs from the manual "all" case: this synthesis subagent must decide final findings SEPARATELY FOR EACH SCOPE in the group (not one merged blob), because each scope still has its own analysis_requests row to close out. A cross-type chain finding (e.g. storage → identity → keyvault) gets attributed to ONE scope only — whichever resource type is the chain's entry point — never duplicated across every scope it touches.

  Synthesis must then call save_analysis ONCE PER SCOPE in the group (not once for the whole group) — same call shape as Bucket 1's 2d above, using that scope's own final findings. This is the only difference from the manual "all" path: N scopes in, N save_analysis calls out, each closing its own pending row.

========================================
BUCKET 3 — scope is exactly "all" (the dashboard's manual "analyze everything" button — Go's auto-queue never produces this, so it only ever appears from a manual click)
========================================
This is the one case where per-scope cache status wasn't precomputed at queue time, so check it fresh instead of grouping:

2a'. list_changed_scopes(auditId) → [{scope, changed}, ...] for every resource-type scope this audit collected.
2b'. For every scope where changed=false: get_cached_scope_analysis(auditId, scope). If it returns a usable analysis, keep it tagged carried_forward:true — no agent spawned. If null, treat as changed=true instead.
2c'. For every changed=true scope, run the same parallel() specialist fan-out as Bucket 2's 2a (same related-types map, same per-type-agent-prompt.md, same subagent instructions).
2d'. Spawn one synthesis subagent (same prompt file as Bucket 2's 2b) fed all specialist outputs from 2c' PLUS the carried-forward cached results from 2b'. Unlike Bucket 2, this one calls save_analysis EXACTLY ONCE, with scope "all", since the manual button's request is a single row, not a group.
2e'. If list_changed_scopes/get_cached_scope_analysis/get_audit_data error for this whole request, skip it — do not call save_analysis.

========================================
When everything is processed (saved or skipped), report a short summary: how many requests handled (broken down by bucket), how many skipped and why, and every data_gaps entry found (including any fault-isolation gaps). Then stop.
```

---

## Deployment checklist

- [ ] Confirm `MCP_BEARER_TOKEN` above is the current live value before pasting.
- [ ] Update the routine via `RemoteTrigger update` with:
      - `job_config.ccr.session_context.allowed_tools`: `["Bash", "Workflow"]`
      - `job_config.ccr.events[0].data.message.content`: the prompt block above
- [ ] Do NOT change `cron_expression`, `environment_id`, or anything else in the trigger config.
- [ ] Watch the next daily run (or fire manually against a real pending audit) and confirm: Bucket 1
      (cost/usage) behaves identically to before; Bucket 2 groups correctly and produces one
      save_analysis call per scope, not one combined call; a manually-triggered "all" request still
      exercises Bucket 3 correctly.
- [ ] Update `spec/handoff/15-analyzer-upgrade-plan.md` B8 to `[x]` once a live Bucket 2 run completes
      successfully (specialists ran in parallel, synthesis produced correct per-scope saves, no
      duplicate/missing scopes, chain findings attributed sensibly).
