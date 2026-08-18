import { describe, it, expect } from 'vitest'
import {
  detectZombieSpend, detectSpendSpikes, detectServiceConcentration, detectCostUsageWaste,
  rollupCostByResourceGroup, rollupCostByTag, forecastCost, detectReservedInstanceCandidates,
  resourceNameFromId, InventoryDataRaw,
} from './costInsights'
import { CostRow, UsageMetricRaw } from '../types'

function costRow(over: Partial<CostRow>): CostRow {
  return { Cost: 1, Currency: 'USD', UsageDate: 20260101, ResourceId: '', ServiceName: '', ...over }
}

const RG = 'rg-test'
const SUB = '/subscriptions/sub'
function resId(type: string, name: string, rg = RG) {
  return `${SUB}/resourcegroups/${rg}/providers/${type}/${name}`
}

describe('resourceNameFromId', () => {
  it('takes the last path segment', () => {
    expect(resourceNameFromId(resId('microsoft.storage/storageaccounts', 'mystorage123'))).toBe('mystorage123')
  })
})

describe('detectZombieSpend', () => {
  const inventory: InventoryDataRaw = { total_resources: 1, by_type: {}, resources: [{ name: 'known-vm', type: 'x' }] }

  it('flags a resource with cost but absent from inventory', () => {
    const rows = [costRow({ ResourceId: resId('microsoft.compute/disks', 'orphan-disk'), Cost: 5, UsageDate: 20260101 })]
    const findings = detectZombieSpend(rows, inventory)
    expect(findings).toHaveLength(1)
    expect(findings[0].resource_name).toBe('orphan-disk')
    expect(findings[0].total_cost_usd).toBe(5)
  })

  it('does not flag a resource present in inventory', () => {
    const rows = [costRow({ ResourceId: resId('microsoft.compute/virtualmachines', 'known-vm'), Cost: 5 })]
    expect(detectZombieSpend(rows, inventory)).toHaveLength(0)
  })

  it('returns [] (not partial results) when the inventory listing was truncated', () => {
    const truncatedInventory: InventoryDataRaw = { ...inventory, truncated: true }
    const rows = [costRow({ ResourceId: resId('microsoft.compute/disks', 'orphan-disk'), Cost: 5 })]
    expect(detectZombieSpend(rows, truncatedInventory)).toHaveLength(0)
  })

  it('sums cost and tracks billed-day span across multiple rows for the same resource', () => {
    const id = resId('microsoft.compute/disks', 'orphan-disk')
    const rows = [
      costRow({ ResourceId: id, Cost: 3, UsageDate: 20260101 }),
      costRow({ ResourceId: id, Cost: 4, UsageDate: 20260103 }),
    ]
    const [f] = detectZombieSpend(rows, inventory)
    expect(f.total_cost_usd).toBe(7)
    expect(f.first_cost_date).toBe('2026-01-01')
    expect(f.last_cost_date).toBe('2026-01-03')
    expect(f.billed_days).toBe(2)
  })
})

describe('detectSpendSpikes', () => {
  it('flags a statistically abnormal day against a resource\'s own flat history', () => {
    const id = resId('microsoft.documentdb/databaseaccounts', 'cosmos-a')
    const rows: CostRow[] = []
    for (let d = 1; d <= 20; d++) {
      rows.push(costRow({ ResourceId: id, Cost: 1, UsageDate: 20260100 + d }))
    }
    rows.push(costRow({ ResourceId: id, Cost: 50, UsageDate: 20260121 })) // clear outlier
    const findings = detectSpendSpikes(rows)
    expect(findings.some(f => f.spike_date === '2026-01-21')).toBe(true)
  })

  it('does not flag anything under the minimum billed-days requirement', () => {
    const id = resId('microsoft.documentdb/databaseaccounts', 'cosmos-a')
    const rows = [costRow({ ResourceId: id, Cost: 1 }), costRow({ ResourceId: id, Cost: 100, UsageDate: 20260102 })]
    expect(detectSpendSpikes(rows)).toHaveLength(0)
  })
})

describe('detectServiceConcentration', () => {
  it('flags a service whose cost share far outweighs its resource-count share', () => {
    const rows: CostRow[] = [
      costRow({ ServiceName: 'Azure Cosmos DB', ResourceId: 'r1', Cost: 90 }),
      costRow({ ServiceName: 'Storage', ResourceId: 'r2', Cost: 5 }),
      costRow({ ServiceName: 'Storage', ResourceId: 'r3', Cost: 5 }),
    ]
    const findings = detectServiceConcentration(rows)
    expect(findings.find(f => f.service_name === 'Azure Cosmos DB')).toBeTruthy()
    expect(findings.find(f => f.service_name === 'Storage')).toBeFalsy()
  })
})

describe('detectCostUsageWaste', () => {
  // Regression test verified against a real production audit this session:
  // an App Service Plan (windowsdynamicplan-prod) had CPU at 3.4% (well
  // under the 15% waste threshold) but Memory at 70.9% — detectCostUsageWaste
  // must use the HIGHER of the two, or it would wrongly recommend
  // downsizing a plan that's actually memory-bound.
  it('does not flag a resource that is low on one utilization metric but high on another', () => {
    const id = resId('microsoft.web/serverfarms', 'plan-a')
    const rows = [costRow({ ResourceId: id, Cost: 500 })]
    const metrics: UsageMetricRaw[] = [
      { resource_id: id, metric_name: 'CpuPercentage', unit: 'Percent', summary: { avg: 3.4, total: null }, data_points: [] },
      { resource_id: id, metric_name: 'MemoryPercentage', unit: 'Percent', summary: { avg: 70.9, total: null }, data_points: [] },
    ]
    expect(detectCostUsageWaste(rows, metrics)).toHaveLength(0)
  })

  it('flags a resource that is genuinely low on every relevant utilization metric', () => {
    const id = resId('microsoft.web/serverfarms', 'plan-b')
    const rows = [costRow({ ResourceId: id, Cost: 500 })]
    const metrics: UsageMetricRaw[] = [
      { resource_id: id, metric_name: 'CpuPercentage', unit: 'Percent', summary: { avg: 2, total: null }, data_points: [] },
      { resource_id: id, metric_name: 'MemoryPercentage', unit: 'Percent', summary: { avg: 4, total: null }, data_points: [] },
    ]
    const findings = detectCostUsageWaste(rows, metrics)
    expect(findings).toHaveLength(1)
    expect(findings[0].utilization_pct).toBe(4) // the higher of the two
  })

  it('ignores resources too cheap to matter even if fully idle', () => {
    const id = resId('microsoft.documentdb/databaseaccounts', 'cosmos-cheap')
    const rows = [costRow({ ResourceId: id, Cost: 5 })]
    const metrics: UsageMetricRaw[] = [
      { resource_id: id, metric_name: 'NormalizedRUConsumption', unit: 'Percent', summary: { avg: 0, total: null }, data_points: [] },
    ]
    expect(detectCostUsageWaste(rows, metrics)).toHaveLength(0)
  })
})

describe('rollupCostByResourceGroup / rollupCostByTag', () => {
  const inventory: InventoryDataRaw = {
    total_resources: 2,
    by_type: {},
    resources: [
      { name: 'vm-a', type: 'x', resourceGroup: 'rg-prod', tags: { env: 'prod' } },
      { name: 'vm-b', type: 'x', resourceGroup: 'rg-dev', tags: { env: 'dev' } },
    ],
  }
  const rows: CostRow[] = [
    costRow({ ResourceId: resId('microsoft.compute/virtualmachines', 'vm-a'), Cost: 10 }),
    costRow({ ResourceId: resId('microsoft.compute/virtualmachines', 'vm-b'), Cost: 3 }),
    costRow({ ResourceId: resId('microsoft.compute/disks', 'orphan'), Cost: 7 }), // not in inventory -> ungrouped
  ]

  it('rolls cost up by resource group, folding unknown resources into ungrouped', () => {
    const rollup = rollupCostByResourceGroup(rows, inventory)
    expect(rollup.find(r => r.resource_group === 'rg-prod')?.total_cost_usd).toBe(10)
    expect(rollup.find(r => r.resource_group === 'rg-dev')?.total_cost_usd).toBe(3)
    expect(rollup.find(r => r.resource_group === 'ungrouped')?.total_cost_usd).toBe(7)
  })

  it('rolls cost up by tag, skipping resources with no tags', () => {
    const rollup = rollupCostByTag(rows, inventory)
    expect(rollup.find(r => r.tag_key === 'env' && r.tag_value === 'prod')?.total_cost_usd).toBe(10)
    expect(rollup.find(r => r.tag_key === 'env' && r.tag_value === 'dev')?.total_cost_usd).toBe(3)
  })

  it('returns [] when inventory is truncated, rather than a rollup with silently missing resources', () => {
    expect(rollupCostByResourceGroup(rows, { ...inventory, truncated: true })).toHaveLength(0)
  })

  // Regression test verified against a real production audit this session:
  // the SAME real resource group came back from different resources'
  // inventory records with different casing ("BistecCare-Ltd-PROD" on one
  // resource, "bisteccare-ltd-prod" on another) — since Azure resource group
  // names are case-insensitive platform-wide, this must merge into one row,
  // not silently split cost/counts across two.
  it('merges resource groups that differ only by casing across resources', () => {
    const mixedCaseInventory: InventoryDataRaw = {
      total_resources: 2,
      by_type: {},
      resources: [
        { name: 'vm-a', type: 'x', resourceGroup: 'BistecCare-Ltd-PROD' },
        { name: 'vm-b', type: 'x', resourceGroup: 'bisteccare-ltd-prod' },
      ],
    }
    const mixedCaseRows = [
      costRow({ ResourceId: resId('microsoft.compute/virtualmachines', 'vm-a'), Cost: 10 }),
      costRow({ ResourceId: resId('microsoft.compute/virtualmachines', 'vm-b'), Cost: 3 }),
    ]
    const rollup = rollupCostByResourceGroup(mixedCaseRows, mixedCaseInventory)
    expect(rollup).toHaveLength(1)
    expect(rollup[0].total_cost_usd).toBe(13)
    expect(rollup[0].resource_count).toBe(2)
  })

  // Same casing-collision bug, confirmed in the same real audit for tags —
  // e.g. "Environment"/"environment" and "Owner"/"owner" recorded with
  // different casing across resources.
  it('merges tag key/value pairs that differ only by casing across resources', () => {
    const mixedCaseInventory: InventoryDataRaw = {
      total_resources: 2,
      by_type: {},
      resources: [
        { name: 'vm-a', type: 'x', tags: { Environment: 'Prod' } },
        { name: 'vm-b', type: 'x', tags: { environment: 'prod' } },
      ],
    }
    const mixedCaseRows = [
      costRow({ ResourceId: resId('microsoft.compute/virtualmachines', 'vm-a'), Cost: 10 }),
      costRow({ ResourceId: resId('microsoft.compute/virtualmachines', 'vm-b'), Cost: 3 }),
    ]
    const rollup = rollupCostByTag(mixedCaseRows, mixedCaseInventory)
    expect(rollup).toHaveLength(1)
    expect(rollup[0].total_cost_usd).toBe(13)
    expect(rollup[0].resource_count).toBe(2)
  })
})

describe('forecastCost', () => {
  it('returns null without enough daily history', () => {
    const rows = [costRow({ Cost: 1, UsageDate: 20260101 })]
    expect(forecastCost(rows)).toBeNull()
  })

  it('projects a flat run-rate for flat historical spend', () => {
    const rows: CostRow[] = []
    for (let d = 1; d <= 20; d++) rows.push(costRow({ Cost: 10, UsageDate: 20260100 + d }))
    const forecast = forecastCost(rows)
    expect(forecast).not.toBeNull()
    expect(forecast!.historical_daily_avg_usd).toBe(10)
    expect(forecast!.run_rate_next_30_days_usd).toBe(300)
  })
})

describe('detectReservedInstanceCandidates', () => {
  it('flags a resource with consistently high, low-variance daily cost', () => {
    const id = resId('microsoft.web/serverfarms', 'stable-plan')
    const rows: CostRow[] = []
    for (let d = 1; d <= 70; d++) rows.push(costRow({ ResourceId: id, Cost: 10, UsageDate: 20260100 + d }))
    const candidates = detectReservedInstanceCandidates(rows)
    expect(candidates.find(c => c.resource_name === 'stable-plan')).toBeTruthy()
  })

  it('does not flag a spiky resource even with a high average', () => {
    const id = resId('microsoft.web/serverfarms', 'spiky-plan')
    const rows: CostRow[] = []
    for (let d = 1; d <= 70; d++) rows.push(costRow({ ResourceId: id, Cost: d % 2 === 0 ? 1 : 40, UsageDate: 20260100 + d }))
    expect(detectReservedInstanceCandidates(rows).find(c => c.resource_name === 'spiky-plan')).toBeFalsy()
  })
})
