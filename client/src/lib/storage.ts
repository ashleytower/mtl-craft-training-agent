/**
 * Client-side storage helper for uploading files to S3
 * Note: This is a placeholder. In the actual implementation,
 * we'll use tRPC mutation from the component directly.
 */

export async function storagePut(
  key: string,
  data: Uint8Array | ArrayBuffer,
  contentType: string
): Promise<{ url: string; key: string }> {
  // Convert data to base64 for transmission
  const buffer = data instanceof Uint8Array ? data : new Uint8Array(data);
  const base64 = btoa(String.fromCharCode.apply(null, Array.from(buffer)));

  // Call tRPC endpoint
  const response = await fetch('/api/trpc/storage.upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      json: {
        key,
        data: base64,
        contentType,
      },
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to upload file');
  }

  const result = await response.json();
  return result.result.data.json;
}
