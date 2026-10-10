import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { SafeFetchError, forEachLimited, safeFetch } from "@/lib/safe-fetch";

const USER_AGENT = "Mozilla/5.0 EPUBify/1.0";
const PAGE_MAX_BYTES = 5 * 1024 * 1024;
const PAGE_TIMEOUT_MS = 10_000;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 8_000;
const IMAGES_MAX_COUNT = 100;
const IMAGES_MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const IMAGES_TIME_BUDGET_MS = 30_000;
const IMAGES_CONCURRENCY = 6;

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "No URL provided" }, { status: 400 });
    }

    let response;
    try {
      response = await safeFetch(url, {
        headers: { "User-Agent": USER_AGENT },
        timeoutMs: PAGE_TIMEOUT_MS,
        maxBytes: PAGE_MAX_BYTES,
      });
    } catch (error) {
      const code = error instanceof SafeFetchError ? error.code : "NETWORK";
      if (code === "INVALID_URL" || code === "BLOCKED") {
        return NextResponse.json({ error: "Invalid or disallowed URL" }, { status: 400 });
      }
      return NextResponse.json({ error: "Failed to fetch URL" }, { status: 502 });
    }
    if (!response.ok) {
        return NextResponse.json({ error: "Failed to fetch URL" }, { status: 502 });
    }
    const html = response.body.toString("utf8");
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
    const imagesDeadline = Date.now() + IMAGES_TIME_BUDGET_MS;
    let imagesBytes = 0;

    await forEachLimited(imgElements.toArray().slice(0, IMAGES_MAX_COUNT), IMAGES_CONCURRENCY, async (el) => {
        const $img = contentDom(el);
        const src = $img.attr("src");
        if (!src || src.startsWith("data:")) return;

        let resolvedUrl;
        try {
            resolvedUrl = new URL(src, url).href;
        } catch {
            return;
        }

        const remainingMs = imagesDeadline - Date.now();
        if (remainingMs <= 0 || imagesBytes >= IMAGES_MAX_TOTAL_BYTES) return;

        try {
            const imgResp = await safeFetch(resolvedUrl, {
                headers: { "User-Agent": USER_AGENT },
                timeoutMs: Math.min(IMAGE_TIMEOUT_MS, remainingMs),
                maxBytes: Math.min(IMAGE_MAX_BYTES, IMAGES_MAX_TOTAL_BYTES - imagesBytes),
                acceptContentType: (type) => !type || type.startsWith("image/"),
            });
            if (!imgResp.ok) return;

            const contentType = String(imgResp.headers["content-type"] || "image/png");
            if (!contentType.startsWith("image/")) return;

            if (imagesBytes + imgResp.body.length > IMAGES_MAX_TOTAL_BYTES) return;
            imagesBytes += imgResp.body.length;
            const base64 = imgResp.body.toString("base64");
            $img.attr("src", `data:${contentType};base64,${base64}`);

            // Remove srcset to avoid external references after conversion.
            $img.removeAttr("srcset");
        } catch {
            // ignore fetch errors and keep original url
        }
    });

    content = contentDom.html();
    
    return NextResponse.json({ title, content });
  } catch (error) {
    console.error("URL extraction failed:", error);
    return NextResponse.json({ error: "Failed to extract URL" }, { status: 500 });
  }
}
