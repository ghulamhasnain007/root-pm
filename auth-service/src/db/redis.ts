import { Redis } from 'ioredis'

export function connectRedis(url: string): Redis {
  return new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 3 })
}
