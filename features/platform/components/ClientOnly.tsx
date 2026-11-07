'use client';

import * as React from 'react';

/** Radix popovers derive ids that differ between SSR and hydration; render them after mount with a same-size placeholder. */
export function ClientOnly({ children, placeholder }: { children: React.ReactNode; placeholder: React.ReactNode }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  return <>{mounted ? children : placeholder}</>;
}
