/**
 * Unit tests for PAYG off-session payment-method resolution.
 *
 * The PAYG reveal charge must name the card to bill explicitly — relying on an
 * unset Stripe customer default fails even when a valid card is on file. These
 * checks exercise resolveDefaultPaymentMethod against a mocked Stripe client so
 * they never make a live call.
 *
 * Usage: npx tsx tests/payg-metering.test.ts
 */

const { resolveDefaultPaymentMethod } = await import("../server/lib/stripe-metering");

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}`);
  }
}

function mockStripe(opts: {
  customer: any;
  cards?: Array<{ id: string }>;
}) {
  const calls = { retrieve: 0, list: 0 };
  return {
    calls,
    customers: {
      retrieve: async (_id: string) => {
        calls.retrieve++;
        return opts.customer;
      },
    },
    paymentMethods: {
      list: async (_args: any) => {
        calls.list++;
        return { data: opts.cards ?? [] };
      },
    },
  };
}

console.log("uses the customer's default payment method when set (string):");
{
  const s = mockStripe({ customer: { invoice_settings: { default_payment_method: "pm_default" } } });
  const pm = await resolveDefaultPaymentMethod(s as any, "cus_1");
  check("returns the default pm id", pm === "pm_default");
  check("does not fall back to listing cards", s.calls.list === 0);
}

console.log("\nuses the default payment method when expanded to an object:");
{
  const s = mockStripe({ customer: { invoice_settings: { default_payment_method: { id: "pm_obj" } } } });
  const pm = await resolveDefaultPaymentMethod(s as any, "cus_2");
  check("returns the expanded pm id", pm === "pm_obj");
}

console.log("\nfalls back to the most recent card when no default is set:");
{
  const s = mockStripe({
    customer: { invoice_settings: { default_payment_method: null } },
    cards: [{ id: "pm_recent" }],
  });
  const pm = await resolveDefaultPaymentMethod(s as any, "cus_3");
  check("returns the most recent card id", pm === "pm_recent");
  check("queried the card list", s.calls.list === 1);
}

console.log("\nreturns null when the customer has no card on file:");
{
  const s = mockStripe({ customer: { invoice_settings: {} }, cards: [] });
  const pm = await resolveDefaultPaymentMethod(s as any, "cus_4");
  check("returns null", pm === null);
}

console.log("\nignores a deleted customer and falls back to card list:");
{
  const s = mockStripe({
    customer: { deleted: true },
    cards: [{ id: "pm_after_delete" }],
  });
  const pm = await resolveDefaultPaymentMethod(s as any, "cus_5");
  check("does not read invoice_settings off a deleted customer", pm === "pm_after_delete");
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll PAYG metering checks passed.");
