import { useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Link, useSearch } from 'wouter';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { usePostCheckoutRefresh } from '@/hooks/use-post-checkout-refresh';
import { Loader2, CreditCard, ExternalLink, TrendingUp, Sparkles } from 'lucide-react';

interface BillingAccount {
  user: { id: number; email: string; fullName: string };
  plan: {
    id: string;
    name: string;
    status: string;
    monthlyPriceCents: number | null;
    includedReveals: number | null;
    overageRateCents: number | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
  };
  usage: {
    revealsThisPeriod: number;
    overageThisPeriod: number;
    overageCostCents: number;
    lifetimeReveals: number;
    activeRevealsInGrace: number;
    creditsBalance: number;
  };
}

function formatCents(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function Billing() {
  const { toast } = useToast();
  const search = useSearch();

  const { data, isLoading } = useQuery<BillingAccount>({
    queryKey: ['/api/billing/account'],
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', '/api/billing/portal');
    },
    onSuccess: (data) => {
      if (data?.url) window.location.href = data.url;
      else toast({ variant: 'destructive', title: 'Portal unavailable', description: data?.message || 'Add a payment method first.' });
    },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Portal error', description: e.message }),
  });

  const checkoutSucceeded = new URLSearchParams(search).get('success') === 'true';
  usePostCheckoutRefresh(checkoutSucceeded, ['/api/billing/account', '/api/auth/me']);

  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get('success') === 'true') {
      toast({ title: 'Payment complete', description: 'Your plan is being activated.' });
    }
    if (params.get('canceled') === 'true') {
      toast({ variant: 'destructive', title: 'Checkout canceled' });
    }
  }, [search, toast]);

  if (isLoading || !data) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { plan, usage } = data;
  const isPaid = plan.id === 'pro' || plan.id === 'team' || plan.id === 'enterprise';

  const includedReveals = plan.includedReveals ?? 0;
  const usedPct = includedReveals > 0 ? Math.min(100, Math.round((usage.revealsThisPeriod / includedReveals) * 100)) : 0;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-billing-title">Billing & Usage</h1>
          <p className="text-sm text-muted-foreground">Manage your plan, track reveals, and view invoices.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/pricing">
            <Button variant="outline" data-testid="link-view-pricing">
              <TrendingUp className="h-4 w-4 mr-2" />
              View plans
            </Button>
          </Link>
          <Button
            onClick={() => portalMutation.mutate()}
            disabled={portalMutation.isPending}
            data-testid="button-open-portal"
          >
            {portalMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ExternalLink className="h-4 w-4 mr-2" />}
            Manage billing
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2" data-testid="text-current-plan">
                {plan.name} plan
                <Badge variant={isPaid ? 'default' : 'secondary'}>
                  {plan.status === 'active' ? 'Active' : plan.status}
                </Badge>
              </CardTitle>
              <CardDescription>

                {isPaid && includedReveals > 0 && `${includedReveals} reveals/month included`}
                {isPaid && plan.overageRateCents != null && `, then ${formatCents(plan.overageRateCents)} each.`}
              </CardDescription>
            </div>
            <div className="text-right text-sm">
              <div className="text-muted-foreground">Current period</div>
              <div data-testid="text-current-period">
                {formatDate(plan.currentPeriodStart)} – {formatDate(plan.currentPeriodEnd)}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {includedReveals > 0 && (
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span data-testid="text-usage-summary">
                  {usage.revealsThisPeriod} / {includedReveals} reveals used this period
                </span>
                <span className="text-muted-foreground">{usedPct}%</span>
              </div>
              <Progress value={usedPct} />
            </div>
          )}
          {usage.overageThisPeriod > 0 && (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm flex justify-between">
              <span>{usage.overageThisPeriod} overage reveals</span>
              <span className="font-medium" data-testid="text-overage-cost">{formatCents(usage.overageCostCents)} due at end of cycle</span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              Reveals in 90-day grace
            </CardDescription>
            <CardTitle className="text-3xl" data-testid="text-grace-count">{usage.activeRevealsInGrace}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Re-revealing the same contact within 90 days is free.
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Need more?</CardTitle>
          <CardDescription>Pick a plan that fits your team.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/pricing">
            <Button data-testid="link-pricing-cta">
              See pricing options
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
