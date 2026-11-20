import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { assertTripMember } from "@/lib/agent/membership";
import { createServerSupabase } from "@/lib/supabase/server";

export async function requireTripPhotoAccess(
  tripId: string,
  userId: string
): Promise<
  | {
      ok: true;
      supabase: NonNullable<Awaited<ReturnType<typeof createServerSupabase>>>;
    }
  | { ok: false; response: NextResponse }
> {
  if (!z.string().uuid().safeParse(tripId).success) {
    return {
      ok: false,
      response: NextResponse.json({ error: "bad-trip" }, { status: 400 }),
    };
  }
  const supabase = await createServerSupabase();
  if (!supabase) {
    return {
      ok: false,
      response: NextResponse.json({ error: "no-supabase" }, { status: 503 }),
    };
  }
  const member = await assertTripMember(userId, tripId);
  if (!member) {
    return {
      ok: false,
      response: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }
  return { ok: true, supabase };
}
