/**
 * Post-checkout refresh tests for the pricing & billing pages.
 *
 * Task #62 made the pricing and billing pages re-fetch account data when the
 * user returns from Stripe checkout (?success=true), retrying for a short
 * window so a slightly delayed webhook still surfaces the new plan/credits
 * without a manual reload (see client/src/hooks/use-post-checkout-refresh.ts).
 *
 * These checks render the actual page components in jsdom against the real
 * singleton queryClient and assert:
 *   1. ?success=true on the pricing page invalidates BOTH account queries
 *      immediately and then re-tries them over the retry window.
 *   2. ?success=true on the billing page invalidates BOTH account queries.
 *   3. Webhook lag: account data that only changes after a short delay still
 *      ends up reflected on screen (the billing plan name updates without a
 *      manual reload because of the retries).
 *   4. The canceled-checkout case (no ?success=true) does NOT trigger any
 *      refreshes.
 *
 * No live Stripe/HTTP is touched: global.fetch is stubbed and returns
 * controlled JSON. Usage: npx tsx tests/post-checkout-refresh.test.ts
 */

import { JSDOM } from "jsdom";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}`);
  }
}

// --- jsdom environment (must be set up before importing React/components) ---
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
const win = dom.window as any;
const g = globalThis as any;
g.window = win;
g.document = win.document;
// Node 22+ defines globalThis.navigator with only a getter; plain assignment throws.
Object.defineProperty(g, "navigator", { value: win.navigator, configurable: true, writable: true });
g.HTMLElement = win.HTMLElement;
g.Node = win.Node;
g.Element = win.Element;
g.getComputedStyle = win.getComputedStyle;
g.requestAnimationFrame = win.requestAnimationFrame || ((cb: any) => setTimeout(cb, 0));
g.cancelAnimationFrame = win.cancelAnimationFrame || ((id: any) => clearTimeout(id));
g.IS_REACT_ACT_ENVIRONMENT = false;
// Radix / shadcn occasionally reach for these in jsdom.
if (!win.matchMedia) {
  win.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}
g.matchMedia = win.matchMedia;
if (!win.ResizeObserver) {
  win.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
g.ResizeObserver = win.ResizeObserver;

// --- controllable fetch stub ---
type FetchHandler = (url: string) => any;
let fetchHandler: FetchHandler = () => ({});
const fetchStub = async (input: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  const body = fetchHandler(url);
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
g.fetch = fetchStub;
win.fetch = fetchStub;

// --- dynamic imports (after globals are in place) ---
const React = (await import("react")) as any;
// The page components rely on the JSX transform injecting `React`; expose it
// as a global so the classic transform (used by tsx) can resolve it.
g.React = React.default ?? React;
const { createRoot } = (await import("react-dom/client")) as any;
const { QueryClientProvider } = (await import("@tanstack/react-query")) as any;
const { Router } = (await import("wouter")) as any;
const { queryClient } = await import("@/lib/queryClient");
const Pricing = (await import("@/pages/pricing")).default as any;
const Billing = (await import("@/pages/billing")).default as any;

const h = React.createElement;

// --- spy on invalidateQueries so we can observe refreshes ---
const invalidated: string[][] = [];
const realInvalidate = queryClient.invalidateQueries.bind(queryClient);
(queryClient as any).invalidateQueries = (opts?: any) => {
  if (opts?.queryKey) invalidated.push(opts.queryKey as string[]);
  return realInvalidate(opts);
};

function invalidatedKeys(): string[] {
  return invalidated.map((k) => k.join("/"));
}
function countKey(key: string): number {
  return invalidatedKeys().filter((k) => k === key).length;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, timeoutMs = 5000, stepMs = 50): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return true;
    await sleep(stepMs);
  }
  return cond();
}

const ME_KEY = "/api/auth/me";
const ACCOUNT_KEY = "/api/billing/account";

function locationHook() {
  // wouter location hook: [path, navigate]
  return ["/", () => {}];
}

function render(component: any, search: string) {
  const container = win.document.createElement("div");
  win.document.body.appendChild(container);
  const root = createRoot(container);
  root.render(
    h(
      QueryClientProvider,
      { client: queryClient },
      h(
        Router,
        { hook: locationHook, searchHook: () => search },
        h(component),
      ),
    ),
  );
  return {
    container,
    unmount: () => {
      root.unmount();
      container.remove();
    },
  };
}

function reset() {
  invalidated.length = 0;
  queryClient.clear();
}

function accountResponse(planId: string, planName: string) {
  return {
    user: { id: 1, email: "a@b.com", fullName: "A B" },
    plan: {
      id: planId,
      name: planName,
      status: "active",
      monthlyPriceCents: planId === "payg" ? null : 10000,
      includedReveals: planId === "payg" ? null : 150,
      overageRateCents: planId === "payg" ? null : 50,
      currentPeriodStart: null,
      currentPeriodEnd: null,
    },
    usage: {
      revealsThisPeriod: 0,
      overageThisPeriod: 0,
      overageCostCents: 0,
      lifetimeReveals: 0,
      activeRevealsInGrace: 0,
      creditsBalance: 0,
    },
  };
}

function meResponse(tier: string) {
  return {
    user: {
      id: 1,
      email: "a@b.com",
      fullName: "A B",
      creditsBalance: 0,
      subscriptionTier: tier,
      subscriptionStatus: "active",
    },
  };
}

// ---------------------------------------------------------------------------
// Test 1: pricing ?success=true invalidates both account queries + retries
// ---------------------------------------------------------------------------
async function testPricingSuccessRefreshAndRetry() {
  console.log("\npricing ?success=true → immediate refresh + retry");
  reset();
  fetchHandler = (url) => (url.includes("/api/auth/me") ? meResponse("pro") : accountResponse("pro", "Pro"));

  const view = render(Pricing, "success=true");

  // Immediate invalidation of both account queries.
  await waitFor(() => countKey(ME_KEY) >= 1 && countKey(ACCOUNT_KEY) >= 1, 2000);
  const meImmediate = countKey(ME_KEY);
  const accountImmediate = countKey(ACCOUNT_KEY);
  check("invalidates /api/auth/me immediately", meImmediate >= 1);
  check("invalidates /api/billing/account immediately", accountImmediate >= 1);

  // The hook re-tries over a short window, so the counts grow.
  const grew = await waitFor(
    () => countKey(ME_KEY) > meImmediate && countKey(ACCOUNT_KEY) > accountImmediate,
    4000,
  );
  check("re-tries the account queries over the retry window", grew);

  view.unmount();
}

// ---------------------------------------------------------------------------
// Test 2: billing ?success=true invalidates both account queries
// ---------------------------------------------------------------------------
async function testBillingSuccessRefresh() {
  console.log("\nbilling ?success=true → refresh both account queries");
  reset();
  fetchHandler = () => accountResponse("pro", "Pro");

  const view = render(Billing, "success=true");

  const ok = await waitFor(() => countKey(ACCOUNT_KEY) >= 1 && countKey(ME_KEY) >= 1, 2000);
  check("invalidates /api/billing/account", countKey(ACCOUNT_KEY) >= 1);
  check("invalidates /api/auth/me", countKey(ME_KEY) >= 1);
  check("both keys refreshed", ok);

  view.unmount();
}

// ---------------------------------------------------------------------------
// Test 3: webhook lag — delayed data still ends up on screen
// ---------------------------------------------------------------------------
async function testWebhookLagSurfacesNewPlan() {
  console.log("\nbilling ?success=true → delayed (webhook-lag) plan still shown");
  reset();
  // Start on the old plan; flip to the new plan after a short delay to
  // simulate the Stripe webhook landing a moment after the page loads.
  let current = accountResponse("payg", "Pay-As-You-Go");
  fetchHandler = () => current;
  setTimeout(() => {
    current = accountResponse("pro", "Pro");
  }, 600);

  const view = render(Billing, "success=true");

  // Old plan shows first.
  const showedOld = await waitFor(
    () => /Pay-As-You-Go plan/.test(view.container.textContent || ""),
    3000,
  );
  check("initially renders the pre-webhook plan", showedOld);

  // After the delayed change, the retries surface the new plan with no reload.
  const showedNew = await waitFor(
    () => /Pro plan/.test(view.container.textContent || ""),
    5000,
  );
  check("delayed plan change appears on screen without a manual reload", showedNew);

  view.unmount();
}

// ---------------------------------------------------------------------------
// Test 4: canceled checkout does NOT trigger refreshes
// ---------------------------------------------------------------------------
async function testCanceledDoesNotRefresh() {
  console.log("\npricing ?canceled=true → no refresh");
  reset();
  fetchHandler = (url) => (url.includes("/api/auth/me") ? meResponse("payg") : accountResponse("payg", "Pay-As-You-Go"));

  const view = render(Pricing, "canceled=true");

  // Give the hook's full retry window time to (not) fire.
  await sleep(2000);
  check("no account queries invalidated on cancel", invalidated.length === 0);

  view.unmount();
}

try {
  await testPricingSuccessRefreshAndRetry();
  await testBillingSuccessRefresh();
  await testWebhookLagSurfacesNewPlan();
  await testCanceledDoesNotRefresh();
} catch (err) {
  failures++;
  console.error("\nUnexpected error:", err);
}

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
