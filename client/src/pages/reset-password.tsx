import { useState } from "react";
import { Link, useParams, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Database, ArrowLeft } from "lucide-react";

export default function ResetPassword() {
  const params = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const mutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/auth/reset-password", { token: params.token, password }),
    onSuccess: () => {
      toast({ title: "Password updated", description: "You can now sign in with your new password." });
      setLocation("/login");
    },
    onError: (err: any) => {
      toast({
        variant: "destructive",
        title: "Reset failed",
        description: err.message || "This link may be expired. Request a new one.",
      });
    },
  });

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="h-12 w-12 rounded-lg bg-primary flex items-center justify-center">
              <Database className="h-6 w-6 text-primary-foreground" />
            </div>
          </div>
          <CardTitle>Set a new password</CardTitle>
          <CardDescription>Choose a password you haven't used before.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (password !== confirm) {
                toast({ variant: "destructive", title: "Passwords don't match" });
                return;
              }
              mutation.mutate();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                data-testid="input-new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <Input
                id="confirm-password"
                type="password"
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                data-testid="input-confirm-password"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={mutation.isPending}
              data-testid="button-reset-password"
            >
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Update password
            </Button>
            <Button asChild variant="ghost" className="w-full">
              <Link href="/login" data-testid="link-back-to-login">
                <ArrowLeft className="h-4 w-4 mr-2" /> Back to sign in
              </Link>
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
