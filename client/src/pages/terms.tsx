import { Link } from "wouter";
import LegalFooter from "@/components/legal-footer";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="font-semibold" data-testid="link-home">Whistle</Link>
          <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground" data-testid="link-login">Sign in</Link>
        </div>
      </header>
      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-12">
        <h1 className="text-3xl font-semibold mb-2" data-testid="text-terms-title">Terms of Service</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: May 22, 2026</p>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-6">
          <section>
            <h2 className="text-xl font-semibold">1. Acceptance</h2>
            <p>
              By creating a Whistle account or using any part of the Whistle service (the “Service”),
              you agree to these Terms of Service and our <Link href="/privacy" className="underline">Privacy Policy</Link>.
              If you are using Whistle on behalf of an organization, you represent that you have the
              authority to bind that organization to these terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">2. The Service</h2>
            <p>
              Whistle provides go-to-market intelligence about collegiate athletic departments, including
              publicly available contact information for staff members. Whistle gathers this data from
              publicly accessible sources and reformats it for sales, recruiting, and partnerships
              workflows. You may use this data only for lawful business outreach.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">3. Accounts</h2>
            <p>
              You are responsible for maintaining the confidentiality of your account credentials and for
              all activity that occurs under your account. Notify us immediately at
              <a href="mailto:support@gowhistle.io" className="underline"> support@gowhistle.io</a> if you
              suspect unauthorized access.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">4. Billing & Reveals</h2>
            <p>
              Plans, included reveals, and overage rates are described on our
              <Link href="/pricing" className="underline"> pricing page</Link>. By providing a payment
              method you authorize Whistle (through Stripe) to charge that method for the plan you
              select and any overage reveals. Subscriptions
              renew automatically until canceled. You can update or remove your payment method, change
              plans, and cancel at any time from your billing dashboard.
            </p>
            <p>
              If a charge is declined, your reveals will be paused until you update your payment method.
              We will send you a single email per failure event so you can resolve it quickly.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">5. Acceptable Use</h2>
            <p>You agree not to:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>scrape, resell, redistribute, or sublicense Whistle data, in bulk or otherwise, or incorporate it into any product or dataset made available to third parties;</li>
              <li>
                use Whistle data for any purpose regulated by the Fair Credit Reporting Act (FCRA) —
                including determining eligibility for employment, credit, insurance, housing, or any
                other purpose that would make Whistle a consumer reporting agency. Whistle is a
                sales-and-marketing intelligence tool only and provides no FCRA-compliant data;
              </li>
              <li>use Whistle to send unsolicited bulk email in violation of CAN-SPAM, CASL, or similar laws;</li>
              <li>attempt to reverse engineer, probe, or disrupt the Service;</li>
              <li>use Whistle for anything other than lawful B2B outreach.</li>
            </ul>
            <p>
              We may suspend or terminate accounts that violate these restrictions.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">6. Data Sources & Removal</h2>
            <p>
              Whistle's contact data is gathered from publicly accessible sources — primarily official
              staff directories published by universities themselves — and is annotated with its
              extraction date and confidence. Individuals who appear in Whistle's database may request
              removal at any time via our
              <a href="/remove-my-info" className="underline"> removal page</a>. Removal requests are
              processed automatically: matching records are deleted and the address is permanently
              suppressed from future collection. If you receive a removal request from a contact you
              obtained through Whistle, you are responsible for honoring it in your own systems.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">7. Termination</h2>
            <p>
              We may suspend or terminate your account for breach of these terms, non-payment, or any
              activity that exposes Whistle or its users to risk. You may delete your account at any
              time by contacting support; deletion is final and cancels any active subscription.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">8. Disclaimers</h2>
            <p>
              The Service is provided “as is.” While we work hard to keep our data fresh and accurate,
              Whistle does not warrant that the data is complete, current, or error-free. You are
              responsible for verifying any contact before relying on it for legal or financial decisions.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">9. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, Whistle’s aggregate liability for any claim arising
              out of or relating to the Service will not exceed the amount you paid Whistle in the
              twelve months preceding the event giving rise to the claim.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">10. Changes</h2>
            <p>
              We may update these terms from time to time. If we make a material change, we will notify
              active users by email or in-product banner before the change takes effect.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">11. Contact</h2>
            <p>
              Questions? Email <a href="mailto:support@gowhistle.io" className="underline">support@gowhistle.io</a>.
            </p>
          </section>
        </div>
      </main>
      <LegalFooter />
    </div>
  );
}
