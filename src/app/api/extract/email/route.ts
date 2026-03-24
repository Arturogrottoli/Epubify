import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";

async function inlineImages(html: string, baseUrl: string): Promise<string> {
  const dom = cheerio.load(html);
  const imgElements = dom("img");

  await Promise.all(imgElements.toArray().map(async (el) => {
    const $img = dom(el);
    const src = $img.attr("src");
    if (!src || src.startsWith("data:")) return;

    let resolvedUrl;
    try {
      resolvedUrl = new URL(src, baseUrl).href;
    } catch {
      return;
    }

    try {
      const imgResp = await fetch(resolvedUrl, { headers: { "User-Agent": "Mozilla/5.0 EPUBify/1.0" } });
      if (!imgResp.ok) return;

      const contentType = imgResp.headers.get("content-type") || "image/png";
      if (!contentType.startsWith("image/")) return;

      const arrayBuffer = await imgResp.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, Math.min(i + chunkSize, bytes.length))));
      }
      const base64 = Buffer.from(binary, "binary").toString("base64");
      $img.attr("src", `data:${contentType};base64,${base64}`);
      $img.removeAttr("srcset");
    } catch {
      // fallback keep original src
    }
  }));

  return dom.html();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const subject = (body.subject || "Newsletter Email").trim();
    const html = (body.html || "").trim();
    const text = (body.text || "").trim();

    if (!html && !text) {
      return NextResponse.json({ error: "No email content provided" }, { status: 400 });
    }

    let content = html;
    if (!content && text) {
      content = text
        .split(/\r?\n+/)
        .filter((line: string) => line.trim() !== "")
        .map((line: string) => `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`)
        .join("\n");
    }

    if (content) {
      // Sanitize and preserve relevant sections
      const $ = cheerio.load(content);
      $("script, style, iframe, nav, footer, header, .ad, .sidebar").remove();
      content = $.html();
      content = await inlineImages(content, body.baseUrl || "");
    }

    return NextResponse.json({ title: subject || "Newsletter Email", content });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message || "Failed to parse email content" }, { status: 500 });
  }
}
