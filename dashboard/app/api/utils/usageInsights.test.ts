import { describe, it, expect } from 'vitest'
import { detectIdleResources, compareUsagePeriods } from './usageInsights'
import { UsageMetricRaw } from '../types'

const SUB = '/subscriptions/sub/resourcegroups/rg-test/providers'

function metric(over: Partial<UsageMetricRaw>): UsageMetricRaw {
  return { resource_id: '', metric_name: '', unit: 'Percent', data_points: [], ...over }
}

describe('detectIdleResources', () => {
  it('flags a Cosmos DB account under the RU-consumption threshold', () => {
    const metrics = [
      metric({
        resource_id: `${SUB}/microsoft.documentdb/databaseaccounts/cosmos-idle`,
        metric_name: 'NormalizedRUConsumption',
        summary: { avg: 4, total: null },
      }),
    ]
    const findings = detectIdleResources(metrics)
    expect(findings).toHaveLength(1)
    expect(findings[0].resource_name).toBe('cosmos-idle')
    expect(findings[0].resource_type).toBe('cosmosdb')
  })

  it('does not flag a Cosmos DB account above the threshold', () => {
    const metrics = [
      metric({
        resource_id: `${SUB}/microsoft.documentdb/databaseaccounts/cosmos-busy`,
        metric_name: 'NormalizedRUConsumption',
        summary: { avg: 45, total: null },
      }),
    ]
    expect(detectIdleResources(metrics)).toHaveLength(0)
  })

  it('flags an App Service Plan on CPU% independently of Memory%', () => {
    const metrics = [
      metric({
        resource_id: `${SUB}/microsoft.web/serverfarms/plan-a`,
        metric_name: 'CpuPercentage',
        summary: { avg: 2, total: null },
      }),
    ]
    const findings = detectIdleResources(metrics)
    expect(findings).toHaveLength(1)
    expect(findings[0].reason).toMatch(/CPU/)
  })

  it('ignores resource types with no idle rule defined (e.g. Public IP)', () => {
    const metrics = [
      metric({
        resource_id: `${SUB}/microsoft.network/publicipaddresses/pip-a`,
        metric_name: 'BytesInDDoS',
        summary: { avg: 0, total: 0 },
      }),
    ]
    expect(detectIdleResources(metrics)).toHaveLength(0)
  })

  it('ignores metrics that have no matching rule for their resource type', () => {
    const metrics = [
      metric({
        resource_id: `${SUB}/microsoft.documentdb/databaseaccounts/cosmos-a`,
        metric_name: 'SomeUnrelatedMetric',
        summary: { avg: 0, total: 0 },
      }),
    ]
    expect(detectIdleResources(metrics)).toHaveLength(0)
  })
})

describe('compareUsagePeriods', () => {
  const id = `${SUB}/microsoft.documentdb/databaseaccounts/cosmos-a`

  it('returns [] when there is no prior period to compare against', () => {
    expect(compareUsagePeriods([metric({ resource_id: id, metric_name: 'NormalizedRUConsumption' })], null)).toHaveLength(0)
    expect(compareUsagePeriods([metric({ resource_id: id, metric_name: 'NormalizedRUConsumption' })], [])).toHaveLength(0)
  })

  it('reports a delta that crosses the minimum-absolute-move threshold', () => {
    const current = [metric({ resource_id: id, metric_name: 'NormalizedRUConsumption', summary: { avg: 6, total: null } })]
    const previous = [metric({ resource_id: id, metric_name: 'NormalizedRUConsumption', summary: { avg: 40, total: null } })]
    const deltas = compareUsagePeriods(current, previous)
    expect(deltas).toHaveLength(1)
    expect(deltas[0].current_avg).toBe(6)
    expect(deltas[0].previous_avg).toBe(40)
    expect(deltas[0].delta).toBe(-34)
  })

  it('ignores moves smaller than the minimum absolute threshold', () => {
    const current = [metric({ resource_id: id, metric_name: 'NormalizedRUConsumption', summary: { avg: 40, total: null } })]
    const previous = [metric({ resource_id: id, metric_name: 'NormalizedRUConsumption', summary: { avg: 42, total: null } })]
    expect(compareUsagePeriods(current, previous)).toHaveLength(0)
  })

  it('ignores a metric that only exists in one of the two periods', () => {
    const current = [metric({ resource_id: id, metric_name: 'NormalizedRUConsumption', summary: { avg: 6, total: null } })]
    const previous = [metric({ resource_id: id, metric_name: 'TotalRequestUnits', summary: { avg: 0, total: 0 } })]
    expect(compareUsagePeriods(current, previous)).toHaveLength(0)
  })
})
