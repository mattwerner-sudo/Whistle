import { useState } from 'react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Database, Users, Zap, Download, Mail, Target,
  Building2, BarChart3, ArrowRight, CheckCircle2, Copy, Check, Terminal
} from 'lucide-react';
import LegalFooter from '@/components/legal-footer';

const features = [
  {
    icon: Users,
    title: 'Staff Directory Access',
    description: 'Deep contact coverage for 225+ Division I athletic departments, with on-demand extraction for any NCAA school.',
  },
  {
    icon: Zap,
    title: 'AI-Powered Extraction',
    description: 'Automatically extract names, titles, emails, and phone numbers from athletic websites.',
  },
  {
    icon: Download,
    title: 'Bulk Export',
    description: 'Export contacts to CSV for use in your CRM, email campaigns, or sales workflows.',
  },
  {
    icon: Mail,
    title: 'Email Drafting',
    description: 'AI-assisted email templates customized for each contact and their role.',
  },
  {
    icon: Target,
    title: 'Buyer Personas',
    description: 'Automatically categorize contacts as champions, signers, or influencers.',
  },
  {
    icon: BarChart3,
    title: 'Account Planning',
    description: 'Strategic insights on budget cycles, tech stack, and buying windows.',
  },
];

// Keep these conservative relative to the live database so they stay true as
// coverage grows — never ahead of it. Verified against production data
// 2026-08-31: 227 schools extracted, 39,677 contacts, 29,412 verified
// emails, 20 conferences.
const stats = [
  { value: '225+', label: 'D1 Athletic Departments' },
  { value: '39,000+', label: 'Staff Contacts' },
  { value: '29,000+', label: 'Verified Emails' },
  { value: '20+', label: 'Conferences' },
];

// Copy-paste onboarding for the API and MCP surfaces (both already live in
// this codebase: server/mcp/index.ts and /api/v1 with key auth). Env var
// names must match what server/mcp/index.ts actually reads.
const integrationSnippets: { id: string; label: string; language: string; code: string }[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    language: 'bash',
    code: `git clone https://github.com/mattwerner-sudo/Whistle
claude mcp add whistle \\
  --env WHISTLE_API_KEY=sk_live_yourkey \\
  --env WHISTLE_API_BASE=https://gowhistle.io \\
  -- npx tsx Whistle/server/mcp/index.ts`,
  },
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    language: 'json',
    code: `{
  "mcpServers": {
    "whistle": {
      "command": "npx",
      "args": ["tsx", "/path/to/Whistle/server/mcp/index.ts"],
      "env": {
        "WHISTLE_API_KEY": "sk_live_yourkey",
        "WHISTLE_API_BASE": "https://gowhistle.io"
      }
    }
  }
}`,
  },
  {
    id: 'cursor',
    label: 'Cursor',
    language: 'json',
    code: `{
  "mcpServers": {
    "whistle": {
      "command": "npx",
      "args": ["tsx", "/path/to/Whistle/server/mcp/index.ts"],
      "env": {
        "WHISTLE_API_KEY": "sk_live_yourkey",
        "WHISTLE_API_BASE": "https://gowhistle.io"
      }
    }
  }
}`,
  },
  {
    id: 'api',
    label: 'REST API',
    language: 'bash',
    code: `# Search staff across every covered school
curl -H "X-API-Key: sk_live_yourkey" \\
  "https://gowhistle.io/api/v1/staff?query=ticket+sales"

# Recent hiring signals for a conference
curl -H "X-API-Key: sk_live_yourkey" \\
  "https://gowhistle.io/api/v1/signals?type=new_hire"`,
  },
];

function IntegrationSnippet({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable (permissions, insecure context); the
      // text is still selectable by hand.
    }
  };
  return (
    <div className="relative rounded-lg border bg-zinc-950 dark:bg-zinc-900 text-zinc-100">
      {/* Positioned wrapper, not the button itself: the theme's .hover-elevate
          rule forces position:relative on buttons with higher specificity than
          the `absolute` utility. */}
      <div className="absolute top-3 right-3">
        <Button
          size="sm"
          variant="secondary"
          onClick={copy}
          className="gap-1.5 h-8"
          data-testid="button-copy-snippet"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy code'}
        </Button>
      </div>
      <pre className="overflow-x-auto p-5 pr-32 text-[13px] leading-relaxed font-mono">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
              <Database className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-semibold text-lg">Whistle</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/pricing">
              <Button variant="ghost" data-testid="link-header-pricing">Pricing</Button>
            </Link>
            <Link href="/login">
              <Button variant="outline" data-testid="link-header-login">Sign In</Button>
            </Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-background" />
        <div className="max-w-7xl mx-auto px-6 py-24 relative">
          <div className="text-center max-w-3xl mx-auto">
            <Badge className="mb-6" variant="secondary">
              College Athletics Sales Intelligence
            </Badge>
            <h1 className="text-5xl font-bold tracking-tight text-foreground mb-6">
              Find and connect with college athletic staff in seconds
            </h1>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              Whistle gives you verified contact data for coaches, athletic directors,
              and staff across 225+ Division I athletic departments — extracted from
              official staff directories and expanding toward all 1,100+ NCAA schools.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link href="/pricing">
                <Button size="lg" className="gap-2" data-testid="button-hero-cta">
                  Get Started
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Button
                size="lg"
                variant="outline"
                className="gap-2"
                onClick={() => { window.location.href = 'https://buy.stripe.com/8x228javs36Ib0D5jbbbG00'; }}
                data-testid="button-hero-pilot"
              >
                Order a $399 pilot list
              </Button>
            </div>
            <p className="text-sm text-muted-foreground mt-3">
              No subscription — we build a custom verified contact list for your ICP, delivered in 2 business days.
            </p>
          </div>
        </div>
      </section>

      <section className="py-16 border-y bg-muted/30">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-4xl font-bold text-primary mb-2">{stat.value}</div>
                <div className="text-muted-foreground">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">How It Works</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Three simple steps to access a continuously refreshed college athletics staff database
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            <Card className="text-center">
              <CardContent className="pt-8 pb-6">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <Building2 className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold text-lg mb-2">1. Search Schools</h3>
                <p className="text-muted-foreground text-sm">
                  Browse 1,100+ college schools by division, conference, or name
                </p>
              </CardContent>
            </Card>
            
            <Card className="text-center">
              <CardContent className="pt-8 pb-6">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <Zap className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold text-lg mb-2">2. Extract Contacts</h3>
                <p className="text-muted-foreground text-sm">
                  AI extracts emails, phones, titles, and social links automatically
                </p>
              </CardContent>
            </Card>
            
            <Card className="text-center">
              <CardContent className="pt-8 pb-6">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <Download className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold text-lg mb-2">3. Export & Connect</h3>
                <p className="text-muted-foreground text-sm">
                  Download contacts to CSV or use AI to draft personalized emails
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <section className="py-24 bg-muted/30">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">Powerful Features</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Everything you need to build relationships with college athletic departments
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature) => (
              <Card key={feature.title} className="hover-elevate">
                <CardContent className="pt-6">
                  <feature.icon className="h-8 w-8 text-primary mb-4" />
                  <h3 className="font-semibold text-lg mb-2">{feature.title}</h3>
                  <p className="text-muted-foreground text-sm">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 border-y bg-zinc-950 dark:bg-zinc-900/50 text-zinc-100">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-12">
            <Badge variant="secondary" className="mb-4 gap-1.5">
              <Terminal className="h-3.5 w-3.5" />
              For developers &amp; AI agents
            </Badge>
            <h2 className="text-3xl font-bold mb-4">Plug the database into your stack in seconds</h2>
            <p className="text-zinc-400 text-lg max-w-2xl mx-auto">
              Query athletic department staff and hiring signals from Claude, Cursor,
              or your own code — through our MCP server or REST API.
            </p>
          </div>

          <Tabs defaultValue="claude-code">
            <TabsList className="mb-4 flex-wrap h-auto">
              {integrationSnippets.map((s) => (
                <TabsTrigger key={s.id} value={s.id} data-testid={`tab-integration-${s.id}`}>
                  {s.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {integrationSnippets.map((s) => (
              <TabsContent key={s.id} value={s.id}>
                <IntegrationSnippet code={s.code} />
              </TabsContent>
            ))}
          </Tabs>
          <p className="text-sm text-zinc-500 mt-4">
            Generate an API key in Settings once you're signed in. Full endpoint reference at{' '}
            <a href="/api/docs" className="underline underline-offset-2 hover:text-zinc-300">/api/docs</a>.
          </p>
        </div>
      </section>

      <section className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Annual plans for teams of every size</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Pro, Team, and Enterprise tiers — every plan starts with a 14-day trial.
            </p>
          </div>

          <div className="flex flex-col items-center gap-6">
            <div className="flex flex-wrap justify-center gap-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                14-day free trial on every plan
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                Unlimited searching — pay only to reveal contacts
              </div>
            </div>

            <Link href="/pricing">
              <Button size="lg" className="gap-2" data-testid="button-pricing-cta">
                View Plans
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="py-24 bg-primary text-primary-foreground">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-3xl font-bold mb-4">
            Ready to connect with college athletics?
          </h2>
          <p className="text-primary-foreground/80 text-lg mb-8 max-w-2xl mx-auto">
            Built for sales teams, recruiters, and vendors who need to reach
            athletic departments faster — with data pulled straight from the
            directories schools publish themselves.
          </p>
          <Link href="/pricing">
            <Button size="lg" variant="secondary" className="gap-2" data-testid="button-final-cta">
              Get Started Now
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      <LegalFooter />
    </div>
  );
}
