import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url) {
      return NextResponse.json({ error: "No URL provided" }, { status: 400 });
    }

    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 EPUBify/1.0" } });
    if (!response.ok) {
        return NextResponse.json({ error: "Failed to fetch URL" }, { status: response.status });
    }
    const html = await response.text();
    const $ = cheerio.load(html);
    
    // Strip common non-content elements
    $("nav, footer, .ad, header, iframe, script, style, aside, .sidebar").remove();
    
    const title = $("title").text() || $("h1").first().text() || "Extracted URL";
    
    let content = $("article").html() || $("main").html() || $(".content").html();
    
    if (!content) {
        content = $("body").html();
    }

    // Inline images as data URIs to make EPUB content self-contained.
    const contentDom = cheerio.load(content || "");
    const imgElements = contentDom("img");

    await Promise.all(imgElements.toArray().map(async (el) => {
        const $img = contentDom(el);
        const src = $img.attr("src");
        if (!src || src.startsWith("data:")) return;

        let resolvedUrl;
        try {
            resolvedUrl = new URL(src, url).href;
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

            // Remove srcset to avoid external references after conversion.
            $img.removeAttr("srcset");
        } catch {
            // ignore fetch errors and keep original url
        }
    }));

    content = contentDom.html();
    
    return NextResponse.json({ title, content });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message || "Failed to extract URL" }, { status: 500 });
  }
}
