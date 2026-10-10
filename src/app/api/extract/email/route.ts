import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { forEachLimited, safeFetch } from "@/lib/safe-fetch";

const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 8_000;
const IMAGES_MAX_COUNT = 100;
const IMAGES_MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const IMAGES_TIME_BUDGET_MS = 30_000;
const IMAGES_CONCURRENCY = 6;

async function inlineImages(html: string, baseUrl: string): Promise<string> {
  const dom = cheerio.load(html);
  const imgElements = dom("img");
  const imagesDeadline = Date.now() + IMAGES_TIME_BUDGET_MS;
  let imagesBytes = 0;

  await forEachLimited(imgElements.toArray().slice(0, IMAGES_MAX_COUNT), IMAGES_CONCURRENCY, async (el) => {
    const $img = dom(el);
    const src = $img.attr("src");
    if (!src || src.startsWith("data:")) return;

    let resolvedUrl;
    try {
      resolvedUrl = new URL(src, baseUrl).href;
    } catch {
      return;
    }

    const remainingMs = imagesDeadline - Date.now();
    if (remainingMs <= 0 || imagesBytes >= IMAGES_MAX_TOTAL_BYTES) return;

    try {
      const imgResp = await safeFetch(resolvedUrl, {
        headers: { "User-Agent": "Mozilla/5.0 EPUBify/1.0" },
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
      $img.removeAttr("srcset");
    } catch {
      // fallback keep original src
    }
  });

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
