import { findOpenDataGaps } from '../models/dataGaps'

export async function listOpenDataGapsController() {
  const gaps = await findOpenDataGaps()
  return { data: gaps, status: 200 }
}
