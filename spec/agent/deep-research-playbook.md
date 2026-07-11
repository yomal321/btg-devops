# Deep Research Playbook — instructions for the scheduled Claude Code agent

> Read first: `spec/handoff/08-mcp-claude-orchestrator.md` (the MCP server + scheduled agent
> architecture this runs inside) and `spec/handoff/10-deep-research-analysis.md` (the strategy this
> file implements — task 5.1 in that spec's component list).
>
> This file is what the scheduled Claude Code agent is pointed at for a `deep`-scope
> `analysis_request` (spec 10 §5.2 — the "Deep Research" button/scope is built; see
> `dashboard/app/components/AnalysisPanel.tsx` and `getScopedAuditData` in `claude.ts`). For an
> ordinary single-resource-type or "all" request, the agent still just uses `getScopedAuditData`'s
> returned `instruction` directly (severity rubric + checklist), one fetch, one answer — this
> playbook's multi-stage process is ONLY for `scope: 'deep'`.

## Preconditions

- You have MCP tools: `list_pending_requests`, `get_audit_data(auditId, scope)`,
  `get_audit_history(auditId, scope?, limit?)`, `save_analysis`.
- A `deep`-scope request means: investigate the WHOLE subscription for this audit, not one
  resource type. Call `get_audit_data` once per resource type (and for `cost` / each
  `usage:<type>`) as needed — you are not limited to one fetch. Hold everything in context across
  calls before writing any conclusion.
- Every severity you assign must follow the rubric returned in each `get_audit_data` call's
  `instruction` field (Critical = exploitable/exposed/bleeding money now; Warning = real risk
  needing another factor; Info = best-practice deviation with no current impact; tie-break low).
  Every `issue` you write must cite the specific field/value that proves it. These rules are not
  relaxed for deep research — if anything, hold them stricter, since deep findings carry more
  weight with the reader.

## Stage 1 — Build the map

Before looking for a single problem, fetch every resource type plus `cost` and each `usage:<type>`
available for this audit, and build an internal picture:

- **Environments**: infer prod / dev / QA / UAT / sandbox from resource names, resource group
  names, and any tags present in the data. Write this mapping down for yourself — you will need it
  in Stage 4.
- **Regions**: which regions are actually in use, and which resource groups/apps live in which.
- **Application groupings**: which resources plausibly form one application together (e.g. an App
  Service + the Cosmos DB account + the Storage account it references) — infer from naming
  conventions, shared resource groups, or explicit connection references in the data.
- **Spend shape**: from the cost data, what are the top line items? Where does the money actually
  go?

Do not report any finding yet. This stage only builds context used by every later stage.

## Stage 2 — Correlate datasets

For every resource that is significant by cost or by role in an application grouping (from Stage
1), join configuration, cost, and usage together for that SAME resource — this is the join no
single-scope analysis performs:

- Provisioned capacity (RU/s, SKU/tier, instance count) vs. actual utilization from the usage
  data. A large gap is a concrete, quantifiable finding (e.g. "provisioned at X, 30-day peak is Y,
  ~$Z/month of that capacity is unused").
- Cost with no corresponding usage signal at all → likely orphaned/abandoned resource.
- A premium/production-grade tier sitting under a resource whose naming/resource-group says
  dev/test/sandbox.

Every finding produced in this stage should have a `cost_impact_usd` figure derived from the
correlation, not a guess — show your arithmetic in the `issue` text.

## Stage 3 — Chain issues into attack paths

A single fact ("NSG rule open to 0.0.0.0/0", "managed identity has Key Vault access") is common and
low-value on its own. The valuable finding is the CHAIN — multiple individually low/medium-severity
facts that, connected, describe a real path from an entry point (usually a public IP or open NSG
rule) to something valuable (production data, secrets, an admin identity).

To build a chain:
1. Start from every public-facing entry point in the data: a Public IP resource, an NSG rule open
   to the internet, or an App Service/Function App with public network access and no auth
   configured.
2. Follow what identity that entry point holds — App Services, Function Apps, Cosmos DB accounts,
   Storage accounts, ACR, and Cognitive Services can all carry a managed identity
   (`identity.principalId` in their own data) or explicit role assignments (the `iam` data).
3. Follow that identity's access forward — check Key Vault `accessPolicies`/RBAC role assignments
   for that same `principalId`, and check what storage/Cosmos DB connection strings or secrets that
   Key Vault holds — until you reach something with real value (production credentials, production
   data, an ability to escalate further).
4. If the chain reaches something valuable, that is a headline finding — severity almost always
   Critical (it satisfies "actively exploitable now" even if every individual link looked like a
   Warning or Info in isolation), and it must be reported as ONE finding describing the full path,
   not as several disconnected findings.

Note: this subscription has no Virtual Machines (confirmed via `az vm list` — empty), so chains
never involve a VM as a hop. Every chain here runs through PaaS resources (App Service, Functions,
Cosmos DB, Storage, Key Vault) and their managed identities/role assignments instead. Example:
"App Service `app-x` has public network access with no auth configured (`publicNetworkAccess:
Enabled`, no `authsettingsV2` configured) → its system-assigned identity (`identity.principalId:
Y`) holds an access policy on Key Vault `kv-prod` granting `get`/`list` on secrets → `kv-prod`
contains the connection string for production Cosmos DB account `Z`." If a future audit of a
different subscription does have VMs and this gap becomes real, see spec 10 §5.5/§6 for the
decision on adding a VM/NIC extractor before applying this chain logic to VM-based paths.

Represent a chain finding in `save_analysis` using these fields:
- `finding_type`: `"chain"` — this is what makes it render as a distinct headline card at the top
  of the analysis page instead of blending into the regular findings list. Every ordinary finding
  should omit this field (or set `"standard"`).
- `resource_name` / `resource_type`: the chain's starting point (the internet-facing resource).
- `affected_resources`: every resource name in the chain, in order.
- `issue`: the full narrative, written as the chain itself, citing the actual field/value at each
  hop (see the App Service → Key Vault → Cosmos DB example above).
- `cost_impact_note`: `"security risk"` (chains found this way are virtually never cost findings).
- `fix_effort`: still set normally (quick/moderate/complex) — a chain finding's severity and its
  fix cost are independent, same as any other finding.

## Stage 4 — Judge in context

Before finalizing severity on ANY candidate finding (from Stage 2, Stage 3, or an ordinary
checklist-style finding), weigh it against the Stage 1 map and against history:

- The same misconfiguration is Critical in a production-tagged resource group and Info in a
  sandbox one. Never assign severity from the issue type alone — always cross-check which
  environment it's actually in.
- "No secondary region / no failover" matters for a resource serving the customer-facing
  application; it does not matter for an isolated test database with no dependents.
- Call `get_audit_history(auditId, scope)` (omit `scope` for a `deep` request, to see history
  across every resource type) to check this audit subscription's *prior* findings: has this exact
  issue existed for multiple audits unresolved? That is worth surfacing explicitly ("open for N
  audits, not yet fixed") — a growing/stale finding is more valuable to report clearly than a
  same-severity brand-new one. If `get_audit_history` returns nothing relevant (e.g. this is the
  subscription's first audit), that's a normal empty result, not a gap — only record a `data_gaps`
  note (Stage 5) if the TOOL CALL ITSELF fails, not just because history happens to be short.

## Stage 5 — Verify, then report only what matters

Before calling `save_analysis`:

1. **Refute every Critical.** For each Critical-severity candidate (especially every chain finding
   from Stage 3), re-read the actual data again and actively try to prove yourself wrong — is
   there a private endpoint elsewhere in the data you missed? Is that "public" IP actually
   unattached? Is the "production" tag actually on a decommissioned resource? If the finding
   doesn't survive this check, downgrade it (to Warning/Info) or drop it entirely. Do not skip this
   step to save time — a false Critical is worse than a missed one, since it is what destroys trust
   in the whole system.
2. **Prefer few, well-evidenced findings over many shallow ones.** The target output for a `deep`
   run is a short list — typically a handful of Stage 2/3 findings that survived verification, each
   with full evidence and a clear "why this matters" — followed by the routine checklist-level
   findings below them (still real, just not headline). A `deep` run on a genuinely healthy
   subscription correctly reports few or no headline findings; do not manufacture significance to
   fill space.
3. **Record what you could not check.** If, at any stage, you needed data that wasn't in what
   `get_audit_data` returned (e.g. a managed identity's role assignment target you couldn't
   resolve, usage data missing for a resource you wanted to correlate cost against), pass it as a
   short string in `save_analysis`'s `data_gaps` array (spec 10 §5.4/§6) — this is what turns into
   the next round of extractor work. Do not silently skip a chain because data was missing; say so.
4. Call `save_analysis` with the final findings (Stage 2/3 headline findings marked
   `finding_type: "chain"`, ordinary findings after), `fix_effort` set on every finding, and
   `data_gaps` populated if step 3 found any.

## What NOT to do

- Do not report a chain finding as several separate single-resource findings — that defeats the
  entire point of Stage 3.
- Do not assign Critical because a finding is security-related; assign it because Stage 4's
  business-context check and Stage 5's refutation both hold up.
- Do not skip Stage 1 to save time — judging severity in Stage 4 is not possible without the
  environment map.
- Do not fabricate a cost figure in Stage 2 — if usage data isn't available for a resource, note
  the gap (Stage 5.3) instead of guessing a number.
