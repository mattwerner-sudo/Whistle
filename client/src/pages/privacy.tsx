import { Link } from "wouter";
import LegalFooter from "@/components/legal-footer";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="font-semibold" data-testid="link-home">Whistle</Link>
          <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground" data-testid="link-login">Sign in</Link>
        </div>
      </header>
      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-12">
        <h1 className="text-3xl font-semibold mb-2" data-testid="text-privacy-title">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: May 22, 2026</p>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-6">
          <section>
            <h2 className="text-xl font-semibold">Overview</h2>
            <p>
              This Privacy Policy describes how Whistle (“we”, “us”) collects, uses, and shares
              information when you use our website and product. By using Whistle you agree to the
              practices described here and in our <Link href="/terms" className="underline">Terms of Service</Link>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">Information you provide</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Account data:</strong> name, email, hashed password, and (for Google sign-in) your Google subject ID.</li>
              <li><strong>Billing data:</strong> Stripe customer ID and subscription state. We never store full card numbers — Stripe handles payment data directly.</li>
              <li><strong>Support data:</strong> any messages you send to us.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold">Information we collect automatically</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>Standard log data (IP address, user agent, timestamp) to operate and secure the Service.</li>
              <li>Usage events (which schools/contacts you reveal, jobs you run) so we can compute your billing and improve the product.</li>
              <li>Session cookies that keep you signed in. We do not use third-party advertising cookies.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold">Data we publish about athletic staff</h2>
            <p>
              Whistle aggregates publicly available information about collegiate athletic department
              staff (name, title, school, work email, work phone, and public LinkedIn URLs) from
              official athletic department websites and other public sources. We do not include personal
              information beyond what is published in a professional capacity by the staff member or
              their institution. If you are an athletic staff member and want your information removed,
              email <a href="mailto:privacy@gowhistle.io" className="underline">privacy@gowhistle.io</a> and
              we will process your request within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">How we use information</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>To provide, secure, and improve the Service;</li>
              <li>To bill you for the plan and reveals you use;</li>
              <li>To send transactional emails (account verification, payment failures, plan changes);</li>
              <li>To respond to your support requests and to comply with legal obligations.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold">Sharing</h2>
            <p>We share data only with sub-processors that help us run Whistle:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Stripe</strong> — payment processing.</li>
              <li><strong>SendGrid</strong> — transactional email.</li>
              <li><strong>Google Cloud / Neon</strong> — application hosting and database.</li>
              <li><strong>Google Gemini</strong> — AI features that you explicitly invoke.</li>
            </ul>
            <p>We do not sell personal information. We may disclose information when required by law.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">Retention</h2>
            <p>
              We retain account and billing records for the life of your account and for up to 7 years
              afterwards for tax and audit purposes. You may request deletion of your account data
              earlier by emailing <a href="mailto:privacy@gowhistle.io" className="underline">privacy@gowhistle.io</a>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">Your rights</h2>
            <p>
              Depending on your jurisdiction you may have the right to access, correct, export, or
              delete your personal information. Email <a href="mailto:privacy@gowhistle.io" className="underline">privacy@gowhistle.io</a>
              and we will respond within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">Contact</h2>
            <p>
              For any privacy question, email <a href="mailto:privacy@gowhistle.io" className="underline">privacy@gowhistle.io</a>.
            </p>
          </section>
        </div>
      </main>
      <LegalFooter />
    </div>
  );
}
