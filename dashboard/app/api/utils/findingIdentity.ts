// Cross-audit identity for a finding. Deliberately EXCLUDES category and the
// raw resource_name display text — both drift between audits for the exact
// same underlying issue (confirmed in production: the same Cosmos DB's
// "highest cost resource" observation was categorized "Cost Waste" twice and
// "Governance" once across three audits a day apart; a multi-resource
// finding's resource_name is sometimes "acrx" alone and sometimes "acrx, acry,
// acrz" depending on how the model grouped it that run). Both used to be part
// of the key, which caused the old finding to look "resolved" and a
// duplicate "new" one to be inserted every time either drifted — inflating
// the dashboard's "$ Saved" figure with fake resolutions for resources that
// were never actually touched. affected_resources is the model's structured,
// intentionally-stable list for this — sorted so grouping-order differences
// don't matter — falling back to resource_name only when a finding has no
// affected_resources at all.
//
// Pulled into its own module (no DB/pool imports) so it stays trivially
// unit-testable — see findingIdentity.test.ts.
export function resourceIdentity(f: { resource_name?: string | null; affected_resources?: string[] | null }): string {
  if (f.affected_resources && f.affected_resources.length > 0) {
    return f.affected_resources.map(r => r.trim().toLowerCase()).sort().join(',')
  }
  return (f.resource_name || '').trim().toLowerCase()
}

export function findingKey(f: { resource_type?: string | null; resource_name?: string | null; affected_resources?: string[] | null }): string {
  const norm = (s?: string | null) => (s || '').trim().toLowerCase()
  return `${norm(f.resource_type)}|${resourceIdentity(f)}`
}
