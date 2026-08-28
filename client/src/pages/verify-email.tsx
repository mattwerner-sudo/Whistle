import { useEffect, useState } from "react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Database, CheckCircle2, XCircle, Loader2 } from "lucide-react";

type Status = "verifying" | "success" | "error";

export default function VerifyEmail() {
  const [status, setStatus] = useState<Status>("verifying");
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (!token) {
      setStatus("error");
      setErrorMsg("Missing verification token.");
      return;
    }
    apiRequest("POST", "/api/auth/verify-email", { token })
      .then(() => setStatus("success"))
      .catch((err: any) => {
        setStatus("error");
        setErrorMsg(err?.message || "This verification link is invalid or has expired.");
      });
  }, []);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="h-12 w-12 rounded-lg bg-primary flex items-center justify-center">
              {status === "verifying" && <Loader2 className="h-6 w-6 text-primary-foreground animate-spin" />}
              {status === "success" && <CheckCircle2 className="h-6 w-6 text-primary-foreground" />}
              {status === "error" && <XCircle className="h-6 w-6 text-primary-foreground" />}
            </div>
          </div>
          <CardTitle>
            {status === "verifying" && "Verifying your email..."}
            {status === "success" && "Email verified"}
            {status === "error" && "Verification failed"}
          </CardTitle>
          <CardDescription>
            {status === "verifying" && "One moment, please."}
            {status === "success" && "Thanks! Your email is confirmed."}
            {status === "error" && errorMsg}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status !== "verifying" && (
            <Button asChild className="w-full" data-testid="button-go-to-app">
              <Link href="/dashboard">Go to Whistle</Link>
            </Button>
          )}
          <div className="flex items-center justify-center mt-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Database className="h-3 w-3" /> Whistle
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
