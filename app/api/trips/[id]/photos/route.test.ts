import { beforeEach, describe, expect, it, vi } from "vitest";

const guardApi = vi.fn();
const assertTripMember = vi.fn();
const createServerSupabase = vi.fn();
const detectImageMime = vi.fn();

vi.mock("@/lib/security/guard", () => ({
  guardApi: (...a: unknown[]) => guardApi(...a),
  rejectAnonymousWrite: (identity: { kind?: string; isAnonymous?: boolean }) =>
    identity.kind === "user" && identity.isAnonymous === true
      ? Response.json({ error: "guest-readonly" }, { status: 403 })
      : null,
}));
vi.mock("@/lib/agent/membership", () => ({
  assertTripMember: (...a: unknown[]) => assertTripMember(...a),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: (...a: unknown[]) => createServerSupabase(...a),
}));
vi.mock("@/lib/agent/image-magic", () => ({
  detectImageMime: (...a: unknown[]) => detectImageMime(...a),
}));

function makeSupabase(over: {
  list?: unknown;
  listErr?: unknown;
  uploadErr?: unknown;
  insert?: unknown;
  insertErr?: unknown;
  signedUrl?: string;
}) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () =>
            Promise.resolve({
              data: over.list ?? [],
              error: over.listErr ?? null,
            }),
        }),
      }),
      insert: () => ({
        select: () => ({
          single: () =>
            Promise.resolve({
              data: over.insert ?? null,
              error: over.insertErr ?? null,
            }),
        }),
      }),
    }),
    storage: {
      from: () => ({
        createSignedUrl: async () => ({
          data: over.signedUrl ? { signedUrl: over.signedUrl } : null,
        }),
        upload: async () => ({ error: over.uploadErr ?? null }),
        remove: async () => ({ error: null }),
      }),
    },
  };
}

describe("GET/POST /api/trips/[id]/photos", () => {
  beforeEach(() => {
    guardApi.mockReset();
    assertTripMember.mockReset();
    createServerSupabase.mockReset();
    detectImageMime.mockReset();
    assertTripMember.mockResolvedValue(true);
    createServerSupabase.mockResolvedValue(makeSupabase({}));
  });

  it("GET rejects anonymous write identity without login", async () => {
    guardApi.mockResolvedValue({
      identity: { kind: "guest", nonce: "n" },
      clientKey: "k",
    });
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/trips/t/photos"), {
      params: Promise.resolve({ id: "22222222-2222-4222-8222-222222222222" }),
    });
    expect(res.status).toBe(401);
  });

  it("GET lists photos for member", async () => {
    guardApi.mockResolvedValue({
      identity: { kind: "user", userId: "u1", isAnonymous: false },
      clientKey: "k",
    });
    createServerSupabase.mockResolvedValue(
      makeSupabase({
        list: [
          {
            id: "p1",
            trip_id: "22222222-2222-4222-8222-222222222222",
            uploaded_by: "u1",
            storage_path: "t/u/a.jpg",
            status: "ready",
            scene: "landscape",
            person_keys: [],
            error: null,
            created_at: "2026-11-20T00:00:00Z",
          },
        ],
        signedUrl: "https://example.com/a.jpg",
      })
    );
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/trips/t/photos"), {
      params: Promise.resolve({
        id: "22222222-2222-4222-8222-222222222222",
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { photos: Array<{ id: string; url: string }> };
    expect(json.photos[0]!.id).toBe("p1");
    expect(json.photos[0]!.url).toContain("example.com");
  });

  it("POST rejects anonymous", async () => {
    guardApi.mockResolvedValue({
      identity: { kind: "user", userId: "u1", isAnonymous: true },
      clientKey: "k",
    });
    const { POST } = await import("./route");
    const form = new FormData();
    form.set("file", new File([new Uint8Array([0xff, 0xd8, 0xff])], "a.jpg"));
    const res = await POST(
      new Request("http://localhost/api/trips/t/photos", {
        method: "POST",
        body: form,
      }),
      {
        params: Promise.resolve({
          id: "22222222-2222-4222-8222-222222222222",
        }),
      }
    );
    expect(res.status).toBe(403);
  });
});
