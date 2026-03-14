/**
 * Shared stream reading utilities for `@quill/proteus`.
 *
 * @internal
 */

/**
 * Read a `ReadableStream<Uint8Array>` into a string with a size limit.
 *
 * @param stream - The stream to read.
 * @param maxSize - Maximum allowed size in bytes.
 * @param onSizeExceeded - Callback for when the limit is reached.
 * @returns The decoded string.
 * @throws {Error} if the size limit is exceeded.
 */
export async function readStreamToString(
  stream: ReadableStream<Uint8Array>,
  maxSize: number,
  onSizeExceeded: (received: number) => Error,
): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      received += value.byteLength;
      if (received > maxSize) {
        throw onSizeExceeded(received);
      }
      chunks.push(value);
    }

    const merged = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return new TextDecoder().decode(merged);
  } catch (err) {
    reader.cancel();
    throw err;
  }
}
