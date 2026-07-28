import { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Link, useSearch } from 'wouter';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { usePostCheckoutRefresh } from '@/hooks/use-post-checkout-refresh';
import { Loader2, ExternalLink, Users, Sparkles, Zap, AlertTriangle } from 'lucide-react';

interface BillingAccount {
  user: { id: number; email: string; fullName: string };
  plan: {
    id: string;
    name: string;
    status: string;
    hasActiveSubscription: boolean;
    canOpenPortal?: boolean;
    seats: number;
    pricePerSeatCents: number;
    monthlyTotalCents: number;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
  };
  usage: {
    lifetimeReveals: number;
    activeRevealsInGrace: number;
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
  const [seatInput, setSeatInput] = useState<number | null>(null);

  const { data, isLoading } = useQuery<BillingAccount>({
    queryKey: ['/api/billing/account'],
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', '/api/billing/portal');
    },
    onSuccess: (data) => {
      if (data?.url) window.location.href = data.url;
      else toast({ variant: 'destructive', title: 'Portal unavailable', description: data?.message || 'Subscribe first.' });
    },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Portal error', description: e.message }),
  });

  const seatsMutation = useMutation({
    mutationFn: async (seats: number) => {
      return await apiRequest('POST', '/api/billing/seats', { seats });
    },
    onSuccess: (_data, seats) => {
      toast({ title: 'Seats updated', description: `Your subscription now has ${seats} seat${seats === 1 ? '' : 's'}. Charges are prorated.` });
      setSeatInput(null);
      queryClient.invalidateQueries({ queryKey: ['/api/billing/account'] });
      queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
    },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Could not update seats', description: e.message }),
  });

  const checkoutSucceeded = new URLSearchParams(search).get('success') === 'true';
  usePostCheckoutRefresh(checkoutSucceeded, ['/api/billing/account', '/api/auth/me']);

  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get('success') === 'true') {
      toast({ title: 'Payment complete', description: 'Your subscription is being activated.' });
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
  const active = plan.hasActiveSubscription;
  const pastDue = plan.status === 'past_due';
  const canOpenPortal = plan.canOpenPortal ?? active;
  const pendingSeats = seatInput ?? plan.seats;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-billing-title">Billing</h1>
          <p className="text-sm text-muted-foreground">Manage your subscription, seats, and payment method.</p>
        </div>
        {canOpenPortal && (
          <Button
            onClick={() => portalMutation.mutate()}
            disabled={portalMutation.isPending}
            data-testid="button-open-portal"
          >
            {portalMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ExternalLink className="h-4 w-4 mr-2" />}
            Manage payment & invoices
          </Button>
        )}
      </div>

      {pastDue && (
        <Card className="border-destructive" data-testid="card-past-due">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Payment failed
            </CardTitle>
            <CardDescription>
              Your last payment didn't go through, so contact reveals are paused. Update your payment method to restore access.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => portalMutation.mutate()}
              disabled={portalMutation.isPending}
              data-testid="button-fix-payment"
            >
              {portalMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ExternalLink className="h-4 w-4 mr-2" />}
              Update payment method
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2" data-testid="text-current-plan">
                {plan.name} plan
                <Badge variant={active ? 'default' : 'secondary'} data-testid="badge-plan-status">
                  {plan.status === 'active' ? 'Active' : plan.status}
                </Badge>
              </CardTitle>
              <CardDescription>
                {active
                  ? `${plan.seats} seat${plan.seats === 1 ? '' : 's'} × ${formatCents(plan.pricePerSeatCents)}/month = ${formatCents(plan.monthlyTotalCents)}/month`
                  : '$25 per seat per month. Unlimited reveals.'}
              </CardDescription>
            </div>
            {active && (
              <div className="text-right text-sm">
                <div className="text-muted-foreground">Current period</div>
                <div data-testid="text-current-period">
                  {formatDate(plan.currentPeriodStart)} – {formatDate(plan.currentPeriodEnd)}
                </div>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {active ? (
            <div className="space-y-2">
              <Label htmlFor="billing-seats">Seats</Label>
              <div className="flex items-center gap-2 flex-wrap">
                <Input
                  id="billing-seats"
                  type="number"
                  min={1}
                  max={100}
                  value={pendingSeats}
                  onChange={(e) => setSeatInput(Math.max(1, Math.min(100, Math.floor(Number(e.target.value)) || 1)))}
                  className="w-24"
                  data-testid="input-billing-seats"
                />
                <Button
                  variant="outline"
                  onClick={() => seatsMutation.mutate(pendingSeats)}
                  disabled={seatsMutation.isPending || pendingSeats === plan.seats}
                  data-testid="button-update-seats"
                >
                  {seatsMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Update seats
                </Button>
                <span className="text-sm text-muted-foreground" data-testid="text-seats-total">
                  New total: {formatCents(pendingSeats * plan.pricePerSeatCents)}/month
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Seat changes are prorated by Stripe. To cancel or update your card, use “Manage payment & invoices”.
              </p>
            </div>
          ) : pastDue ? (
            <p className="text-sm text-muted-foreground">
              Your subscription is on hold until payment succeeds. Use “Update payment method” above to fix it — don't start a new subscription.
            </p>
          ) : (
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-sm text-muted-foreground">You don't have an active subscription.</p>
              <Link href="/pricing">
                <Button data-testid="button-subscribe-cta">
                  <Zap className="h-4 w-4 mr-2" />
                  Subscribe — $25/seat/month
                </Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Lifetime reveals
            </CardDescription>
            <CardTitle className="text-3xl" data-testid="text-lifetime-reveals">{usage.lifetimeReveals}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Total contacts you've revealed on Whistle.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              Reveals in 90-day grace
            </CardDescription>
            <CardTitle className="text-3xl" data-testid="text-grace-count">{usage.activeRevealsInGrace}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Re-revealing the same contact within 90 days is always free.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
