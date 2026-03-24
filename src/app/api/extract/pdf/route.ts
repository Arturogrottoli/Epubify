import { NextRequest, NextResponse } from "next/server";
import pdf from "pdf-parse";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const data = await pdf(Buffer.from(buffer));
    
    // We replace multiple newlines with double newline to keep paragraphs vaguely spaced.
    const text = data.text.replace(/\n\s*\n/g, '\n\n');
    
    return NextResponse.json({ text });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message || "Failed to parse PDF" }, { status: 500 });
  }
}
