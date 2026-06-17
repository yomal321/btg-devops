# btg-devops — Feature Specification

**Version:** v0.12.0  
**Status:** Production-ready (feature-complete, no safety net)  
**Owner:** BISTEC Global — DevOps / Platform team  
**Last updated:** 2026-06-09

---

## 1. Overview

`btg-devops` is a command-line tool written in Go that connects to a Microsoft Azure subscription and audits cloud resources for cost waste, security misconfigurations, and operational issues. It produces a human-readable table or machine-readable JSON report directly in the terminal, with no external dashboard or service required.

The tool is designed to be run on demand by a DevOps engineer. It requires no installation beyond copying a single compiled binary.

---

## 2. Problem Statement

Azure subscriptions accumulate unused or misconfigured resources over time — orphaned public IPs, over-privileged IAM roles, storage accounts with public access, NSGs with open ports, and more. Identifying these issues manually across 12 different resource types is time-consuming and error-prone. `btg-devops` automates this audit into a single CLI command per resource type, with consistent severity classification across all findings.

---

## 3. Goals

- Audit an Azure subscription for cost, security, and misconfiguration issues across 12 resource types.
- Classify every finding as **Critical**, **Warning**, or **Info** so engineers can triage quickly.
- Support both human (table) and machine (JSON) output for use in scripts or CI pipelines.
- Ship as a single compiled binary with zero runtime dependencies.
- Support all major platforms: Windows (amd64), macOS (arm64, amd64), Linux (arm64, amd64).

---

## 4. Architecture Summary

`btg-devops` follows a three-layer architecture inside a single Go binary:

| Layer | Technology | Responsibility |
|---|---|---|
| CLI Interface | Go / Cobra | Parse commands and flags, route to analyzer |
| Analysis Engine | Go | 12 analyzer modules, severity classification |
| Azure SDK Layer | azure-sdk-for-go | Service Principal auth, ARM API calls |
| Output Formatter | Go | Render findings as table or JSON |

Authentication is handled via environment variables (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_SUBSCRIPTION_ID`). The tool uses `azidentity.NewClientSecretCredential` to obtain an OAuth2 token from Azure Active Directory before making any ARM calls.

Full C4 diagrams (Context, Container, Component) are maintained separately in `docs/architecture/`.

---

## 5. In Scope

### 5.1 CLI Interface

The tool exposes an `analyze` command with 12 subcommands. Common global flags available on all subcommands:

| Flag | Description |
|---|---|
| `--subscription-id` | Azure subscription to audit (overrides env var) |
| `--resource-group` | Scope the audit to a single resource group |
| `--output` | Output format: `table` (default) or `json` |

### 5.2 Analyzer Modules (12 total)

Each analyzer connects to the corresponding Azure ARM API, fetches resource data, and classifies each finding.

---

#### Module 001 — Storage Account (`analyze storage`)

Audits Azure Storage Accounts for security and cost issues.

| Check | Severity | Condition |
|---|---|---|
| Public blob access enabled | Critical | `allowBlobPublicAccess = true` |
| HTTPS-only not enforced | Critical | `enableHttpsTrafficOnly = false` |
| No diagnostic logs | Warning | Diagnostic settings absent |
| LRS redundancy (no geo-redundancy) | Warning | Replication type is `Standard_LRS` |
| No lifecycle management policy | Info | No blob lifecycle rule configured |

---

#### Module 002 — IAM (`analyze iam`)

Audits role assignments across the subscription for over-privileged access.

| Check | Severity | Condition |
|---|---|---|
| Owner role at subscription scope | Critical | `roleDefinitionId` = Owner + scope = subscription |
| Contributor role at subscription scope | Warning | `roleDefinitionId` = Contributor + scope = subscription |
| Reader role at subscription scope | Info | `roleDefinitionId` = Reader + scope = subscription |
| Owner role at resource group scope | Warning | Owner role scoped to a resource group |

---

#### Module 003 — NSG (`analyze nsg`)

Audits Network Security Groups for overly permissive inbound rules.

| Check | Severity | Condition |
|---|---|---|
| Port 22 (SSH) open to internet | Critical | Source = `*` or `0.0.0.0/0`, port = 22 |
| Port 3389 (RDP) open to internet | Critical | Source = `*` or `0.0.0.0/0`, port = 3389 |
| Any port open to internet (`*`) | Warning | Source = `*`, port = `*` |
| NSG with no rules | Info | Security rules list is empty |

---

#### Module 004 — ACR (`analyze acr`)

Audits Azure Container Registries.

| Check | Severity | Condition |
|---|---|---|
| Admin user enabled | Critical | `adminUserEnabled = true` |
| Public network access enabled | Warning | `publicNetworkAccess = Enabled` |
| Basic SKU in use | Warning | SKU tier is `Basic` |
| No geo-replication | Info | Replications list is empty |

---

#### Module 005 — CosmosDB (`analyze cosmosdb`)

Audits Azure Cosmos DB accounts.

| Check | Severity | Condition |
|---|---|---|
| Public network access enabled | Critical | `publicNetworkAccess = Enabled` |
| No virtual network rules | Warning | VNet rules list is empty |
| Automatic failover disabled | Warning | `enableAutomaticFailover = false` |
| Single-region account | Info | Locations list has only one entry |

---

#### Module 006 — Key Vault (`analyze keyvault`)

Audits Azure Key Vaults.

| Check | Severity | Condition |
|---|---|---|
| Soft delete disabled | Critical | `enableSoftDelete = false` |
| Purge protection disabled | Critical | `enablePurgeProtection = false` |
| Public network access enabled | Warning | Network ACL default action = `Allow` |
| No diagnostic logs | Warning | Diagnostic settings absent |

---

#### Module 007 — Functions (`analyze functions`)

Audits Azure Function Apps.

| Check | Severity | Condition |
|---|---|---|
| HTTPS-only not enforced | Critical | `httpsOnly = false` |
| Functions with no authentication | Warning | Auth settings level = `Anonymous` |
| Old runtime version | Warning | Runtime version < current LTS |
| No application insights | Info | App Insights connection string absent |

---

#### Module 008 — Public IP (`analyze publicip`)

Audits Public IP addresses for orphaned (unused) resources.

| Check | Severity | Condition |
|---|---|---|
| Public IP not associated with any resource | Warning | `ipConfiguration` is null |
| Static IP unused | Warning | Allocation = `Static`, not associated |
| Public IP with no DNS label | Info | `dnsSettings` is null |

---

#### Module 009 — App Service (`analyze appservice`)

Audits Azure App Service web apps.

| Check | Severity | Condition |
|---|---|---|
| HTTPS-only not enforced | Critical | `httpsOnly = false` |
| TLS version below 1.2 | Critical | Minimum TLS = `1.0` or `1.1` |
| Remote debugging enabled | Warning | `remoteDebuggingEnabled = true` |
| No custom domain | Info | `hostNames` only has default `.azurewebsites.net` |

---

#### Module 010 — App Service Plan (`analyze appserviceplan`)

Audits App Service Plans for idle or over-provisioned capacity.

| Check | Severity | Condition |
|---|---|---|
| Zero apps on plan | Warning | `numberOfSites = 0` |
| Free / Shared tier | Info | SKU tier is `Free` or `Shared` |
| Single instance (no scale-out) | Info | `capacity = 1` and tier ≥ Standard |

---

#### Module 011 — Cognitive Services (`analyze cognitiveservices`)

Audits Azure Cognitive Services accounts.

| Check | Severity | Condition |
|---|---|---|
| Public network access enabled | Critical | `publicNetworkAccess = Enabled` |
| No diagnostic logs | Warning | Diagnostic settings absent |
| Local auth keys enabled | Warning | `disableLocalAuth = false` |

---

#### Module 012 — Resource Group (`analyze resourcegroup`)

Audits resource groups for tagging and emptiness.

| Check | Severity | Condition |
|---|---|---|
| No tags on resource group | Warning | `tags` map is null or empty |
| Empty resource group | Info | Resource count = 0 |
| Missing required tag (`env`, `owner`) | Warning | Expected tag keys absent |

---

### 5.3 Output Formats

**Table (default)** — ASCII table printed to stdout, one row per finding:

```
RESOURCE              TYPE       SEVERITY   ISSUE
my-storage-account    storage    CRITICAL   Public blob access enabled
prod-nsg              nsg        CRITICAL   Port 22 open to internet
old-ip-01             publicip   WARNING    Public IP not associated with any resource
```

**JSON (`--output json`)** — structured array for scripting or CI:

```json
[
  {
    "resource": "my-storage-account",
    "type": "storage",
    "severity": "CRITICAL",
    "issue": "Public blob access enabled"
  }
]
```

---

### 5.4 Authentication

The tool reads credentials exclusively from environment variables at startup. It will exit with a descriptive error if any required variable is missing.

| Variable | Description |
|---|---|
| `AZURE_TENANT_ID` | Azure AD tenant ID |
| `AZURE_CLIENT_ID` | Service Principal application (client) ID |
| `AZURE_CLIENT_SECRET` | Service Principal client secret |
| `AZURE_SUBSCRIPTION_ID` | Target Azure subscription ID |

---

### 5.5 Cross-Platform Binaries

Pre-compiled binaries are published on GitHub Releases for every `v*` tag:

| Platform | Architecture |
|---|---|
| Windows | amd64 |
| macOS | arm64, amd64 |
| Linux | arm64, amd64 |

Build is managed by `.github/workflows/release.yml` (already in repo).

---

## 6. Out of Scope

The following items are **not** part of the current v0.12.0 release. Sections 6.1–6.5 are planned for v0.13.0 and are the active work items for the intern onboarding track. Sections 6.6–6.7 are deferred to future releases.

### 6.1 CI/CD Pipeline (`.github/workflows/ci.yml`)

Automated quality checks on every push and pull request are not yet in place.

- No GitHub Actions CI workflow exists for continuous integration.
- There is no automatic `go build`, `go test`, or `golangci-lint` run on push to `main`.
- Pull requests can be merged without passing any automated checks.
- **Planned:** Create `.github/workflows/ci.yml` triggering on push to `main` and all PRs, running build → test → lint in sequence.

### 6.2 Unit Tests (`tests/`)

The codebase has zero test coverage across all 12 modules.

- No `tests/` directory exists in the repository.
- Severity classification logic (the most critical business logic) is entirely untested.
- Edge cases — empty resource lists, nil pointer values, malformed API responses — are not covered.
- **Planned:** Create `tests/` at repo root with one test file per module (`iam_test.go`, `storage_test.go`, etc.) using Go's standard `testing` package and `testify/assert`. Start with IAM (most complex classification logic).

### 6.3 CHANGELOG (`CHANGELOG.md`)

There is no version history or release documentation in the repository.

- No `CHANGELOG.md` file exists.
- Releases have been made via manual git tags with no accompanying notes.
- **Planned:** Create `CHANGELOG.md` in conventional commits format, starting with a v0.12.0 baseline entry documenting all 12 modules. v0.13.0 entry to be added when CI and tests land.

### 6.4 Contributing Guide (`CONTRIBUTING.md`)

There is no onboarding documentation for new contributors.

- No `CONTRIBUTING.md` file exists.
- Build, test, and lint commands are not documented for contributors.
- There is no PR checklist or branch convention documented.
- **Planned:** Create `CONTRIBUTING.md` covering: how to build (`go build ./...`), how to run tests (`go test ./...`), how to lint (`golangci-lint run`), and a PR checklist.

### 6.5 Docs Verification

The `docs/` feature index has not been audited against the current code.

- Links in the feature index have not been verified.
- Feature spec documents in `docs/` may not reflect the current implementation.
- **Planned:** Verify all 12 module docs exist, links are valid, and spec content matches the actual severity rules in the code.

### 6.6 MCP Integration

An MCP setup guide exists in `docs/` but is not connected to any active system.

- The guide describes how to wire up the tool as an MCP server.
- No active MCP server or client integration has been implemented.
- **Not planned for v0.13.0** — deferred to a future release.

### 6.7 Web Dashboard (Next.js)

There is currently no visual interface for the audit results. All output is CLI-only (table or JSON to stdout).

**Problem:** Non-technical stakeholders and team leads have no way to view audit findings without running CLI commands or reading raw JSON. A web dashboard would make findings accessible, filterable, and trackable over time.

**Planned solution:** Build a Next.js web application that wraps the btg-devops CLI output and presents it as an interactive dashboard.

**Proposed feature set:**

| Feature | Description |
|---|---|
| Subscription overview | Summary cards showing total Critical / Warning / Info counts across all 12 modules |
| Per-module findings table | Filterable, sortable table of findings per resource type |
| Severity filter | Filter findings by Critical / Warning / Info |
| Resource group filter | Scope the view to a single resource group |
| JSON import | Upload or paste the `--output json` payload to populate the dashboard |
| Dark / light mode | Theme toggle for developer usability |

**Proposed tech stack:**

| Layer | Technology |
|---|---|
| Framework | Next.js 14+ (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Charts / stats | Recharts or Chart.js |
| Data source | btg-devops CLI `--output json` (file upload or API call) |
| Deployment | Vercel or Azure Static Web Apps |

**Integration approach (two options to decide):**

1. **Static import** — The dashboard accepts a JSON file exported from `btg-devops --output json` and renders it client-side. No backend required.
2. **API backend** — A thin Next.js API route (`/api/analyze`) shells out to the btg-devops binary and streams results back to the frontend. Requires the binary to be bundled with or accessible from the server.

**Not planned for v0.13.0** — this is a separate project tracked independently. Internship track will scope and begin design once v0.13.0 quality items are complete.

---

## 7. Acceptance Criteria (v0.12.0)

The following are the criteria against which the current release is considered complete:

- [ ] All 12 `analyze` subcommands run without error against a live Azure subscription.
- [ ] Each analyzer returns at least one finding per severity level (Critical, Warning, Info) in a test subscription.
- [ ] `--output json` produces valid JSON that can be parsed by `jq`.
- [ ] `--output table` produces a readable ASCII table with correct column headers.
- [ ] Missing environment variable at startup produces a clear, human-readable error message.
- [ ] Binary runs on Windows (amd64), macOS (arm64), and Linux (amd64) without additional dependencies.
- [ ] `README.md` documents all 12 modules with usage examples.

---

## 8. Known Gaps / Tech Debt

| Gap | Impact | Priority |
|---|---|---|
| No unit tests — zero coverage | Regressions go undetected | High |
| No CI pipeline | Bad code can land on `main` | High |
| No CHANGELOG | Release history is invisible | Medium |
| No CONTRIBUTING.md | New contributors have no guide | Medium |
| No web dashboard | Findings not accessible to non-CLI users | Medium |
| MCP guide never wired up | Feature is documented but unusable | Low |

---

## 9. Dependencies

| Dependency | Version | Purpose |
|---|---|---|
| Go | 1.23.6 | Language runtime |
| github.com/spf13/cobra | latest | CLI framework |
| github.com/Azure/azure-sdk-for-go/sdk/azidentity | latest | Azure authentication |
| github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/* | latest | 12 ARM resource clients |