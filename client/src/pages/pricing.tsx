import { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Link, useSearch } from 'wouter';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { usePostCheckoutRefresh } from '@/hooks/use-post-checkout-refresh';
import { Check, Loader2, CreditCard, Sparkles, Zap, Database } from 'lucide-react';

interface UserResponse {
  user: {
    id: number;
    email: string;
    fullName: string;
    creditsBalance: number;
    subscriptionTier?: string;
    subscriptionStatus?: string;
  } | null;
}

interface Tier {
  id: 'pro' | 'team' | 'enterprise';
  name: string;
  priceLabel: string;
  priceCadence?: string;
  description: string;
  features: string[];
  cta: string;
  highlight?: boolean;
  planId?: string;
}

// Annual-only, per the decided pricing model (CLAUDE.md). PAYG was removed
// from the product; this page previously still advertised it, plus stale
// monthly prices — the UI had never been reconciled with that decision.
const TIERS: Tier[] = [
  {
    id: 'pro',
    name: 'Pro',
    priceLabel: '$2,400',
    priceCadence: 'per year',
    description: 'For active sellers and recruiters. 1 seat.',
    features: [
      '2,400 reveals/year included',
      '$0.50 per overage reveal',
      'AI email drafting & meeting prep',
      'Hire & departure signals feed',
      '14-day free trial',
    ],
    cta: 'Start Pro trial',
    highlight: true,
    planId: 'whistle_pro_annual',
  },
  {
    id: 'team',
    name: 'Team',
    priceLabel: '$7,200',
    priceCadence: 'per year',
    description: 'For high-volume teams. 5 seats.',
    features: [
      '9,600 reveals/year included',
      '$0.35 per overage reveal',
      'Everything in Pro',
      '14-day free trial',
    ],
    cta: 'Start Team trial',
    planId: 'whistle_team_annual',
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    priceLabel: '$18,000',
    priceCadence: 'per year',
    description: 'Unlimited seats for your whole org.',
    features: [
      '36,000 reveals/year included',
      '$0.25 per overage reveal',
      'API & MCP access',
      'Dedicated support',
    ],
    cta: 'Talk to sales',
  },
];


function EnterpriseInquiryDialog() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', company: '', teamSize: '', message: '' });

  const mutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', '/api/billing/enterprise-inquiry', form);
    },
    onSuccess: () => {
      toast({ title: 'Thanks! We\'ll be in touch.', description: 'A founder will email you within one business day.' });
      setOpen(false);
      setForm({ name: '', email: '', company: '', teamSize: '', message: '' });
    },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Could not send', description: e.message || 'Please try again' }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full" data-testid="button-enterprise-inquiry">
          Talk to sales
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="dialog-enterprise">
        <DialogHeader>
          <DialogTitle>Talk to sales</DialogTitle>
          <DialogDescription>
            Tell us about your team and we'll reach out within a business day.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
          className="space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="ent-name">Name</Label>
              <Input id="ent-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-enterprise-name" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ent-email">Work email</Label>
              <Input id="ent-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="input-enterprise-email" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="ent-company">Company</Label>
              <Input id="ent-company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} data-testid="input-enterprise-company" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ent-team">Team size</Label>
              <Input id="ent-team" placeholder="e.g. 10-25" value={form.teamSize} onChange={(e) => setForm({ ...form, teamSize: e.target.value })} data-testid="input-enterprise-team" />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ent-message">What are you trying to do?</Label>
            <Textarea id="ent-message" required minLength={10} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} data-testid="input-enterprise-message" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending} data-testid="button-submit-enterprise">
              {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Send inquiry
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Pricing() {
  const { toast } = useToast();
  const searchString = useSearch();

  const { data: userResponse } = useQuery<UserResponse>({
    queryKey: ['/api/auth/me'],
  });
  const user = userResponse?.user ?? null;
  const currentTier = user?.subscriptionTier ?? 'free';
  const hasActiveSub = user?.subscriptionStatus === 'active';

  const checkoutMutation = useMutation({
    mutationFn: async (params: { type: 'subscription'; planId?: string }) => {
      return await apiRequest('POST', '/api/billing/checkout', params);
    },
    onSuccess: (data) => {
      if (data?.url) window.location.href = data.url;
      else toast({ variant: 'destructive', title: 'Checkout unavailable', description: data?.message || 'Please sign in.' });
    },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Checkout failed', description: e.message }),
  });

  const checkoutSucceeded = new URLSearchParams(searchString).get('success') === 'true';
  usePostCheckoutRefresh(checkoutSucceeded, ['/api/auth/me', '/api/billing/account']);

  useEffect(() => {
    const params = new URLSearchParams(searchString);
    if (params.get('success') === 'true') toast({ title: 'Success!', description: 'Your purchase is being processed.' });
    if (params.get('canceled') === 'true') toast({ variant: 'destructive', title: 'Checkout canceled' });
  }, [searchString, toast]);

  function handleCta(tier: Tier) {
    if (tier.id === 'enterprise') return;
    if (!user) {
      window.location.href = '/login';
      return;
    }
    if (tier.planId) {
      checkoutMutation.mutate({ type: 'subscription', planId: tier.planId });
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b sticky top-0 z-50 bg-background/95 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
          <Link href="/">
            <div className="flex items-center gap-3 cursor-pointer" data-testid="link-home">
              <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
                <Database className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="font-semibold text-lg">Whistle</span>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            {user ? (
              <>
                <Link href="/settings/billing"><Button variant="ghost" data-testid="link-billing">Billing</Button></Link>
                <Link href="/dashboard"><Button variant="outline" data-testid="link-dashboard">Dashboard</Button></Link>
              </>
            ) : (
              <Link href="/login"><Button variant="outline" data-testid="link-sign-in">Sign in</Button></Link>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <Badge className="mb-4" variant="secondary">Simple, transparent pricing</Badge>
          <h1 className="text-4xl font-bold mb-4" data-testid="text-pricing-title">Pay only when you reveal a contact</h1>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Browse every school and staff name for free, and preview any one school's full contacts free — no card required. Reveal contacts everywhere with a plan.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
          {TIERS.map((tier) => {
            const isCurrent = tier.id === currentTier && hasActiveSub;
            return (
              <Card
                key={tier.id}
                className={`flex flex-col ${tier.highlight ? 'border-primary shadow-md' : ''}`}
                data-testid={`card-tier-${tier.id}`}
              >
                {tier.highlight && (
                  <Badge className="absolute -mt-3 self-center">Most popular</Badge>
                )}
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {tier.highlight && <Sparkles className="h-4 w-4 text-primary" />}
                    {tier.name}
                  </CardTitle>
                  <CardDescription>{tier.description}</CardDescription>
                  <div className="pt-2">
                    <span className="text-3xl font-bold" data-testid={`text-price-${tier.id}`}>{tier.priceLabel}</span>
                    {tier.priceCadence && <span className="text-muted-foreground text-sm ml-1">/{tier.priceCadence}</span>}
                  </div>
                </CardHeader>
                <CardContent className="flex-1 space-y-2">
                  {tier.features.map((f) => (
                    <div key={f} className="flex items-start gap-2 text-sm">
                      <Check className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </div>
                  ))}
                </CardContent>
                <CardFooter>
                  {tier.id === 'enterprise' ? (
                    <EnterpriseInquiryDialog />
                  ) : isCurrent ? (
                    <Button className="w-full" variant="outline" disabled data-testid={`button-current-${tier.id}`}>
                      Current plan
                    </Button>
                  ) : (
                    <Button
                      className="w-full"
                      variant={tier.highlight ? 'default' : 'outline'}
                      onClick={() => handleCta(tier)}
                      disabled={checkoutMutation.isPending}
                      data-testid={`button-cta-${tier.id}`}
                    >
                      {checkoutMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Zap className="h-4 w-4 mr-2" />
                      )}
                      {tier.cta}
                    </Button>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>

        <div className="mt-12 text-center text-sm text-muted-foreground max-w-2xl mx-auto space-y-2">
          <p>Re-revealing the same contact within 90 days is free. Cancel anytime from the billing portal.</p>
          <p className="text-xs">
            By subscribing or adding a payment method you agree to our{' '}
            <Link href="/terms" className="underline" data-testid="link-pricing-terms">Terms of Service</Link>{' '}
            and{' '}
            <Link href="/privacy" className="underline" data-testid="link-pricing-privacy">Privacy Policy</Link>.
            If a charge fails we'll pause reveals and email you so you can update your card.
          </p>
        </div>
      </div>
    </div>
  );
}
