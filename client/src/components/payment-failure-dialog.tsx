import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { CreditCard, ExternalLink, Loader2 } from "lucide-react";

export interface PaymentFailureInfo {
  message: string;
  declineCode?: string | null;
  errorCode?: string | null;
}

interface Props {
  open: boolean;
  info: PaymentFailureInfo | null;
  onOpenChange: (open: boolean) => void;
}

// Module-level event bus so any component can pop the same payment-failure
// dialog without needing prop-drilling through every consumer.
const PAYMENT_FAILURE_EVENT = "whistle:payment-failure";
export function emitPaymentFailure(info: PaymentFailureInfo) {
  window.dispatchEvent(new CustomEvent(PAYMENT_FAILURE_EVENT, { detail: info }));
}

export function GlobalPaymentFailureDialog() {
  const [info, setInfo] = useState<PaymentFailureInfo | null>(null);
  useEffect(() => {
    const handler = (e: Event) => setInfo((e as CustomEvent<PaymentFailureInfo>).detail);
    window.addEventListener(PAYMENT_FAILURE_EVENT, handler);
    return () => window.removeEventListener(PAYMENT_FAILURE_EVENT, handler);
  }, []);
  return (
    <PaymentFailureDialog
      open={!!info}
      info={info}
      onOpenChange={(open) => { if (!open) setInfo(null); }}
    />
  );
}

export default function PaymentFailureDialog({ open, info, onOpenChange }: Props) {
  const { toast } = useToast();
  const portalMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/billing/portal"),
    onSuccess: (data) => {
      if (data?.url) {
        window.location.href = data.url;
      } else {
        toast({
          variant: "destructive",
          title: "Portal unavailable",
          description: data?.message || "Add a payment method on the billing page first.",
        });
      }
    },
    onError: (e: any) => {
      toast({
        variant: "destructive",
        title: "Couldn't open billing portal",
        description: e?.message || "Open the billing page to update your payment method.",
      });
    },
  });

  const tag = info?.declineCode || info?.errorCode || null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-payment-failure">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-destructive" />
            Payment couldn't be processed
          </DialogTitle>
          <DialogDescription data-testid="text-payment-failure-message">
            {info?.message || "Your card was declined."}
            {tag ? (
              <span className="block mt-2 text-xs text-muted-foreground">
                Reason from your bank: <code>{tag}</code>
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Link href="/settings/billing">
            <Button variant="outline" data-testid="link-billing-page" onClick={() => onOpenChange(false)}>
              View billing
            </Button>
          </Link>
          <Button
            onClick={() => portalMutation.mutate()}
            disabled={portalMutation.isPending}
            data-testid="button-update-payment-method"
          >
            {portalMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <ExternalLink className="h-4 w-4 mr-2" />
            )}
            Update payment method
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
