import { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Link, useSearch } from 'wouter';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { usePostCheckoutRefresh } from '@/hooks/use-post-checkout-refresh';
import { Check, Loader2, Zap, Database, Minus, Plus } from 'lucide-react';

interface UserResponse {
  user: {
    id: number;
    email: string;
    fullName: string;
    subscriptionStatus?: string;
  } | null;
}

const PRICE_PER_SEAT = 25;
const MAX_SEATS = 100;

const FEATURES = [
  'Browse all 1,300+ schools',
  'Search 19k+ staff names & titles',
  'Unlimited contact reveals',
  'Verified emails & phone numbers',
  'CSV exports & list building',
  'Hiring & departure signals',
];

export default function Pricing() {
  const { toast } = useToast();
  const searchString = useSearch();
  const [seats, setSeats] = useState(1);

  const { data: userResponse } = useQuery<UserResponse>({
    queryKey: ['/api/auth/me'],
  });
  const user = userResponse?.user ?? null;
  const hasActiveSub = user?.subscriptionStatus === 'active';

  const checkoutMutation = useMutation({
    mutationFn: async (params: { seats: number }) => {
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
    if (params.get('success') === 'true') toast({ title: 'Success!', description: 'Your subscription is being activated.' });
    if (params.get('canceled') === 'true') toast({ variant: 'destructive', title: 'Checkout canceled' });
  }, [searchString, toast]);

  function clampSeats(n: number) {
    return Math.max(1, Math.min(MAX_SEATS, Math.floor(n) || 1));
  }

  function handleSubscribe() {
    if (!user) {
      window.location.href = '/login';
      return;
    }
    checkoutMutation.mutate({ seats });
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
          <h1 className="text-4xl font-bold mb-4" data-testid="text-pricing-title">One plan. $25 per seat.</h1>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Every seat gets full access to the entire college athletics contact database. No tiers, no credits, no surprises.
          </p>
        </div>

        <div className="max-w-md mx-auto">
          <Card className="border-primary shadow-md" data-testid="card-plan-standard">
            <CardHeader>
              <CardTitle>Whistle</CardTitle>
              <CardDescription>Full access for your whole team.</CardDescription>
              <div className="pt-2">
                <span className="text-4xl font-bold" data-testid="text-price-standard">${PRICE_PER_SEAT}</span>
                <span className="text-muted-foreground text-sm ml-1">/seat/month</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                {FEATURES.map((f) => (
                  <div key={f} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                    <span>{f}</span>
                  </div>
                ))}
              </div>

              {!hasActiveSub && (
                <div className="pt-2 space-y-2">
                  <Label htmlFor="seat-count">Seats</Label>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setSeats((s) => clampSeats(s - 1))}
                      disabled={seats <= 1}
                      data-testid="button-seats-decrease"
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <Input
                      id="seat-count"
                      type="number"
                      min={1}
                      max={MAX_SEATS}
                      value={seats}
                      onChange={(e) => setSeats(clampSeats(Number(e.target.value)))}
                      className="w-20 text-center"
                      data-testid="input-seats"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setSeats((s) => clampSeats(s + 1))}
                      disabled={seats >= MAX_SEATS}
                      data-testid="button-seats-increase"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                    <span className="text-sm text-muted-foreground ml-2" data-testid="text-monthly-total">
                      ${seats * PRICE_PER_SEAT}/month total
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">You can also adjust the seat count on the checkout page or later from Billing.</p>
                </div>
              )}
            </CardContent>
            <CardFooter>
              {hasActiveSub ? (
                <Link href="/settings/billing" className="w-full">
                  <Button className="w-full" variant="outline" data-testid="button-manage-plan">
                    You're subscribed — manage plan
                  </Button>
                </Link>
              ) : (
                <Button
                  className="w-full"
                  onClick={handleSubscribe}
                  disabled={checkoutMutation.isPending}
                  data-testid="button-subscribe"
                >
                  {checkoutMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Zap className="h-4 w-4 mr-2" />
                  )}
                  Subscribe
                </Button>
              )}
            </CardFooter>
          </Card>
        </div>

        <div className="mt-12 text-center text-sm text-muted-foreground max-w-2xl mx-auto space-y-2">
          <p>Cancel anytime from the billing portal. Contacts you've revealed stay available for 90 days.</p>
          <p className="text-xs">
            By subscribing you agree to our{' '}
            <Link href="/terms" className="underline" data-testid="link-pricing-terms">Terms of Service</Link>{' '}
            and{' '}
            <Link href="/privacy" className="underline" data-testid="link-pricing-privacy">Privacy Policy</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
