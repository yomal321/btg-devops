# Daily analysis workflow — one consolidated file

> **This is the single source of truth for the specialist-per-scope + synthesis workflow.**
> Everything the routine needs — orchestration logic, the specialist agent template, and the
> synthesis agent template — lives in this one file so there's only one place to edit. The
> routine's own stored prompt (in `spec/agent/routine-prompt.md`) is now just a short pointer that
> tells it to `cat` this file and follow it, the same pattern already used for
> `spec/agent/deep-research-playbook.md`. That means changing how the workflow behaves only
> requires editing this file and committing — no need to re-push the routine's config every time.
>
> Requires the routine's `allowed_tools` to include `Workflow` (alongside `Bash`) — confirmed live
> and working via `trig_01QNfXwFH7AkPHxwgCYMbRqT` (throwaway test trigger): subagent spawning, real
> `parallel()` concurrency, Bash access inside a subagent, and reachability to this project's own
> MCP server were all verified end-to-end, including on real production data (2-agent test,
> ~188s wall-clock, found a real subscription-takeover-level finding).
>
> **Known risk, read before running at full scale:** a first attempt at the full 13-scope daily
> batch appeared to stall for 45+ minutes and was rolled back before confirming whether it would
> have finished. A later small-scale test (2 agents) ran fine in ~3 minutes, and the background-task
> panel showed Claude Code auto-parallelizes per audit even without explicit request — so the stall
> may have been a real concurrency/scale effect (many heavy agents queuing for limited slots), not a
> broken design. **Recommendation: roll this out incrementally** — a handful of scopes first, then a
> half-day's worth, before trusting a full daily batch unattended. Keep `spec/agent/routine-prompt.md`'s
> previous single-agent version handy for a fast rollback (already proven to work in ~30 seconds via
> `RemoteTrigger update`) if a real run ever looks stuck.

---

## Part 1 — Orchestration logic (what the top-level routine agent does)

Sort every pending row (from `list_pending_requests`) into exactly one of three buckets:

### BUCKET 1 — scope is `"cost"` or starts with `"usage:"` (or legacy `"usage"`)

Unchanged, one agent per row, no fan-out — these run on deterministic detectors + one agent
writing up the precomputed signals, not a specialist/synthesis split:

1. `get_audit_data(auditId, scope)` → `{data, instruction}`.
2. Read `spec/agent/deep-research-playbook.md` and follow its 5 stages for this scope.
3. Produce `summary`/`findings`/`data_gaps` matching `save_analysis`'s schema.
4. `save_analysis(auditId, scope, summary, findings, model: "claude-code-orchestrator", data_gaps)`.

### BUCKET 2 — scope is a resource type — THE NORMAL DAILY CASE

Resource types: storage, nsg, iam, keyvault, cosmosdb, acr, functions, publicip, appservice,
appserviceplan, cognitiveservices, resourcegroup, cdn, vm, inventory.

Do NOT process these one at a time. **Group all such pending rows by `audit_id` first.** For each
audit's group (may be 1 scope on a quiet day, or several):

1. Use the `Workflow` tool to spawn one specialist subagent per scope in this group, all via a
   single `parallel()` call — a genuine concurrency barrier, never a one-at-a-time loop. Use Part 2
   below as each subagent's prompt template, with `{SCOPE}` and `{RELATED_SCOPES}` filled in from
   the related-types map (Part 4).
2. After the batch returns, spawn ONE synthesis subagent (Part 3 below) fed every specialist's
   output from step 1.
3. **Output shape differs from the manual "all" case (Bucket 3)**: synthesis must decide final
   findings SEPARATELY FOR EACH SCOPE in the group — each scope still has its own
   `analysis_requests` row to close. A cross-type chain finding gets attributed to ONE scope only
   (its entry point), never duplicated across every scope it touches. Synthesis then calls
   `save_analysis` ONCE PER SCOPE in the group (N scopes in → N `save_analysis` calls out).
4. **Fault isolation:** if a specialist subagent errors or returns nothing usable, don't fail the
   group — carry that scope forward as a `data_gaps` entry into synthesis instead.

### BUCKET 3 — scope is exactly `"all"` (manual "analyze everything" button)

Go's auto-queue never produces this — only a manual dashboard click does. Per-scope cache status
wasn't precomputed at queue time here, so check it fresh instead of grouping:

1. `list_changed_scopes(auditId)` → `[{scope, changed}, ...]`.
2. For every `changed=false` scope: `get_cached_scope_analysis(auditId, scope)`. If usable, keep it
   tagged `carried_forward: true` — no agent spawned. If null, treat as `changed=true` instead.
3. For every `changed=true` scope, run the same `parallel()` specialist fan-out as Bucket 2 (Part 2
   template, same related-types map).
4. Spawn one synthesis subagent (Part 3 template) fed all specialist outputs + carried-forward
   cached results. Unlike Bucket 2, this calls `save_analysis` EXACTLY ONCE, scope `"all"`.
5. If `list_changed_scopes`/`get_cached_scope_analysis`/`get_audit_data` error for the whole
   request, skip it — do not call `save_analysis`.

---

## Part 2 — Specialist subagent template (one per scope, run in `parallel()`)

```
You are analyzing ONE resource type — "{SCOPE}" — as part of a larger parallel audit. A separate
synthesis step will combine all agents' outputs afterward, so gather evidence and propose candidate
findings for YOUR resource type only — do not try to produce the final, fully-correlated report.

You are an independent context with no access to the orchestrating agent's curl history or the
bearer token unless given to you directly — you have been given the MCP endpoint URL and auth
header below. Use curl through your own Bash tool for every call.

MCP server endpoint: https://dashboard-eight-rho-42.vercel.app/api/mcp
Auth header: Authorization: Bearer <MCP_BEARER_TOKEN>

## What to fetch

Call get_audit_data(auditId, scope) for:
1. "{SCOPE}" — your primary scope. Its instruction field already includes the severity rubric and
   this resource type's best-practice checklist; follow it.
2. Each of these related scopes, exactly once each — no more, no fewer: {RELATED_SCOPES}

Do not call get_audit_data for any scope outside this list. If you find yourself needing a scope
that isn't in it, that's a signal the finding may span beyond what you can resolve — use chain_hints
instead of fetching further.

## What to do with it

1. Build a local map (scoped-down Stage 1): environments/regions/naming for "{SCOPE}"'s own
   resources and the related scopes only — not the whole subscription.
2. Correlate within what you have (scoped-down Stage 2): join "{SCOPE}"'s config against cost/usage
   data if either was in your related-scopes list.
3. Attempt chains, but only ones your data can actually prove (scoped-down Stage 3): if "{SCOPE}" is
   a plausible entry point and your related scopes include the hop needed to complete the chain,
   build and report it in full, finding_type: "chain". Do NOT fabricate a hop you don't have data for.
4. Chain hints when you can't finish the chain yourself: add one entry to chain_hints describing the
   incomplete lead precisely enough for synthesis (which sees every scope's candidates) to finish it.
5. Do not finalize severity — assign best-effort per the rubric, but treat it as provisional;
   synthesis judges severity in full context and refutes every Critical.
6. Do NOT call save_analysis. Return your findings as your final answer, exact shape below.

## Output shape (return this, nothing else)

{
  "scope": "{SCOPE}",
  "findings": [ /* severity, category, resource_type, resource_name, resource_group?,
                   child_resource_name?, affected_resources?, cost_impact_usd?/cost_impact_note?,
                   issue, evidence, recommendation_steps?, fix_effort?, finding_type? */ ],
  "chain_hints": [ { "starting_resource_type": "{SCOPE}", "starting_resource_name": "...",
                      "lead": "..." } ],
  "data_gaps": [ "anything needed but get_audit_data didn't have" ]
}

If "{SCOPE}" collected no resources this audit, return
{"scope": "{SCOPE}", "findings": [], "chain_hints": [], "data_gaps": []} without fetching anything.
```

---

## Part 3 — Synthesis subagent template (spawned once, after the specialist batch returns)

```
You are the synthesis step of a parallel Azure audit. {N} agents each analyzed one resource type in
isolation and returned candidate findings. Your job is what they could NOT do alone: look at
everything together, decide what's real, and produce the final report(s).

You are an independent context — you have been given the MCP endpoint/auth below directly.

MCP server endpoint: https://dashboard-eight-rho-42.vercel.app/api/mcp
Auth header: Authorization: Bearer <MCP_BEARER_TOKEN>

## What you have

All {N} agents' outputs, each shaped as {scope, findings, chain_hints, data_gaps}:
{PER_TYPE_AGENT_OUTPUTS}

You also have the same tools the specialists had — get_audit_data(auditId, scope) and
get_audit_history(auditId, scope?, limit?) via curl through your own Bash tool — use them to check
anything no specialist covered, or to verify a candidate before committing to it.

## Stage 2 (cross-type correlation) — the part no single agent could do

Look across every scope's findings for patterns only visible when resource types are compared:
compute sitting idle while its data tier still bills full price, a resource group's combined spend
disproportionate to any single scope's flag, or two agents describing the same real issue from two
angles (merge into ONE finding, don't report both).

## Stage 3 (finish the chains the specialists couldn't)

1. Every finding already marked finding_type: "chain" is a strong lead — still subject it to Stage 5
   refutation below.
2. Walk every chain_hints entry from every agent. Check whether another agent's findings (or a
   fresh get_audit_data call) resolves where that lead goes. If it does and the destination is
   valuable (production data, secrets, an admin identity), build the full chain as ONE finding,
   finding_type: "chain". If unresolved, keep it as a data_gaps entry instead of guessing.
3. Do not accept a chain hint at face value without verifying the destination actually grants what
   it claims.

## Stage 4 (judge in full context)

Cross-check environment (prod/dev/QA/sandbox) using every scope's resource groups/tags now visible
together. Call get_audit_history(auditId) (no scope) to check whether any candidate has been open
across multiple prior audits.

## Stage 5 (verify, dedup, report only what matters)

1. Refute every Critical, including every chain you built or completed — actively try to disprove
   it before keeping it Critical.
2. Dedup across all {N} agents' findings BEFORE anything else — same resource_type+resource_name+
   category surfacing from more than one agent's angle is expected given overlapping context; merge,
   don't duplicate.
3. Merge every agent's data_gaps into one list, plus anything you discovered yourself.
4. Prefer few, well-evidenced findings over many shallow ones.
5. Save the result(s):
   - If this is Bucket 2 (grouped daily case): decide final findings SEPARATELY per scope, call
     save_analysis ONCE PER SCOPE in the group — N scopes in, N save_analysis calls out. Attribute
     each cross-type chain finding to ONE scope only (its entry point).
   - If this is Bucket 3 (manual "all"): call save_analysis EXACTLY ONCE, scope "all", with the
     fully merged summary/findings/data_gaps.
```

---

## Part 4 — Related-types map (spec 13, finalized 2026-07-15)

- **Universal context for EVERY specialist** (always include): `iam`, `keyvault`, `resourcegroup`,
  `inventory` — nearly every Stage-3 chain passes through identity/Key Vault regardless of entry point.
- **networking/edge cluster**: `nsg`, `publicip`, `cdn`
- **compute/app cluster**: `appservice`, `appserviceplan`, `functions`
- **data cluster**: `storage`, `cosmosdb`, `acr`
- **AI/ML cluster**: `cognitiveservices`
- **vm (isolated)**: `nsg`, `publicip`

`{RELATED_SCOPES}` for a given `{SCOPE}` = universal + that scope's own cluster.

---

## Deployment checklist

- [ ] Confirm the current `MCP_BEARER_TOKEN` value before deploying — do not reuse a stale copy.
- [ ] Routine `allowed_tools` must be `["Bash", "Workflow"]`.
- [ ] Routine's stored prompt (see `spec/agent/routine-prompt.md`) should just point here via `cat`,
      not inline this whole file's content again.
- [ ] Roll out incrementally: a few real scopes first, then roughly half a day's worth, before
      trusting an unattended full daily batch.
- [ ] If a real run ever looks stuck, `spec/agent/routine-prompt.md`'s prior single-agent version is
      the proven, fast (~30s) rollback path via `RemoteTrigger update`.
- [ ] Update `spec/handoff/15-analyzer-upgrade-plan.md` B8 to `[x]` once a full real daily batch
      completes successfully end-to-end without manual intervention.
