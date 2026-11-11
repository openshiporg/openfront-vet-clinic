import { addBusinessDays, addDays, type CalendarSpec } from '../lib/calendar'

/**
 * The two federal clocks on a theft, loss or count difference (21 CFR 1301.76(b)): written notice to the DEA
 * Field Division within one business day of discovery, then Form 106 within 45 days. The notice day counts
 * business days on the location's own calendar, so a Friday discovery is due Monday and a holiday is skipped.
 */
export function discrepancyDeadlines(calendar: CalendarSpec, discoveredOn: string, rules: { theftLossNoticeBusinessDays: number; form106Days: number }) {
  return { noticeDueOn: addBusinessDays(calendar, discoveredOn, rules.theftLossNoticeBusinessDays), form106DueOn: addDays(discoveredOn, rules.form106Days) }
}

/** An order form (DEA Form 222 or CSOS) is valid for 60 days from the day it was issued. */
export const ORDER_FORM_VALID_DAYS = 60
export const orderFormExpiry = (issuedOn: string) => addDays(issuedOn, ORDER_FORM_VALID_DAYS)
