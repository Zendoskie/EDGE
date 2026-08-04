import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

type ExportRow = Record<string, string | number>;

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportEngagementAnalyticsToExcel(
  rows: ExportRow[],
  filename = `edge-engagement-analytics-${stamp()}.xlsx`,
) {
  const worksheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: 'No engagement data' }]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Engagement');
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  downloadBlob(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename,
  );
}

export function exportEngagementAnalyticsToPdf(
  rows: ExportRow[],
  summaryLines: string[],
  filename = `edge-engagement-analytics-${stamp()}.pdf`,
) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  doc.setFontSize(16);
  doc.text('EDGE — Engagement Analytics', 40, 36);
  doc.setFontSize(10);
  let y = 56;
  for (const line of summaryLines) {
    doc.text(line, 40, y);
    y += 14;
  }

  const headers = rows[0] ? Object.keys(rows[0]) : ['Note'];
  const body = rows.length
    ? rows.map((row) => headers.map((h) => String(row[h] ?? '')))
    : [['No engagement data']];

  autoTable(doc, {
    startY: y + 8,
    head: [headers],
    body,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [30, 64, 120] },
    margin: { left: 28, right: 28 },
  });

  doc.save(filename);
}
