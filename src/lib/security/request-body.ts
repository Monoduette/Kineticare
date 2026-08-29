/**
 * A kérés-törzs beolvasása FELSŐ KORLÁTTAL.
 *
 * A deklarált `content-length` önmagában nem elég (hiányozhat, és chunked
 * átvitelnél kisebbet is hazudhat kifelé), ezért a TÉNYLEGES beolvasott
 * mennyiséget mérjük: a stream darabonként jön, és a korlát átlépésekor
 * azonnal megállunk — a maradék be sem kerül a memóriába.
 */

export async function readBodyBytesWithCap(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) {
    return null
  }
  const stream = request.body
  if (stream === null) {
    return new Uint8Array(new ArrayBuffer(0))
  }
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    if (value !== undefined) {
      total += value.byteLength
      if (total > maxBytes) {
        // A maradékot nem olvassuk tovább — a kapcsolat a hívó dolga.
        void reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
  }
  const merged = new Uint8Array(new ArrayBuffer(total))
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

export async function readBodyWithCap(request: Request, maxBytes: number): Promise<string | null> {
  const bytes = await readBodyBytesWithCap(request, maxBytes)
  return bytes === null ? null : new TextDecoder().decode(bytes)
}
