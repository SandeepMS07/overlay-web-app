/**
 * Turns a pasted or dropped image into something safe to put in a request body.
 *
 * A macOS screenshot off a Retina display is roughly 3000×2000 and several
 * megabytes; base64 adds a third on top of that. Sending it raw would mean a
 * multi-megabyte upload per turn, and every provider downscales beyond a
 * ~1500px long edge anyway, so the extra pixels buy nothing but latency.
 */

/**
 * Anthropic's documented ceiling, and close enough to OpenAI's and Gemini's
 * tiling limits that one number serves all three.
 */
const MAX_EDGE = 1568;

/**
 * JPEG rather than PNG. Screenshots are the common case here and they are
 * mostly text, which PNG stores faithfully and enormously; at this quality the
 * text stays legible to a vision model at a fraction of the size.
 */
const QUALITY = 0.92;

/** Reject anything the vision endpoints will not take. */
export function isSupportedImage(type: string): boolean {
  return /^image\/(png|jpe?g|gif|webp)$/i.test(type);
}

/** A `data:image/jpeg;base64,…` URL, downscaled to fit MAX_EDGE. */
export async function toAttachment(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not read the image.');

  // JPEG has no alpha, and an unpainted canvas is transparent black — which
  // would come out as a black background behind anything with transparency.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return canvas.toDataURL('image/jpeg', QUALITY);
}

/** Images pulled out of a paste or drop event, already downscaled. */
export async function attachmentsFrom(items: DataTransfer | null): Promise<string[]> {
  if (!items) return [];
  const files = Array.from(items.items)
    .filter((item) => item.kind === 'file' && isSupportedImage(item.type))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);

  return Promise.all(files.map(toAttachment));
}
