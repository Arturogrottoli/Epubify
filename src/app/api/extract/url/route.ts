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
    
    return NextResponse.json({ title, content });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message || "Failed to extract URL" }, { status: 500 });
  }
}
