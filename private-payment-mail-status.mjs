// Keep new-price jobs queued until the Apps Script worker has been updated.
export function paymentMailStatus(report) {
  return report.packageId === 'custom' ? 'terms_pending' : [25,84,152].includes(report.amountUsd) ? 'pending' : 'pricing_pending';
}
