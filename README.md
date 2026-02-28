# btg-devops

A DevOps CLI tool that uses an Azure Service Principal to examine Azure subscriptions and provide insights on anomalies, cost savings, misconfigurations, and best practices.

## Features

- **App Service Traffic Analysis** — Analyzes Azure App Service network traffic over the last 14 days to identify idle/unused apps, helping reduce costs.

## Prerequisites

- Go 1.21+
- Azure Service Principal with **Reader** role on the target subscription

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

### Output

The tool classifies each App Service as:

| Status | Criteria | Recommendation |
|--------|----------|----------------|
| **Idle/Unused** | Zero requests and zero network traffic | Shut down or delete |
| **Low Traffic** | < 1,000 requests in 14 days | Scale down or consolidate |
| **Active** | ≥ 1,000 requests | Normal operation |

It also flags apps with high 5xx error rates (>10%).

## License

MIT
