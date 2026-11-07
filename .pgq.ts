import { PrismaClient } from '@prisma/client'
const p = new PrismaClient({ datasourceUrl: process.env.U, log: [] })
;(async()=>{ try { console.log(await p.$queryRawUnsafe(process.env.Q!)) } catch (e:any) { console.log('ERR', e.message.split('\n').slice(-2).join(' ')) } await p.$disconnect() })()
