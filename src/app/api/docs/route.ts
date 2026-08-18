import { NextResponse } from 'next/server';
import { DocError, addDoc, listDocs, reindexAll, removeDoc } from '@/lib/docs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ docs: await listDocs() });
}

export async function PUT() {
  // Re-chunk and re-embed everything; used after a chunking or model change.
  return NextResponse.json({ docs: await reindexAll() });
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected a file upload.' }, { status: 400 });
  }

  const files = form.getAll('file').filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: 'No file in the request.' }, { status: 400 });
  }

  // Import what can be imported and report the rest, so one unreadable file in
  // a multi-select does not throw away the others.
  const failed: string[] = [];
  for (const file of files) {
    try {
      await addDoc(file);
    } catch (err) {
      failed.push(err instanceof DocError ? err.message : `Could not read "${file.name}".`);
    }
  }

  const docs = await listDocs();
  if (failed.length === files.length) {
    return NextResponse.json({ error: failed.join(' '), docs }, { status: 400 });
  }
  return NextResponse.json({ docs, ...(failed.length ? { warning: failed.join(' ') } : {}) });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 });
  await removeDoc(id);
  return NextResponse.json({ docs: await listDocs() });
}
