import Link from 'next/link';
import { cn } from '@/lib/utils';
import { PageContainer } from '@/features/dashboard/components/PageContainer';
import { label } from '../lib/format';

const GREEN = ['active', 'published', 'approved', 'confirmed', 'checked_in', 'completed', 'checked_out', 'delivered', 'signed', 'done', 'ok', 'applied', 'paid', 'dispensed', 'administered', 'verified', 'resolved', 'released', 'ready', 'booked', 'rendered', 'accepted', 'satisfied', 'discharged', 'closed', 'available']
const AMBER = ['pending', 'requested', 'draft', 'open', 'scheduled', 'in_room', 'in_progress', 'in_treatment', 'waiting', 'sent', 'queued', 'leased', 'unknown', 'paused', 'unverified', 'investigating', 'partially_paid', 'held', 'transferring', 'pending_signature', 'ordered', 'due', 'admitted', 'in_care', 'monitoring', 'recovery', 'ready_for_discharge', 'proposed', 'partly_accepted', 'recording', 'transcribing', 'drafted', 'received', 'validated', 'applying', 'pending_render']
const BLUE = ['expired', 'superseded', 'waived', 'withdrawn', 'cancelled_by_client', 'suppressed', 'transferred', 'discarded', 'reversed']
const RED = ['rejected', 'cancelled', 'failed', 'dead', 'revoked', 'suspended', 'surrendered', 'no_show', 'overdue', 'deceased', 'killed', 'blocked', 'retired', 'denied', 'urgent', 'voided', 'lapsed', 'skipped', 'quarantined']
const DOT: Record<string, string> = Object.fromEntries([
  ...GREEN.map(v => [v, 'bg-emerald-500']), ...AMBER.map(v => [v, 'bg-amber-500']), ...BLUE.map(v => [v, 'bg-blue-500']), ...RED.map(v => [v, 'bg-red-500']),
])

export function Status({ value, className }: { value?: string | null; className?: string }) {
  if (!value) return null;
  return (
    <span className={cn('inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-wide', className)}>
      <span className={cn('size-2 shrink-0 rounded-full', DOT[value] || 'bg-muted-foreground/50')} />
      {label(value)}
    </span>
  );
}

export function Page({ title, crumbs = [], children }: { title: string; crumbs?: { label: string; href?: string }[]; children: React.ReactNode }) {
  return (
    <PageContainer
      title={title}
      breadcrumbs={[{ type: 'link', label: 'Dashboard', href: '/dashboard' }, ...crumbs.map((c) => ({ type: (c.href ? 'link' : 'page') as 'link' | 'page', label: c.label, href: c.href })), { type: 'page', label: title }]}
      header={<h1 className="text-xl font-semibold tracking-tight">{title}</h1>}
    >
      <div className="min-w-0 space-y-6 px-4 pb-28 md:px-6">{children}</div>
    </PageContainer>
  );
}

export function Tabs({ items, active }: { items: { key: string; label: string; href: string; count?: number }[]; active: string }) {
  return (
    <div className="max-w-full overflow-x-auto">
      <div className="inline-flex gap-1 rounded-lg bg-muted p-1">
        {items.map((i) => (
          <Link key={i.key} href={i.href} className={cn('whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium', i.key === active ? 'bg-background shadow-sm' : 'text-muted-foreground')}>
            {i.label}{i.count !== undefined ? <span className="ml-1.5 font-mono text-xs text-muted-foreground">{i.count}</span> : null}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="min-w-0 space-y-3">
      <div className="flex items-center justify-between gap-3 border-b pb-2">
        <h2 className="font-mono text-xs uppercase tracking-wide text-muted-foreground">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Row({ children, href, className }: { children: React.ReactNode; href?: string; className?: string }) {
  const cls = cn('flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b py-3 text-sm last:border-b-0', href && 'hover:bg-muted/40', className);
  return href ? <Link href={href} className={cls}>{children}</Link> : <div className={cls}>{children}</div>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-sm text-muted-foreground">{children}</p>;
}

export function Stat({ name, value }: { name: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-xs uppercase tracking-wide text-muted-foreground">{name}</div>
      <div className="mt-1 break-words text-lg font-semibold">{value}</div>
    </div>
  );
}

export const Meta = ({ children }: { children: React.ReactNode }) => <span className="block min-w-0 break-words text-xs text-muted-foreground">{children}</span>;
