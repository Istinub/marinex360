// D-037: bank details for the PDF footer — single config value, SG-only MVP scope.
export const BANK_DETAILS = process.env.INVOICE_BANK_DETAILS
  ?? 'Bank: [TODO-BANK-DETAILS] · Account: [TODO] · SWIFT: [TODO]';
