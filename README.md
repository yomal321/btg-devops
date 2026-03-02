# btg-devops

A DevOps CLI tool that uses an Azure Service Principal to examine Azure subscriptions and provide insights on anomalies, cost savings, misconfigurations, and best practices.

## Features

- **App Service Traffic Analysis** — Analyzes Azure App Service network traffic over the last 14 days to identify idle/unused apps, helping reduce costs.
- **IAM Role Assignment Analysis** — Examines RBAC role assignments for overprivileged, orphaned, duplicate, and misconfigured assignments.
- **Storage Account Analysis** — Checks Storage Accounts for public access, HTTPS enforcement, lifecycle policies, TLS version, network rules, and encryption settings.
- **NSG Analysis** — Analyzes Network Security Groups for overly permissive rules, open management ports (RDP/SSH/SQL) to the internet, and unassociated NSGs.

## Prerequisites

- Go 1.21+
- Azure Service Principal with **Reader** role on the target subscription

## Installation

Download the latest binary from [Releases](https://github.com/chanbistec/btg-devops/releases).

| Platform | Binary |
|----------|--------|
| macOS (Apple Silicon) | `btg-devops-darwin-arm64` |
| macOS (Intel) | `btg-devops-darwin-amd64` |
| Windows (x64) | `btg-devops-windows-amd64.exe` |
| Windows (ARM) | `btg-devops-windows-arm64.exe` |
| Linux (x64) | `btg-devops-linux-amd64` |
| Linux (ARM) | `btg-devops-linux-arm64` |

### macOS Note

The binaries are not signed with an Apple Developer certificate. After downloading:

```bash
# Remove quarantine flag
xattr -d com.apple.quarantine btg-devops-darwin-arm64
chmod +x btg-devops-darwin-arm64
```

Or right-click the file in Finder → Open → click "Open" on the Gatekeeper prompt.

## Setup

### 1. Set environment variables

```bash
export AZURE_TENANT_ID="your-tenant-id"
export AZURE_CLIENT_ID="your-client-id"
export AZURE_CLIENT_SECRET="your-client-secret"
export AZURE_SUBSCRIPTION_ID="your-subscription-id"
```

### 2. Build

```bash
go build -o btg-devops .
```

## Usage

### Analyze App Service Traffic

```bash
# Analyze all App Services in the subscription
btg-devops analyze appservice-traffic

# Filter by resource group
btg-devops analyze appservice-traffic --resource-group my-rg

# Override subscription ID
btg-devops analyze appservice-traffic --subscription-id xxx

# JSON output
btg-devops analyze appservice-traffic --output json
```

### Analyze Storage Accounts

```bash
# Analyze all Storage Accounts
btg-devops analyze storage

# Filter by resource group
btg-devops analyze storage --resource-group my-rg

# JSON output
btg-devops analyze storage --output json
```

### Analyze Network Security Groups

```bash
# Analyze all NSGs
btg-devops analyze nsg

# Filter by resource group
btg-devops analyze nsg --resource-group my-rg

# JSON output
btg-devops analyze nsg --output json
```

### Output (App Service Traffic)

The tool classifies each App Service as:

| Status | Criteria | Recommendation |
|--------|----------|----------------|
| **Idle/Unused** | Zero requests and zero network traffic | Shut down or delete |
| **Low Traffic** | < 1,000 requests in 14 days | Scale down or consolidate |
| **Active** | ≥ 1,000 requests | Normal operation |

It also flags apps with high 5xx error rates (>10%).

## License

MIT
