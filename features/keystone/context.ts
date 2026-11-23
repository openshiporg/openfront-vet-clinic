import { getContext } from '@keystone-6/core/context'
import config from './index'
import { type Context } from '.keystone/types'
import * as PrismaModule from "@prisma/client";
import { pooledDatabaseUrl } from './database-url'

// Making sure multiple prisma clients are not created during hot reloading
export const keystoneContext: Context =
  (globalThis as any).keystoneContext ?? getContext({
    ...config,
    // Apply runtime connection policy at the actual client boundary too.
    db: { ...config.db, url: pooledDatabaseUrl(process.env.DATABASE_URL ?? config.db.url) },
  }, PrismaModule)

if (process.env.NODE_ENV !== 'production') {
  (globalThis as any).keystoneContext = keystoneContext
}