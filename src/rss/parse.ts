import { XMLParser } from "fast-xml-parser";

export type FeedItem = {
  title: string;
  url: string;
  publishedAt: Date | null;
  summary: string;
};

type PreserveNode = Record<string, unknown>;

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function collectTextParts(nodes: unknown, parts: string[]): void {
  if (typeof nodes === "string") {
    if (nodes) {
      parts.push(nodes);
    }
    return;
  }
  if (!Array.isArray(nodes)) {
    if (typeof nodes === "object" && nodes !== null) {
      collectTextParts([nodes], parts);
    }
    return;
  }
  for (const node of nodes) {
    if (typeof node !== "object" || node === null) {
      continue;
    }
    for (const [key, child] of Object.entries(node as PreserveNode)) {
      if (key === ":@") {
        continue;
      }
      if (key === "#text") {
        if (typeof child === "string" && child) {
          parts.push(child);
        } else if (Array.isArray(child)) {
          for (const piece of child) {
            if (typeof piece === "object" && piece !== null && "#text" in piece) {
              const inner = (piece as PreserveNode)["#text"];
              if (typeof inner === "string" && inner) {
                parts.push(inner);
              } else {
                collectTextParts(inner, parts);
              }
            }
          }
        }
      } else {
        collectTextParts(child, parts);
      }
    }
  }
}

function textFromPreserveNodes(nodes: unknown): string {
  const parts: string[] = [];
  collectTextParts(nodes, parts);
  return stripTags(parts.join(" "));
}

function fieldFromItem(itemNodes: PreserveNode[], tag: string): string {
  for (const node of itemNodes) {
    if (typeof node !== "object" || node === null) {
      continue;
    }
    if (tag in node) {
      return textFromPreserveNodes(node[tag]).trim();
    }
  }
  return "";
}

function resolveLinkFromItem(itemNodes: PreserveNode[]): string {
  const textLink = fieldFromItem(itemNodes, "link");
  if (textLink) {
    return textLink;
  }
  let fallbackHref = "";
  for (const node of itemNodes) {
    if (typeof node !== "object" || node === null || !("link" in node)) {
      continue;
    }
    const attrs = (node as PreserveNode)[":@"];
    if (!attrs || typeof attrs !== "object") {
      continue;
    }
    const href = (attrs as Record<string, string>)["@_href"]?.trim();
    if (!href) {
      continue;
    }
    const rel = (attrs as Record<string, string>)["@_rel"];
    if (!rel || rel === "alternate") {
      return href;
    }
    if (!fallbackHref) {
      fallbackHref = href;
    }
  }
  return fallbackHref;
}

function validHttpUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

function parseDateText(text: string): Date | null {
  if (!text.trim()) {
    return null;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeItemNodes(itemNodes: PreserveNode[]): FeedItem | null {
  const title = fieldFromItem(itemNodes, "title");
  if (!title) {
    return null;
  }
  const url = validHttpUrl(resolveLinkFromItem(itemNodes));
  if (!url) {
    return null;
  }
  const summary = stripTags(
    (
      fieldFromItem(itemNodes, "description") ||
      fieldFromItem(itemNodes, "summary") ||
      fieldFromItem(itemNodes, "content")
    ).replace(/\s+/g, " "),
  );
  const publishedAt =
    parseDateText(fieldFromItem(itemNodes, "pubDate")) ??
    parseDateText(fieldFromItem(itemNodes, "published")) ??
    parseDateText(fieldFromItem(itemNodes, "updated"));
  return { title, url, publishedAt, summary };
}

function collectItemNodeLists(nodes: unknown, tag: string, out: PreserveNode[][]): void {
  if (!Array.isArray(nodes)) {
    return;
  }
  for (const node of nodes) {
    if (typeof node !== "object" || node === null) {
      continue;
    }
    for (const [key, child] of Object.entries(node as PreserveNode)) {
      if (key === tag && Array.isArray(child)) {
        out.push(child as PreserveNode[]);
      } else {
        collectItemNodeLists(child, tag, out);
      }
    }
  }
}

export function parseFeed(xml: string): FeedItem[] {
  const parser = new XMLParser({ ignoreAttributes: false, preserveOrder: true });
  const doc = parser.parse(xml) as PreserveNode[];
  const itemLists: PreserveNode[][] = [];
  collectItemNodeLists(doc, "item", itemLists);
  collectItemNodeLists(doc, "entry", itemLists);

  const seen = new Set<string>();
  const out: FeedItem[] = [];
  for (const itemNodes of itemLists) {
    const item = normalizeItemNodes(itemNodes);
    if (!item || seen.has(item.url)) {
      continue;
    }
    seen.add(item.url);
    out.push(item);
  }
  return out;
}
