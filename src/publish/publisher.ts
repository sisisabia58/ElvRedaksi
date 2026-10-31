import { bearerInit, graphUrl, type GraphHost } from "../instagram/graph";
import { TOKEN_RECONNECT } from "../instagram/token";

export type PublishInput = {
  igUserId: string;
  accessToken: string;
  imageUrls: string[];
  caption: string;
  altTexts: string[];
  shareToStory: boolean;
  graphHost?: GraphHost | null;
};

export type PublishResult = {
  mediaId: string;
  storyMediaId: string | null;
  storyError: string | null;
};

export interface Publisher {
  publish(input: PublishInput): Promise<PublishResult>;
}

/** Waits between container status checks. The sum is about 72s, inside the 60–90s window. */
export const CONTAINER_POLL_DELAYS_MS = [2_000, 4_000, 6_000, 8_000, 10_000, 12_000, 15_000, 15_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

type GraphBody = {
  id?: unknown;
  status_code?: unknown;
  error?: { message?: unknown; code?: unknown };
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

function throwIfReconnect(body: GraphBody | null): void {
  if (body?.error?.code === 190) throw new Error(TOKEN_RECONNECT);
}

export class MetaPublisher implements Publisher {
  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly sleepImpl: (ms: number) => Promise<void> = sleep,
  ) {}

  async publish(input: PublishInput): Promise<PublishResult> {
    const host = input.graphHost ?? "instagram";
    await this.assertQuota(input, host);

    const childIds: string[] = [];
    for (let index = 0; index < input.imageUrls.length; index++) {
      const id = await this.postForId(`${input.igUserId}/media`, input.accessToken, host, {
        image_url: input.imageUrls[index],
        is_carousel_item: true,
        alt_text: input.altTexts[index] ?? "",
      });
      childIds.push(id);
    }
    for (const id of childIds) {
      await this.poll(input.accessToken, id, host);
    }

    const parentId = await this.postForId(`${input.igUserId}/media`, input.accessToken, host, {
      media_type: "CAROUSEL",
      children: childIds.join(","),
      caption: input.caption,
    });
    await this.poll(input.accessToken, parentId, host);
    const mediaId = await this.postForId(`${input.igUserId}/media_publish`, input.accessToken, host, {
      creation_id: parentId,
    });

    if (!input.shareToStory) {
      return { mediaId, storyMediaId: null, storyError: null };
    }

    try {
      const storyId = await this.postForId(`${input.igUserId}/media`, input.accessToken, host, {
        media_type: "STORIES",
        image_url: input.imageUrls[0],
      });
      await this.poll(input.accessToken, storyId, host);
      const storyMediaId = await this.postForId(`${input.igUserId}/media_publish`, input.accessToken, host, {
        creation_id: storyId,
      });
      return { mediaId, storyMediaId, storyError: null };
    } catch (error) {
      const storyError = error instanceof Error ? error.message : String(error);
      return { mediaId, storyMediaId: null, storyError };
    }
  }

  private async assertQuota(input: PublishInput, host: GraphHost): Promise<void> {
    const url = graphUrl(`${input.igUserId}/content_publishing_limit`, {
      fields: "quota_usage,config",
    }, host);
    const res = await this.fetchImpl(url, bearerInit(input.accessToken));
    const body = await readBody(res);
    throwIfReconnect(body);
    const usage = body?.data?.[0]?.quota_usage;
    const total = body?.data?.[0]?.config?.quota_total;
    if (typeof usage === "number" && typeof total === "number" && usage >= total) {
      throw new Error("Kuota posting API Instagram hari ini habis");
    }
  }

  private async poll(accessToken: string, id: string, host: GraphHost): Promise<void> {
    const checks = CONTAINER_POLL_DELAYS_MS.length + 1;
    for (let attempt = 0; attempt < checks; attempt++) {
      if (attempt > 0) {
        await this.sleepImpl(CONTAINER_POLL_DELAYS_MS[attempt - 1]);
      }
      const url = graphUrl(id, { fields: "status_code" }, host);
      const res = await this.fetchImpl(url, bearerInit(accessToken));
      const body = await readBody(res);
      throwIfReconnect(body);
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

  private async postForId(
    path: string,
    accessToken: string,
    host: GraphHost,
    body: Record<string, unknown>,
  ): Promise<string> {
    const res = await this.fetchImpl(graphUrl(path, undefined, host), bearerInit(accessToken, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
    const payload = await readBody(res);
    throwIfReconnect(payload);
    if (typeof payload?.id === "string" && payload.id) {
      return payload.id;
    }
    const message = payload?.error?.message;
    throw new Error(typeof message === "string" && message ? message : "Instagram tidak mengembalikan id");
  }
}
