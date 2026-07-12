import { NextRequest } from 'next/server'
import { requireAuth, requireRole } from '../middleware/auth'
import { listOpenDataGapsController } from '../controllers/dataGaps'
import { unauthorized, forbidden, ok } from '../utils/response'

// Same access as running Analyze itself (admin/analyst) — this exposes what
// the analysis agent couldn't verify, which is an internal data-collection
// detail, not a finding a viewer needs.
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth) return unauthorized()
  if (!requireRole(auth, ['admin', 'analyst'])) return forbidden()

  const result = await listOpenDataGapsController()
  return ok(result.data)
}
