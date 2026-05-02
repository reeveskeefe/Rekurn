import { availableParallelism } from 'node:os'

export function defaultFileConcurrency(): number {
  return Math.max(1, Math.min(8, availableParallelism()))
}

export async function mapLimit<T, R>(
  items: Iterable<T>,
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const source = [...items]
  if (source.length === 0) return []

  const limit = Math.max(1, Math.min(concurrency, source.length))
  const results = new Array<R>(source.length)
  let next = 0

  async function run(): Promise<void> {
    while (next < source.length) {
      const index = next++
      results[index] = await worker(source[index]!, index)
    }
  }

  await Promise.all(Array.from({ length: limit }, () => run()))
  return results
}
