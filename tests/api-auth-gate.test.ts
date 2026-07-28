const BASE = "http://localhost:5000";

async function status(path: string, headers: Record<string, string> = {}): Promise<number> {
  const res = await fetch(`${BASE}${path}`, { headers });
  return res.status;
}

function assertEq(actual: number, expected: number, label: string) {
  if (actual !== expected) {
    console.error(`FAIL: ${label} — expected ${expected}, got ${actual}`);
    process.exitCode = 1;
  } else {
    console.log(`ok: ${label} (${actual})`);
  }
}

async function main() {
  const protectedPaths = [
    "/api/staff/schools",
    "/api/staff/stats",
    "/api/lists",
    "/api/credits",
    "/api/signals",
  ];

  for (const p of protectedPaths) {
    assertEq(await status(p), 401, `logged-out ${p}`);
    assertEq(
      await status(p, { "X-Admin-Secret": "definitely-wrong-secret" }),
      401,
      `fake admin secret ${p}`
    );
  }

  const publicPaths: [string, number][] = [
    ["/api/billing/plans", 200],
    ["/api/v1/schools", 401], // its own API-key auth, not a session 401 from the gate
  ];
  for (const [p, expected] of publicPaths) {
    assertEq(await status(p), expected, `public/self-auth ${p}`);
  }

  const adminSecret = process.env.ADMIN_SECRET;
  if (adminSecret) {
    assertEq(
      await status("/api/credits", { "X-Admin-Secret": adminSecret }),
      200,
      "valid admin secret /api/credits"
    );
  } else {
    console.log("skip: ADMIN_SECRET not set, skipping valid-secret check");
  }

  if (process.exitCode) {
    console.error("API auth gate checks FAILED.");
  } else {
    console.log("All API auth gate checks passed.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
