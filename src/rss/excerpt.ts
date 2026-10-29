export function imageUrlFromHtml(html: string, pageUrl: string): string | null {
  const patterns = [
    /<meta\b[^>]*property\s*=\s*["']og:image(?::secure_url)?["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>/i,
    /<meta\b[^>]*content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["']og:image(?::secure_url)?["'][^>]*>/i,
    /<meta\b[^>]*name\s*=\s*["']twitter:image(?::src)?["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>/i,
    /<meta\b[^>]*content\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']twitter:image(?::src)?["'][^>]*>/i,
  ];
  for (const pattern of patterns) {
    const raw = html.match(pattern)?.[1]?.trim();
    if (!raw) {
      continue;
    }
    try {
      const url = new URL(raw, pageUrl);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return url.href;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function excerptFromHtml(html: string): string {
  let text = html;
  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  return text.slice(0, 1200);
}
