import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { MailWarning, Loader2 } from "lucide-react";

interface MeResponse {
  user: { id: number; email: string; isVerified: boolean } | null;
}

export default function VerificationBanner() {
  const [dismissed, setDismissed] = useState(false);
  const { toast } = useToast();
  const { data } = useQuery<MeResponse>({ queryKey: ["/api/auth/me"] });
  const resendMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/auth/resend-verification", {}),
    onSuccess: () =>
      toast({
        title: "Verification email sent",
        description: "Check your inbox for the confirmation link.",
      }),
    onError: (err: any) =>
      toast({
        variant: "destructive",
        title: "Couldn't send email",
        description: err?.message || "Try again in a minute.",
      }),
  });

  if (!data?.user || data.user.isVerified || dismissed) return null;

  return (
    <Alert className="rounded-none border-x-0 border-t-0">
      <MailWarning className="h-4 w-4" />
      <AlertDescription className="flex flex-wrap items-center gap-3 justify-between">
        <span data-testid="text-verification-banner">
          Please verify <span className="font-medium">{data.user.email}</span> to keep using your
          account.
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => resendMutation.mutate()}
            disabled={resendMutation.isPending}
            data-testid="button-resend-verification"
          >
            {resendMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin mr-2" />
            ) : null}
            Resend email
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDismissed(true)}
            data-testid="button-dismiss-verification"
          >
            Dismiss
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
