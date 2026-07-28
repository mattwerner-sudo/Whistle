import {
  FreeEmailVerifier,
  verifyEmail,
  applyVerificationToConfidence,
  type DnsResolvers,
} from "../server/lib/email-verification";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) console.log(`ok  - ${name}`);
  else { console.error(`FAIL - ${name}`); failures++; }
}

function makeResolvers(overrides: Partial<DnsResolvers> = {}): DnsResolvers {
  const notFound = () => Promise.reject(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }));
  return {
    resolveMx: overrides.resolveMx ?? notFound,
    resolve4: overrides.resolve4 ?? notFound,
    resolve6: overrides.resolve6 ?? notFound,
  };
}

async function run() {
  {
    const v = new FreeEmailVerifier(makeResolvers());
    const r = await v.verify("not-an-email");
    check("invalid syntax -> undeliverable", r.status === "undeliverable");
  }
  {
    const v = new FreeEmailVerifier(makeResolvers());
    check("empty -> undeliverable", (await v.verify("")).status === "undeliverable");
  }
  {
    const v = new FreeEmailVerifier(makeResolvers());
    check("disposable -> undeliverable", (await v.verify("coach@mailinator.com")).status === "undeliverable");
  }
  {
    const v = new FreeEmailVerifier(makeResolvers({ resolveMx: async () => [{ exchange: "mx.example.edu", priority: 10 }] }));
    check("valid MX + personal -> verified", (await v.verify("jsmith@example.edu")).status === "verified");
  }
  {
    const v = new FreeEmailVerifier(makeResolvers({ resolveMx: async () => [{ exchange: "mx.example.edu", priority: 10 }] }));
    check("valid MX + role -> risky", (await v.verify("info@example.edu")).status === "risky");
  }
  {
    const v = new FreeEmailVerifier(makeResolvers({ resolve4: async () => ["1.2.3.4"] }));
    check("A-record fallback -> verified", (await v.verify("coach@a-only.edu")).status === "verified");
  }
  {
    const v = new FreeEmailVerifier(makeResolvers());
    check("no mail host -> undeliverable", (await v.verify("coach@nowhere.invalidtld")).status === "undeliverable");
  }
  {
    const hang = () => new Promise<never>(() => {});
    const v = new FreeEmailVerifier(makeResolvers({ resolveMx: hang, resolve4: hang, resolve6: hang }));
    const start = Date.now();
    const r = await v.verify("coach@slow.edu");
    const elapsed = Date.now() - start;
    check("DNS timeout -> unverified", r.status === "unverified");
    check("DNS timeout bounded (<6s)", elapsed < 6000);
  }
  {
    const throwing = { verify: async () => { throw new Error("boom"); } };
    check("verifyEmail swallows errors -> unverified", (await verifyEmail("x@y.com", throwing as any)).status === "unverified");
  }
  {
    let mxCalls = 0;
    const v = new FreeEmailVerifier(makeResolvers({ resolveMx: async () => { mxCalls++; return [{ exchange: "mx.cache.edu", priority: 10 }]; } }));
    await v.verify("a@cache.edu");
    await v.verify("b@cache.edu");
    check("MX result cached per-domain", mxCalls === 1);
  }
  {
    check("confidence null passthrough", applyVerificationToConfidence(null, "verified") === null);
  }
  {
    const out = applyVerificationToConfidence({ name: 100, title: 100, email: 100, phone: 100, overall: 100 }, "undeliverable")!;
    check("undeliverable lowers email score", out.email === 20);
    check("undeliverable recomputes overall", out.overall === 80);
  }
  {
    const out = applyVerificationToConfidence({ name: 90, title: 80, email: 70, phone: 60, overall: 75 }, "verified")!;
    check("verified keeps email score", out.email === 70);
    check("verified recomputes overall", out.overall === 79);
  }
  {
    const out = applyVerificationToConfidence({ name: 50, title: 50, email: 50, phone: 50, overall: 50 }, "unverified")!;
    check("unverified doesn't penalize email", out.email === 50);
  }
  {
    // Idempotent recompute: risky must not compound across passes, and a later
    // "verified" must restore the full email score from the immutable base.
    const base = { name: 90, title: 80, email: 70, phone: 60, overall: 75 };
    const risky1 = applyVerificationToConfidence(base, "risky")!;
    const risky2 = applyVerificationToConfidence(risky1, "risky")!;
    check("risky recompute does not compound", risky1.email === 49 && risky2.email === 49);
    const restored = applyVerificationToConfidence(risky2, "verified")!;
    check("verified after risky restores full email score", restored.email === 70);
  }
  if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
  console.log("\nAll email-verification checks passed");
}
run().catch((e) => { console.error(e); process.exit(1); });
