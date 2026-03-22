import { NextRequest, NextResponse } from "next/server";
const pdf = require("pdf-parse");

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
    let text = data.text.replace(/\n\s*\n/g, '\n\n');
    
    return NextResponse.json({ text });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to parse PDF" }, { status: 500 });
  }
}
