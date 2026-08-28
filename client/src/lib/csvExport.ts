import type { ContactPerson } from "@shared/schema";

/**
 * Helper to escape a cell value for CSV:
 * - Replace double quotes with doubled double quotes
 * - Wrap in quotes
 */
export function escapeCSVCell(value: string | null | undefined): string {
  const str = value || '';
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Create a downloadable CSV blob with proper UTF-8 BOM encoding
 * for Excel compatibility with accented characters
 */
export function createCSVBlob(headers: string[], rows: (string | null | undefined)[][]): Blob {
  const headerRow = headers.map(h => escapeCSVCell(h)).join(',');
  const dataRows = rows.map(row => row.map(cell => escapeCSVCell(cell)).join(','));
  const csvContent = '\uFEFF' + [headerRow, ...dataRows].join('\n');
  return new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
}

/**
 * Download a blob as a file
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportToCSV(contacts: ContactPerson[], filename: string = "contacts.csv") {
  if (contacts.length === 0) return;
  
  const headers = ["Name", "Title", "Email", "Phone"];
  const rows = contacts.map(contact => [
    contact.name,
    contact.title,
    contact.email,
    contact.phone
  ]);
  
  const blob = createCSVBlob(headers, rows);
  downloadBlob(blob, filename);
}
