import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export interface ExportableFinding {
  severity: string
  category: string
  resource_type: string
  resource_name: string
  issue: string
  recommendation: string
}

export interface ExportMeta {
  auditId: string
  scopeLabel: string
  summary: string
  generatedAt: string
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function csvCell(v: string): string {
  return `"${v.replace(/"/g, '""')}"`
}

export function exportFindingsAsCSV(findings: ExportableFinding[], meta: ExportMeta) {
  const header = ['Severity', 'Category', 'Resource Type', 'Resource Name', 'Issue', 'Recommendation']
  const rows = findings.map(f => [f.severity, f.category, f.resource_type, f.resource_name, f.issue, f.recommendation])
  const csv = [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  triggerDownload(blob, `audit-${meta.auditId.slice(0, 8)}-${meta.scopeLabel.replace(/\s+/g, '-')}.csv`)
}

export function exportFindingsAsPDF(findings: ExportableFinding[], meta: ExportMeta) {
  const doc = new jsPDF()

  doc.setFontSize(14)
  doc.text(`Azure Audit Analysis — ${meta.scopeLabel}`, 14, 16)
  doc.setFontSize(9)
  doc.setTextColor(100)
  doc.text(`Audit ${meta.auditId} · Generated ${new Date(meta.generatedAt).toLocaleString()}`, 14, 22)

  let y = 30
  if (meta.summary) {
    doc.setFontSize(10)
    doc.setTextColor(30)
    const lines = doc.splitTextToSize(meta.summary, 180)
    doc.text(lines, 14, y)
    y += lines.length * 5 + 6
  }

  autoTable(doc, {
    startY: y,
    head: [['Severity', 'Resource Type', 'Resource Name', 'Issue', 'Recommendation']],
    body: findings.map(f => [f.severity, f.resource_type, f.resource_name, f.issue, f.recommendation]),
    styles: { fontSize: 8, cellWidth: 'wrap' },
    columnStyles: { 3: { cellWidth: 45 }, 4: { cellWidth: 45 } },
    headStyles: { fillColor: [124, 58, 237] },
  })

  doc.save(`audit-${meta.auditId.slice(0, 8)}-${meta.scopeLabel.replace(/\s+/g, '-')}.pdf`)
}
