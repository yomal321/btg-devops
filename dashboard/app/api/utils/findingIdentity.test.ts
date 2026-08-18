import { describe, it, expect } from 'vitest'
import { findingKey, resourceIdentity } from './findingIdentity'

describe('resourceIdentity', () => {
  it('falls back to resource_name when there are no affected_resources', () => {
    expect(resourceIdentity({ resource_name: 'my-vm', affected_resources: [] })).toBe('my-vm')
    expect(resourceIdentity({ resource_name: 'my-vm' })).toBe('my-vm')
  })

  it('prefers affected_resources over resource_name when both are present', () => {
    expect(resourceIdentity({ resource_name: 'display text', affected_resources: ['acr-a'] })).toBe('acr-a')
  })

  it('is grouping-order independent — same set of affected_resources in any order yields the same identity', () => {
    const a = resourceIdentity({ affected_resources: ['acr-z', 'acr-a', 'acr-m'] })
    const b = resourceIdentity({ affected_resources: ['acr-m', 'acr-z', 'acr-a'] })
    expect(a).toBe(b)
  })

  it('normalizes case and whitespace', () => {
    expect(resourceIdentity({ resource_name: '  My-VM  ' })).toBe('my-vm')
    expect(resourceIdentity({ affected_resources: [' AcrX ', 'AcrY'] })).toBe(resourceIdentity({ affected_resources: ['acrx', ' acry '] }))
  })
})

describe('findingKey', () => {
  // Regression test for the production bug this was built to fix: the same
  // resource (bisteccareltdprodacc002, still live and unchanged in Azure)
  // was categorized "Cost Waste" twice and "Governance" once across three
  // audits a day apart, which under the OLD key (resource_type + resource_name
  // + category) made the finding look "resolved" and re-created twice —
  // inflating the "$ Saved" dashboard card with fake resolutions.
  it('is stable across category drift for the same resource (the $ Saved bug)', () => {
    const auditOne = { resource_type: 'Cosmos DB Account', resource_name: 'bisteccareltdprodacc002', category: 'Cost Waste' }
    const auditTwo = { resource_type: 'Cosmos DB Account', resource_name: 'bisteccareltdprodacc002', category: 'Cost Waste' }
    const auditThree = { resource_type: 'Cosmos DB Account', resource_name: 'bisteccareltdprodacc002', category: 'Governance' }

    expect(findingKey(auditOne)).toBe(findingKey(auditTwo))
    expect(findingKey(auditOne)).toBe(findingKey(auditThree))
  })

  // Regression test for the other half of the same bug: a multi-resource
  // finding's resource_name is an LLM-generated display string that isn't
  // stable between audits (e.g. "acrx" alone in one run, "acrx, acry, acrz"
  // in another) — affected_resources is the model's structured field meant
  // to carry identity instead, and the key must actually use it.
  it('is stable across differently-grouped resource_name display text when affected_resources matches', () => {
    const grouped = {
      resource_type: 'Container Registry',
      resource_name: 'bcmobilenw, acrluminiiuksouth, bistecaishowcaseacr',
      affected_resources: ['bcmobilenw', 'acrluminiiuksouth', 'bistecaishowcaseacr'],
    }
    const singled = {
      resource_type: 'Container Registry',
      resource_name: 'acrluminiiuksouth',
      affected_resources: ['acrluminiiuksouth', 'bistecaishowcaseacr', 'bcmobilenw'],
    }
    expect(findingKey(grouped)).toBe(findingKey(singled))
  })

  it('still distinguishes genuinely different resources', () => {
    const a = { resource_type: 'Cosmos DB Account', resource_name: 'account-a' }
    const b = { resource_type: 'Cosmos DB Account', resource_name: 'account-b' }
    expect(findingKey(a)).not.toBe(findingKey(b))
  })

  it('distinguishes different resource types on the same resource name', () => {
    const a = { resource_type: 'Storage Account', resource_name: 'shared-name' }
    const b = { resource_type: 'Key Vault', resource_name: 'shared-name' }
    expect(findingKey(a)).not.toBe(findingKey(b))
  })
})
