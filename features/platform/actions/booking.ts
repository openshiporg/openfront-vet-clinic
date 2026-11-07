'use server';

import { keystoneClient } from '@/features/dashboard/lib/keystoneClient';

/**
 * Reads the booking panel needs. Both go through GraphQL with the signed-in session, so list access
 * and the read audit apply exactly as on the screens.
 */

export type Slot = { startsAt: string; endsAt: string; providerName: string; resourceName: string; slotToken: string };

export async function searchSlots(locationId: string, appointmentTypeId: string, from: string) {
  const res = await keystoneClient<{ searchAvailability: { slots: Slot[]; appointmentType: { requestOnly: boolean } } }>(
    `query S($loc: ID!, $type: ID!, $from: String) { searchAvailability(locationId: $loc, appointmentTypeId: $type, from: $from, days: 7, limit: 24) }`,
    { loc: locationId, type: appointmentTypeId, from },
  );
  if (!res.success) return { ok: false as const, error: res.error || 'Search failed' };
  return { ok: true as const, slots: res.data?.searchAvailability.slots ?? [], requestOnly: res.data?.searchAvailability.appointmentType.requestOnly ?? false };
}

export type ClientHit = { id: string; ref: string; displayName: string; patients: { id: string; name: string; status: string }[] };

export async function findClients(text: string) {
  const t = text.trim();
  if (t.length < 2) return { ok: true as const, clients: [] as ClientHit[] };
  const digits = t.replace(/\D/g, '');
  const res = await keystoneClient<{ clients: { id: string; ref: string; displayName: string; ownerships: { patient: { id: string; name: string; status: string } | null }[] }[] }>(
    `query F($t: String!, $d: String!) {
      clients(where: { OR: [{ displayName: { contains: $t, mode: insensitive } }, { ref: { equals: $t } }, { people: { some: { contactPoints: { some: { value: { contains: $d } } } } } }] , status: { in: ["active", "prospect"] } }, take: 8, orderBy: { displayName: asc }) {
        id ref displayName ownerships(where: { effectiveTo: null }) { patient { id name status } }
      }
    }`,
    { t, d: digits.length >= 4 ? digits : '__none__' },
  );
  if (!res.success) return { ok: false as const, error: res.error || 'Search failed' };
  return {
    ok: true as const,
    clients: (res.data?.clients ?? []).map(c => ({ id: c.id, ref: c.ref, displayName: c.displayName, patients: c.ownerships.flatMap(o => (o.patient ? [o.patient] : [])) })),
  };
}
