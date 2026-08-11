/**
 * Shared utility for CSV / PDF export with native + web fallbacks.
 * - Web: triggers browser download (CSV) or window.print (PDF via HTML)
 * - Native: writes to cache + shares via expo-sharing; PDF via expo-print
 */
import { Alert, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';

// --- CSV helpers ---
export function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function rowsToCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(csvEscape).join(',')];
  for (const r of rows) lines.push(r.map(csvEscape).join(','));
  return lines.join('\n');
}

// --- Web helpers ---
function webDownload(content: string, filename: string, mime: string) {
  const w: any = typeof window !== 'undefined' ? window : null;
  if (!w) return;
  const blob = new w.Blob([content], { type: `${mime};charset=utf-8;` });
  const url = w.URL.createObjectURL(blob);
  const a = w.document.createElement('a');
  a.href = url; a.download = filename;
  w.document.body.appendChild(a);
  a.click();
  w.document.body.removeChild(a);
  setTimeout(() => w.URL.revokeObjectURL(url), 1000);
}

function webPrint(html: string) {
  const w: any = typeof window !== 'undefined' ? window : null;
  if (!w) return;
  const printWin = w.open('', '_blank', 'noopener,noreferrer,width=780,height=900');
  if (!printWin) {
    Alert.alert('Popup blocked', 'Please allow pop-ups to print.');
    return;
  }
  printWin.document.open();
  printWin.document.write(html);
  printWin.document.close();
  setTimeout(() => {
    try { printWin.focus(); printWin.print(); } catch {}
  }, 400);
}

// --- Public API ---
export async function shareCsv(csv: string, filename: string) {
  // Prepend UTF-8 BOM so Excel on Windows renders currency symbols like ₹ correctly.
  const csvWithBom = '\uFEFF' + csv;
  if (Platform.OS === 'web') { webDownload(csvWithBom, filename, 'text/csv'); return; }
  try {
    const file = new (FileSystem as any).File((FileSystem as any).Paths.cache, filename);
    try { file.create({ overwrite: true }); } catch {}
    file.write(csvWithBom);
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: filename, UTI: 'public.comma-separated-values-text' });
    } else {
      Alert.alert('Saved', `CSV saved to ${file.uri}`);
    }
  } catch (e: any) { Alert.alert('Export failed', e.message || String(e)); }
}

export async function sharePdf(html: string, filename: string) {
  if (Platform.OS === 'web') { webPrint(html); return; }
  try {
    const { uri } = await Print.printToFileAsync({ html });
    // Rename cached file to a friendlier name
    let finalUri = uri;
    try {
      const nice = (FileSystem as any).Paths.cache.uri + filename;
      const src = new (FileSystem as any).File(uri);
      src.move({ uri: nice });
      finalUri = nice;
    } catch {
      // Fallback: share the raw uri
    }
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(finalUri, { mimeType: 'application/pdf', dialogTitle: filename, UTI: 'com.adobe.pdf' });
    } else {
      Alert.alert('Saved', `PDF saved to ${finalUri}`);
    }
  } catch (e: any) { Alert.alert('PDF failed', e.message || String(e)); }
}

export async function printOrShareHtml(html: string, filename: string) {
  if (Platform.OS === 'web') {
    webPrint(html);
    return;
  }
  try {
    // On native, use expo-print's system print dialog if available, else share as PDF
    await Print.printAsync({ html });
  } catch (e: any) {
    // Fallback: create PDF and share
    await sharePdf(html, filename);
  }
}

// --- HTML report builder ---
export function buildReportHtml(opts: {
  title: string;
  subtitle?: string;
  brand?: { name?: string; color?: string; logo?: string | null; };
  summary?: { label: string; value: string }[];
  columns: string[];
  rows: (string | number)[][];
  totalRow?: (string | number)[];
  footer?: string;
}): string {
  const brandColor = opts.brand?.color || '#C42032';
  const summaryHtml = (opts.summary || []).map(s => `
    <div class="stat">
      <div class="stat-label">${escapeHtml(s.label)}</div>
      <div class="stat-value">${escapeHtml(s.value)}</div>
    </div>`).join('');

  const thead = opts.columns.map(c => `<th>${escapeHtml(c)}</th>`).join('');
  const tbody = opts.rows.map(r => `<tr>${r.map(c => `<td>${escapeHtml(String(c ?? ''))}</td>`).join('')}</tr>`).join('');
  const tfoot = opts.totalRow ? `<tr class="total-row">${opts.totalRow.map(c => `<td>${escapeHtml(String(c ?? ''))}</td>`).join('')}</tr>` : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(opts.title)}</title>
<style>
  @page { size: A4; margin: 16mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1A1A1A; margin: 0; padding: 24px; background: #FDFCF9; }
  .header { border-bottom: 3px solid ${brandColor}; padding-bottom: 12px; margin-bottom: 20px; display: flex; align-items: center; gap: 16px; }
  .header .brand-block { flex: 1; }
  .header h1 { margin: 0; font-size: 22px; color: ${brandColor}; }
  .header .sub { color: #6B6862; font-size: 13px; margin-top: 4px; }
  .header .logo { width: 56px; height: 56px; border-radius: 8px; object-fit: contain; border: 1px solid #E8E5DA; }
  .stats { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
  .stat { border: 1px solid #E8E5DA; background: #fff; padding: 10px 14px; border-radius: 8px; min-width: 130px; }
  .stat-label { font-size: 10px; color: #6B6862; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; }
  .stat-value { font-size: 18px; font-weight: 800; color: #1A1A1A; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; margin-top: 8px; font-size: 12px; }
  th { background: ${brandColor}; color: #fff; padding: 10px 12px; text-align: left; font-weight: 700; letter-spacing: 0.3px; font-size: 12px; }
  td { padding: 10px 12px; border-bottom: 1px solid #F0EDE5; }
  tr:nth-child(even) td { background: #FBF9F4; }
  .total-row td { font-weight: 800; background: #FFF3EC !important; border-top: 2px solid ${brandColor}; }
  .footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #E8E5DA; font-size: 11px; color: #6B6862; text-align: center; }
  @media print { body { padding: 0; background: #fff; } }
</style></head><body>
<div class="header">
  ${opts.brand?.logo ? `<img class="logo" src="${opts.brand.logo}"/>` : ''}
  <div class="brand-block">
    <h1>${escapeHtml(opts.title)}</h1>
    ${opts.brand?.name ? `<div class="sub"><b>${escapeHtml(opts.brand.name)}</b>${opts.subtitle ? ' · ' + escapeHtml(opts.subtitle) : ''}</div>` : (opts.subtitle ? `<div class="sub">${escapeHtml(opts.subtitle)}</div>` : '')}
  </div>
</div>
${summaryHtml ? `<div class="stats">${summaryHtml}</div>` : ''}
<table>
  <thead><tr>${thead}</tr></thead>
  <tbody>${tbody}${tfoot}</tbody>
</table>
<div class="footer">Generated on ${new Date().toLocaleString('en-IN')} · Powered by ParlourPilot${opts.footer ? ' · ' + escapeHtml(opts.footer) : ''}</div>
</body></html>`;
}

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
