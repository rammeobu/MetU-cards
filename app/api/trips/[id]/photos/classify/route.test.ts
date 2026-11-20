import { beforeEach, describe, expect, it, vi } from "vitest";

const guardApi = vi.fn();
const assertTripMember = vi.fn();
const createServerSupabase = vi.fn();
const geminiVision = vi.fn();

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
vi.mock("@/lib/ai/gemini", () => ({
  geminiVision: (...a: unknown[]) => geminiVision(...a),
}));

describe("POST /api/trips/[id]/photos/classify", () => {
  beforeEach(() => {
    guardApi.mockReset();
    assertTripMember.mockReset();
    createServerSupabase.mockReset();
    geminiVision.mockReset();
    assertTripMember.mockResolvedValue(true);
  });

  it("rejects anonymous", async () => {
    guardApi.mockResolvedValue({
      identity: { kind: "user", userId: "u1", isAnonymous: true },
      clientKey: "k",
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/x", { method: "POST" }),
      {
        params: Promise.resolve({
          id: "22222222-2222-4222-8222-222222222222",
        }),
      }
    );
    expect(res.status).toBe(403);
  });

  it("returns 0 when nothing to classify", async () => {
    guardApi.mockResolvedValue({
      identity: { kind: "user", userId: "u1", isAnonymous: false },
      clientKey: "k",
    });
    createServerSupabase.mockResolvedValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            in: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
        }),
      }),
      storage: { from: () => ({}) },
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/x", { method: "POST" }),
      {
        params: Promise.resolve({
          id: "22222222-2222-4222-8222-222222222222",
        }),
      }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ classified: 0, failed: 0 });
  });
});
