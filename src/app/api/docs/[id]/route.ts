import { findDoc, readDocSource, readDocText } from '@/lib/docs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One document, for reading rather than for the model.
 *
 * Serves the original upload when it was kept — a PDF goes to Chromium's own
 * viewer, which is far better than anything worth writing here. `?text=1`, and
 * anything stored before originals were kept, returns the extracted text
 * instead: that is also the honest view of what the model is working from.
 */
export async function GET(request: Request, ctx: RouteContext<'/api/docs/[id]'>) {
  const { id } = await ctx.params;
  const doc = await findDoc(id);
  if (!doc) return new Response('Not found', { status: 404 });

  const wantsText = new URL(request.url).searchParams.get('text') === '1';

  if (!wantsText) {
    const source = await readDocSource(id);
    if (source) {
      // Copied into a fresh ArrayBuffer: a Uint8Array over Node's pooled
      // Buffer memory is not a BodyInit the types will accept.
      return new Response(source.slice().buffer as ArrayBuffer, {
        headers: {
          'Content-Type': doc.mime || 'application/octet-stream',
          // inline, so the PDF renders in place instead of downloading.
          'Content-Disposition': `inline; filename="${encodeURIComponent(doc.name)}"`,
          'Cache-Control': 'no-store',
        },
      });
    }
  }

  const text = await readDocText(id);
  if (text === null) return new Response('Not found', { status: 404 });
  return new Response(text, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
