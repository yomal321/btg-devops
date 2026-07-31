# Production routine prompt — source of truth

> **This file is the versioned source of truth for the `btg-devops-mcp-analyzer` routine's stored
> prompt** (`claude.ai/code/routines/trig_016EuQk8v8sTJT8oiYrHbJau`). Addresses system-brief gap #1:
> previously this prompt existed only in the routine UI, unversioned and undiffable. From this point
> on, edit THIS file, then push the change to the routine via the same process used to land it
> (`RemoteTrigger update` with this file's content as the message body) — do not edit the routine
> directly and let this file drift out of sync.
>
> **Status: Mode B (parallel fan-out) added 2026-07-31, closing spec 15 task B8.** Mode A
> (single-scope/cost/usage) is unchanged from what was already live. Capability prerequisites verified
> live before this cutover: subagent spawning, true `parallel()` concurrency (3 concurrent subagents,
> ~6.2s combined vs ~3x sequential), Bash tool access inside a spawned subagent, and network
> reachability from a subagent to this exact MCP endpoint — all confirmed via throwaway test trigger
> `trig_01QNfXwFH7AkPHxwgCYMbRqT` (disabled, harmless, can be deleted manually from the routines UI).
>
> **Routine `allowed_tools` must be `["Bash", "Workflow"]`** — widened from `["Bash"]` only. `Workflow`
> is required for the Mode B `parallel()` fan-out; `Bash` is still required both for the top-level
> agent's existing curl-based MCP calls (Mode A, and Mode B's own `list_changed_scopes`/
> `get_cached_scope_analysis` calls) and for every spawned subagent's own curl calls, since this
> project has no native MCP connector for its own server — every tool call, top-level or subagent, is
> `curl` through Bash against the JSON-RPC endpoint below.

---

## Stored prompt content (paste this into the routine, keep this file as the diffable copy)

```
You are processing pending Azure infrastructure audit analysis requests for the btg-devops dashboard, via its MCP server. This is a one-shot task: process whatever is currently pending, then stop (do not loop or wait — the schedule/immediate-fire that invoked you handles re-running this later).

EVERY request, regardless of scope, now always follows the full 5-stage deep-research process — there is no separate quick/one-shot mode anymore. Do not skip the playbook for a "small" scope like a single resource type; the same rigor applies everywhere.

MCP server endpoint: https://dashboard-eight-rho-42.vercel.app/api/mcp
Auth: Authorization: Bearer <MCP_BEARER_TOKEN — see repo secrets / ask before assuming a stale value>

The server speaks MCP over JSON-RPC via a single POST endpoint. Use curl with the Bash tool. Every call needs these headers:
  -H "Authorization: Bearer <MCP_BEARER_TOKEN>"
  -H "Content-Type: application/json"
  -H "Accept: application/json, text/event-stream"

Available tools on this server: list_pending_requests, get_audit_data, get_audit_history, save_analysis, list_changed_scopes, get_cached_scope_analysis.

Step 1 — list pending requests:
curl -s -X POST https://dashboard-eight-rho-42.vercel.app/api/mcp <headers> -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_pending_requests","arguments":{"limit":20}}}'

The response is JSON like {"result":{"content":[{"type":"text","text":"[...]"}]},"jsonrpc":"2.0","id":1} — the actual array of pending requests is JSON-encoded as a STRING inside .result.content[0].text; parse that string as JSON to get an array of objects shaped like {id, audit_id, scope, status, error_message, requested_at, completed_at}.

If the array is empty, stop here and report "no pending requests" — nothing else to do.

Step 2 — for EACH pending request, in turn, branch on scope:

========================================
MODE A — scope is NOT "all" (a single resource type, "cost", or "usage:<type>")
========================================
This is unchanged from before. Follow it exactly as already specified:

2a. Fetch its data:
curl -s -X POST https://dashboard-eight-rho-42.vercel.app/api/mcp <headers> -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_audit_data","arguments":{"auditId":"<audit_id>","scope":"<scope>"}}}'

This returns (JSON-encoded as a string inside .result.content[0].text) an object {data: <Azure resource JSON scoped to this request>, instruction: "<what to analyze for>"}. The instruction text already embeds a severity rubric, the deep-research directive (pointing at the playbook), and, for a single resource-type scope, a best-practice checklist. If get_audit_data returns an error (isError:true), skip this request and move to the next one — do not call save_analysis for it.

2b. Read the file spec/agent/deep-research-playbook.md from the checked-out repo (repo root) with `cat` and follow its 5 stages exactly, for THIS request's scope: (1) build a map of environments/regions/application groupings/spend before judging anything — call get_audit_data AGAIN with different scopes as needed for context; (2) correlate configuration x cost x usage per significant resource; (3) chain low-severity facts into real attack paths, reported as ONE finding with finding_type "chain"; (4) judge severity against the environment map and get_audit_history's trend data; (5) actively try to refute every Critical, then keep only a short list of well-evidenced findings. Record data_gaps for anything needed but unverifiable.

2c. Produce summary/findings/data_gaps in the shape the instruction and save_analysis's schema require (severity, category, resource_type, resource_name, resource_group?, child_resource_name?, affected_resources?, cost_impact_usd?/cost_impact_note?, issue, evidence, recommendation_steps?, fix_effort?, finding_type?).

2d. Save the result:
curl -s -X POST https://dashboard-eight-rho-42.vercel.app/api/mcp <headers> -d @payload.json
where payload.json (write with a heredoc, don't inline in -d) is:
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"save_analysis","arguments":{"auditId":"<audit_id>","scope":"<scope>","summary":"<summary>","findings":[<findings>],"model":"claude-code-orchestrator","data_gaps":[<if any>]}}}

========================================
MODE B — scope IS "all" (spec 13/15, Phase B — the parallel fan-out)
========================================
Do NOT run the single-agent 5-stage process yourself for an "all" request. Instead:

2a'. Call list_changed_scopes:
curl -s -X POST https://dashboard-eight-rho-42.vercel.app/api/mcp <headers> -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"list_changed_scopes","arguments":{"auditId":"<audit_id>"}}}'
This returns [{scope, changed}, ...] for every resource-type scope this audit collected data for.

2b'. For every scope where changed=false, call get_cached_scope_analysis:
curl -s -X POST https://dashboard-eight-rho-42.vercel.app/api/mcp <headers> -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"get_cached_scope_analysis","arguments":{"auditId":"<audit_id>","scope":"<scope>"}}}'
If it returns a usable analysis (non-null), keep it as that scope's contribution, tagged carried_forward:true — do NOT spawn an agent for it. If it returns null, treat this scope as changed=true instead (fall back to analyzing it in 2c').

2c'. For every scope that is changed=true (or fell back from 2b'), use the Workflow tool to spawn one specialist subagent PER SCOPE, all via a single parallel() call (a genuine concurrency barrier — do not spawn them one at a time in a loop; synthesis in 2d' needs all of them together anyway).

  Read spec/agent/parallel-per-type-agent-prompt.md from the checked-out repo for the exact per-type agent prompt template. Fill in {SCOPE} with this agent's scope, and {RELATED_SCOPES} from this related-types map (spec 13 §"Related-types map", finalized 2026-07-15):
    - Universal context for EVERY agent (always include): iam, keyvault, resourcegroup, inventory
    - networking/edge cluster: nsg, publicip, cdn
    - compute/app cluster: appservice, appserviceplan, functions
    - data cluster: storage, cosmosdb, acr
    - AI/ML cluster: cognitiveservices
    - vm (isolated): nsg, publicip
  A scope's {RELATED_SCOPES} = universal + its own cluster (e.g. storage's agent gets iam, keyvault, resourcegroup, inventory, storage, cosmosdb, acr).

  Each specialist subagent runs in its own independent context — it has NO access to your conversation, your curl history, or the bearer token unless you give it to it. When you write each subagent's prompt, include the exact same MCP endpoint URL, auth header, and curl mechanism shown at the top of this prompt, plus the per-type-agent-prompt.md instructions with {SCOPE}/{RELATED_SCOPES} filled in. Each subagent must call get_audit_data itself (via curl through its own Bash tool) for its scope and its related scopes only, and must return ONLY the structured shape that file specifies (findings, chain_hints, data_gaps) as its final answer — it must NOT call save_analysis.

  Fault isolation: if a specialist subagent errors or its parallel() slot returns null/nothing usable, do not fail the whole request — carry that scope forward into synthesis as a data_gaps entry ("scope <X> could not be analyzed: <reason>") instead.

2d'. After the parallel() batch returns, spawn ONE more subagent — the synthesis agent — via the Workflow tool (this can be the next phase in the same Workflow script). Read spec/agent/parallel-synthesis-agent-prompt.md from the repo for its exact instructions. Give this subagent: every specialist's output from 2c', every carried-forward cached result from 2b' (tagged carried_forward:true), the same MCP endpoint/auth/curl mechanism (so it can call get_audit_data/get_audit_history itself if it needs to verify something), and the audit ID. This synthesis subagent is the ONLY one that calls save_analysis — it must call it exactly once, with scope "all", using the same curl mechanism.

2e'. If get_audit_data, list_changed_scopes, or get_cached_scope_analysis return an error for this whole "all" request (not just one scope), skip the request and move to the next one — do not call save_analysis for it.

========================================
When all pending requests are processed (saved or skipped), report a short summary: how many processed, how many skipped and why, and list any data_gaps found across all of them (including specialist-fault-isolation gaps from Mode B). Then stop.
```

---

## Deployment checklist (do this in order, do not skip steps)

- [ ] Confirm `MCP_BEARER_TOKEN` in the prompt above is the current live value before pasting — do not
      reuse a value from an old copy of this file without checking.
- [ ] Update the routine via `RemoteTrigger update` (or the routines UI) with:
      - `job_config.ccr.session_context.allowed_tools`: `["Bash", "Workflow"]`
      - `job_config.ccr.events[0].data.message.content`: the prompt block above
- [ ] Do NOT change `cron_expression`, `environment_id`, or anything else in the trigger config.
- [ ] Watch the next scheduled run (daily 08:00) live, or fire it manually first against a request you
      don't mind re-analyzing, to confirm Mode A still behaves identically and Mode B actually
      triggers correctly on a real `"all"` request (only ever created via the dashboard's manual
      "analyze everything" button — Go's auto-queue never emits `"all"`).
- [ ] Update `spec/handoff/15-analyzer-upgrade-plan.md` B8 to `[x]` once a live "all" run completes
      successfully end-to-end (specialists ran in parallel, synthesis called save_analysis once,
      findings look correct, no duplicate/missing scopes).
