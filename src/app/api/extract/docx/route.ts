import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ buffer: Buffer.from(buffer) });
    
    return NextResponse.json({ html: result.value });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to parse DOCX" }, { status: 500 });
  }
}
