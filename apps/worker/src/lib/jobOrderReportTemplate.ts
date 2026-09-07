type Money = { amountMinor: number; currency: string };

type ReportJobOrder = {
  joNumber: string;
  branch: string;
  scopeSummary: string;
  serviceCategories: string[];
  quotedAmountMinor: number;
  quotedCurrency: string;
  state: string;
  client: { name: string };
  vessel: { name: string; imoNumber: string };
  statusHistory: { toState: string; at: Date; actor?: { name: string; email: string } | null; device?: { name: string | null; id: string } | null }[];
  checklistItems: { label: string; checked: boolean; sortOrder: number }[];
  observations: { body: string; createdAt: Date; authorId: string }[];
  photos: { s3Key: string | null; phase: string; takenAt: Date }[];
  materials: { description: string; quantity: unknown; unit: string; unitCostAmountMinor: number; unitCostCurrency: string }[];
  variations: { reason: string; status: string; amountMinor: number; amountCurrency: string }[];
  signature: { signerName: string | null; signerRole: string | null; signedAt: Date | null; imageS3Key: string | null; documentHash: string | null } | null;
};

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

function dateTime(value?: Date | null): string {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(value);
}

function money(value: Money): string {
  return `${value.currency} ${new Intl.NumberFormat('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value.amountMinor / 100)}`;
}

function section(title: string, rows: string): string {
  return `<section><h2>${escapeHtml(title)}</h2>${rows}</section>`;
}

function table(headers: string[], rows: string[][]): string {
  if (!rows.length) return '<p class="muted">None recorded.</p>';
  return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

export function renderJobOrderReportHtml(jobOrder: ReportJobOrder): string {
  const completed = [...jobOrder.statusHistory].reverse().find((entry) => entry.toState === 'COMPLETED');
  const submitted = [...jobOrder.statusHistory].reverse().find((entry) => entry.toState === 'PENDING_REVIEW');
  const technician = submitted?.actor?.name ?? submitted?.actor?.email ?? jobOrder.signature?.signerName ?? '-';
  const device = submitted?.device?.name ?? submitted?.device?.id ?? '-';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(jobOrder.joNumber)} completion report</title>
  <style>
    body { margin: 32px; color: #11202E; font-family: "IBM Plex Sans", Arial, sans-serif; font-size: 12px; }
    header { border-bottom: 2px solid #0B2A4A; margin-bottom: 20px; padding-bottom: 14px; }
    h1 { margin: 0 0 6px; color: #0B2A4A; font-size: 24px; }
    h2 { margin: 22px 0 8px; color: #0B2A4A; font-size: 14px; }
    .muted { color: #5C7081; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 18px; }
    .label { color: #5C7081; font-size: 10px; text-transform: uppercase; }
    .value { margin: 2px 0 0; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #D3DCE3; padding: 6px; text-align: left; vertical-align: top; }
    th { color: #5C7081; font-size: 10px; text-transform: uppercase; }
  </style>
</head>
<body>
  <header>
    <h1>Job Completion Report</h1>
    <p class="muted">${escapeHtml(jobOrder.joNumber)} · ${escapeHtml(jobOrder.state)}</p>
  </header>
  ${section('Job details', `<div class="grid">
    <div><div class="label">Client</div><p class="value">${escapeHtml(jobOrder.client.name)}</p></div>
    <div><div class="label">Vessel</div><p class="value">${escapeHtml(jobOrder.vessel.name)} (${escapeHtml(jobOrder.vessel.imoNumber)})</p></div>
    <div><div class="label">Branch</div><p class="value">${escapeHtml(jobOrder.branch)}</p></div>
    <div><div class="label">Currency</div><p class="value">${escapeHtml(jobOrder.quotedCurrency)}</p></div>
    <div><div class="label">Categories</div><p class="value">${escapeHtml(jobOrder.serviceCategories.join(', ') || '-')}</p></div>
    <div><div class="label">Quoted amount</div><p class="value">${escapeHtml(money({ amountMinor: jobOrder.quotedAmountMinor, currency: jobOrder.quotedCurrency }))}</p></div>
    <div style="grid-column: 1 / -1;"><div class="label">Scope</div><p class="value">${escapeHtml(jobOrder.scopeSummary)}</p></div>
  </div>`)}
  ${section('Completion', `<div class="grid">
    <div><div class="label">Completed</div><p class="value">${escapeHtml(dateTime(completed?.at))}</p></div>
    <div><div class="label">Submitted by</div><p class="value">${escapeHtml(technician)}</p></div>
    <div><div class="label">Device</div><p class="value">${escapeHtml(device)}</p></div>
    <div><div class="label">Signature</div><p class="value">${escapeHtml(jobOrder.signature?.signerName ?? '-')}</p></div>
  </div>`)}
  ${section('Checklist', table(['Item', 'Status'], jobOrder.checklistItems.map((item) => [escapeHtml(item.label), item.checked ? 'Checked' : 'Not checked'])))}
  ${section('Observations', table(['Observation', 'Added'], jobOrder.observations.map((item) => [escapeHtml(item.body), escapeHtml(dateTime(item.createdAt))])))}
  ${section('Photos', table(['Phase', 'Object key', 'Taken'], jobOrder.photos.map((item) => [escapeHtml(item.phase), escapeHtml(item.s3Key ?? '-'), escapeHtml(dateTime(item.takenAt))])))}
  ${section('Materials', table(['Description', 'Qty', 'Unit cost'], jobOrder.materials.map((item) => [
    escapeHtml(item.description),
    escapeHtml(`${Number(item.quantity)} ${item.unit}`),
    escapeHtml(money({ amountMinor: item.unitCostAmountMinor, currency: item.unitCostCurrency })),
  ])))}
  ${section('Variations', table(['Reason', 'Status', 'Amount'], jobOrder.variations.map((item) => [
    escapeHtml(item.reason),
    escapeHtml(item.status),
    escapeHtml(money({ amountMinor: item.amountMinor, currency: item.amountCurrency })),
  ])))}
</body>
</html>`;
}
