# Changelog

All notable changes to btg-devops will be documented here.
Format based on [Keep a Changelog](https://keepachangelog.com).
Versions follow [Semantic Versioning](https://semver.org).


---

## v0.13.2 - 2026-06-19

### What's Changed

- Update CHANGELOG.md @yomal321 (#13)
- Create CHANGELOG.md @yomal321 (#12)

## v0.13.1 - 2026-06-19

### What's Changed

- Update CHANGELOG.md @yomal321 (#13)
- Create CHANGELOG.md @yomal321 (#12)
- test @yomal321 (#11)

### ⚙️ CI / CD

- Update tet @yomal321 (#10)

this is a testing

## [v0.13.0] — 2026-06-19

### Added

- `analyze all` command — runs all 12 analyzers sequentially and produces a combined report (table or JSON)
  
- Unit tests for all 12 security analyzers (`tests/security_analyzers/`)
  
  - `iam_test.go` — IAM role assignment checks
  - `storage_test.go` — Storage Account security checks
  - `nsg_test.go` — Network Security Group checks
  - `acr_test.go` — Container Registry checks
  - `cosmosdb_test.go` — Cosmos DB checks
  - `keyvault_test.go` — Key Vault checks
  - `functions_test.go` — Azure Functions checks
  - `publicip_test.go` — Public IP checks
  - `appservice_test.go` — App Service checks
  - `appserviceplan_test.go` — App Service Plan checks
  - `cognitiveservices_test.go` — Cognitive Services checks
  - `resourcegroup_test.go` — Resource Group checks
  
- Unit tests for all 10 usage analyzers (`tests/usage_analyzers/`)
  
  - `usage_acr_test.go` — ACR cost and usage tips
  - `usage_appservice_test.go` — App Service cost and usage tips
  - `usage_appserviceplan_test.go` — App Service Plan cost and usage tips
  - `usage_cosmosdb_test.go` — Cosmos DB cost and usage tips
  - `usage_functions_test.go` — Azure Functions cost and usage tips
  - `usage_keyvault_test.go` — Key Vault cost and usage tips
  - `usage_publicip_test.go` — Public IP cost and usage tips
  - `usage_storage_test.go` — Storage Account cost and usage tips
  - `usage_cognitiveservices_test.go` — Cognitive Services cost and usage tips
  - `usage_helpers_test.go` — Shared usage helper tests
  
- GitHub Actions CI pipeline (`.github/workflows/ci.yml`) — runs build, test, and lint on every push to `main` and `production` and on every PR targeting `main`
  
- Release Drafter (`.github/workflows/release-drafter.yml`) — auto-drafts release notes from PR labels (`feature`, `bugfix`, `chore`, `docs`, `ci`)
  
- Automated CHANGELOG updater (`.github/workflows/update-changelog.yml`) — updates `CHANGELOG.md` automatically when a release is published
  
- `CHANGELOG.md` — this file
  
- `CONTRIBUTING.md` — contributor guide with build, test, and lint instructions
  

### Fixed

- Lint errors across `cmd/` flagged by `golangci-lint` (`errcheck`, `unused`, `gosimple`, `staticcheck`)


---

## [v0.12.0] — baseline

### Added

- `analyze appservice-traffic` — analyzes App Service network traffic over the last 14 days to identify idle and unused apps
- `analyze iam` — examines RBAC role assignments for overprivileged, orphaned, duplicate, and misconfigured assignments
- `analyze storage` — checks Storage Accounts for public access, HTTPS enforcement, lifecycle policies, TLS version, and network rules
- `analyze nsg` — analyzes Network Security Groups for overly permissive rules and open management ports exposed to the internet
- `analyze acr` — checks Container Registries for admin account usage, public access, missing private endpoints, and SKU recommendations
- `analyze cosmosdb` — analyzes Cosmos DB accounts for throughput optimization, backup policies, network security, and consistency settings
- `analyze keyvault` — checks Key Vaults for access model, soft-delete, purge protection, network access, and expired secrets and keys
- `analyze functions` — analyzes Function Apps for runtime currency, HTTPS enforcement, managed identity, TLS settings, and plan optimization
- `analyze publicip` — identifies unused Public IPs, Basic SKU deprecation, DDoS protection gaps, and zone redundancy recommendations
- `analyze appserviceplan` — detects empty plans, over-provisioned workers, SKU right-sizing opportunities, and autoscale recommendations
- `analyze cognitiveservices` — checks Cognitive Services and Azure OpenAI accounts for network security, unused deployments, and encryption
- `analyze resourcegroup` — detects empty resource groups, tag compliance violations, naming issues, and missing management locks
- `analyze usage` — deep cost and usage drill-down for a specific Azure resource or all resources of a given type
- `analyze idle` — scans for idle or highly wasteful Azure resources across the subscription
- `analyze cost` — shows actual Azure spend by service and resource for a configurable time period
- Cross-platform binary releases for macOS, Linux, and Windows (amd64 and arm64) via GitHub Actions (`release.yml`)
