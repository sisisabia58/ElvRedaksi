import { GRAPH_BASE, GRAPH_VERSION } from "../domain/constants";

export type PublishInput = {
  igUserId: string;
  accessToken: string;
  imageUrls: string[];
  caption: string;
  altTexts: string[];
  shareToStory: boolean;
};

export type PublishResult = {
  mediaId: string;
  storyMediaId: string | null;
  storyError: string | null;
};

export interface Publisher {
  publish(input: PublishInput): Promise<PublishResult>;
}

const POLL_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 2000;

function graphUrl(path: string, accessToken: string, query?: Record<string, string>): string {
  const url = new URL(`${GRAPH_BASE}/${GRAPH_VERSION}/${path}`);
  url.searchParams.set("access_token", accessToken);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

type GraphBody = {
  id?: unknown;
  status_code?: unknown;
  error?: { message?: unknown };
  data?: { quota_usage?: unknown; config?: { quota_total?: unknown } }[];
};

async function readBody(res: Response): Promise<GraphBody | null> {
  try {
    return (await res.json()) as GraphBody;
  } catch {
    return null;
  }
}

export class FakePublisher implements Publisher {
  calls: PublishInput[] = [];

  async publish(input: PublishInput): Promise<PublishResult> {
    this.calls.push(input);
    return {
      mediaId: "fake_" + this.calls.length,
      storyMediaId: input.shareToStory ? "fake_story" : null,
      storyError: null,
    };
  }
}

export class MetaPublisher implements Publisher {
  constructor(private readonly fetchImpl: typeof fetch) {}

  async publish(input: PublishInput): Promise<PublishResult> {
    await this.assertQuota(input);

    const childIds: string[] = [];
    for (let index = 0; index < input.imageUrls.length; index++) {
      const id = await this.postForId(graphUrl(`${input.igUserId}/media`, input.accessToken), {
        image_url: input.imageUrls[index],
        is_carousel_item: true,
        alt_text: input.altTexts[index] ?? "",
      });
      childIds.push(id);
    }
    for (const id of childIds) {
      await this.poll(input.accessToken, id);
    }

    const parentId = await this.postForId(graphUrl(`${input.igUserId}/media`, input.accessToken), {
      media_type: "CAROUSEL",
      children: childIds.join(","),
      caption: input.caption,
    });
    await this.poll(input.accessToken, parentId);
    const mediaId = await this.postForId(graphUrl(`${input.igUserId}/media_publish`, input.accessToken), {
      creation_id: parentId,
    });

    if (!input.shareToStory) {
      return { mediaId, storyMediaId: null, storyError: null };
    }

    try {
      const storyId = await this.postForId(graphUrl(`${input.igUserId}/media`, input.accessToken), {
        media_type: "STORIES",
        image_url: input.imageUrls[0],
      });
      await this.poll(input.accessToken, storyId);
      const storyMediaId = await this.postForId(
        graphUrl(`${input.igUserId}/media_publish`, input.accessToken),
        { creation_id: storyId },
      );
      return { mediaId, storyMediaId, storyError: null };
    } catch (error) {
      const storyError = error instanceof Error ? error.message : String(error);
      return { mediaId, storyMediaId: null, storyError };
    }
  }

  private async assertQuota(input: PublishInput): Promise<void> {
    const url = graphUrl(`${input.igUserId}/content_publishing_limit`, input.accessToken, {
      fields: "quota_usage,config",
    });
    const res = await this.fetchImpl(url);
    const body = await readBody(res);
    const usage = body?.data?.[0]?.quota_usage;
    const total = body?.data?.[0]?.config?.quota_total;
    if (typeof usage === "number" && typeof total === "number" && usage >= total) {
      throw new Error("Kuota posting API Instagram hari ini habis");
    }
  }

  private async poll(accessToken: string, id: string): Promise<void> {
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await sleep(POLL_INTERVAL_MS);
      }
      const url = graphUrl(id, accessToken, { fields: "status_code" });
      const res = await this.fetchImpl(url);
      const body = await readBody(res);
      const status = body?.status_code;
      if (status === "FINISHED") {
        return;
      }
      if (status === "ERROR" || status === "EXPIRED") {
        throw new Error(`Kontainer Instagram ${status}`);
      }
    }
    throw new Error("Kontainer Instagram belum siap");
  }

  private async postForId(url: string, body: Record<string, unknown>): Promise<string> {
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await readBody(res);
    if (typeof payload?.id === "string" && payload.id) {
      return payload.id;
    }
    const message = payload?.error?.message;
    throw new Error(typeof message === "string" && message ? message : "Instagram tidak mengembalikan id");
  }
}
