export function formatNumber(n: number): string {
  return n.toLocaleString()
}

export function shortId(id: string): string {
  return id.slice(0, 8)
}

export function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(' ')
}

export const statusConfig: Record<string, { label: string; color: string }> = {
  completed: { label: 'Completed', color: 'success' },
  running:   { label: 'Running',   color: 'info' },
  failed:    { label: 'Failed',    color: 'error' },
}

export const triggerConfig: Record<string, { label: string; color: string }> = {
  scheduled: { label: 'Scheduled', color: 'purple' },
  manual:    { label: 'Manual',    color: 'muted' },
}

export const roleConfig: Record<string, { label: string; color: string }> = {
  admin:   { label: 'Admin',   color: 'error' },
  analyst: { label: 'Analyst', color: 'info' },
  viewer:  { label: 'Viewer',  color: 'muted' },
}

export const severityConfig: Record<string, { label: string; color: string }> = {
  Critical: { label: 'Critical', color: 'error' },
  Warning:  { label: 'Warning',  color: 'warning' },
  Info:     { label: 'Info',     color: 'info' },
}
