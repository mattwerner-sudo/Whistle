import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Linkedin, Download, Key, Trash2, RefreshCw, Copy, Check, Users, ExternalLink, ChevronRight } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ConnectionRow {
  id: number;
  fullName: string | null;
  headline: string | null;
  profileUrl: string | null;
  matchedStaffId: number | null;
  matchedSchoolId: string | null;
  schoolName: string | null;
  staffName: string | null;
  staffTitle: string | null;
  matchConfidence: number | null;
}

export default function WhistleConnect() {
  const { toast } = useToast();
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: status, isLoading: statusLoading } = useQuery<{
    totalConnections: number;
    matchedConnections: number;
    lastSyncAt: string | null;
  }>({
    queryKey: ["/api/linkedin/sync-status"],
  });

  const { data: keysData } = useQuery<{ keys: Array<{ id: number; prefix: string; label: string; lastUsedAt: string | null; createdAt: string }> }>({
    queryKey: ["/api/linkedin/api-keys"],
  });

  const { data: connections, isLoading: connectionsLoading } = useQuery<{ connections: ConnectionRow[] }>({
    queryKey: ["/api/linkedin/connections", { matched: true }],
    queryFn: async () => {
      const res = await fetch("/api/linkedin/connections?matched=true&limit=50", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const createKey = useMutation({
    mutationFn: async () => {
      return await apiRequest<{ key: string; prefix: string }>("POST", "/api/linkedin/api-key", {});
    },
    onSuccess: (data) => {
      setRevealedKey(data.key);
      queryClient.invalidateQueries({ queryKey: ["/api/linkedin/api-keys"] });
      toast({ title: "API key created", description: "Save it now — it won't be shown again." });
    },
    onError: (e: Error) => {
      toast({ title: "Failed to create key", description: e.message, variant: "destructive" });
    },
  });

  const revokeKey = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest<{ success: boolean }>("DELETE", `/api/linkedin/api-key/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/linkedin/api-keys"] });
      toast({ title: "Key revoked" });
    },
  });

  const rematch = useMutation({
    mutationFn: async () => {
      return await apiRequest<{ matchedCount: number; signalsCreated: number }>("POST", "/api/linkedin/rematch", {});
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/linkedin/sync-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/linkedin/connections"] });
      toast({ title: "Rematch complete", description: `${data.matchedCount} matched, ${data.signalsCreated} new signals` });
    },
  });

  const resync = useMutation({
    mutationFn: async () => {
      return await apiRequest<{ success: boolean; forceFullSync: boolean }>("POST", "/api/linkedin/resync", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/linkedin/sync-status"] });
      toast({
        title: "Resync requested",
        description: "Open the Whistle Connect extension and click Sync — it will re-fetch every connection.",
      });
    },
  });

  const copyKey = () => {
    if (!revealedKey) return;
    navigator.clipboard.writeText(revealedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-page-title">
            <Linkedin className="h-6 w-6 text-purple-600" />
            Whistle Connect
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sync your LinkedIn 1st-degree connections to Whistle. We match them to NCAA athletic staff so you can see warm paths into every school.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card data-testid="card-stat-total">
          <CardHeader className="pb-2">
            <CardDescription>Total connections synced</CardDescription>
          </CardHeader>
          <CardContent>
            {statusLoading ? <Skeleton className="h-8 w-20" /> : (
              <div className="text-2xl font-semibold" data-testid="text-total-connections">{status?.totalConnections ?? 0}</div>
            )}
          </CardContent>
        </Card>
        <Card data-testid="card-stat-matched">
          <CardHeader className="pb-2">
            <CardDescription>People you know in NCAA athletics</CardDescription>
          </CardHeader>
          <CardContent>
            {statusLoading ? <Skeleton className="h-8 w-20" /> : (
              <div className="text-2xl font-semibold text-purple-700" data-testid="text-matched-connections">
                {status?.matchedConnections ?? 0}
              </div>
            )}
          </CardContent>
        </Card>
        <Card data-testid="card-stat-last-sync">
          <CardHeader className="pb-2">
            <CardDescription>Last sync</CardDescription>
          </CardHeader>
          <CardContent>
            {statusLoading ? <Skeleton className="h-8 w-32" /> : (
              <div className="text-sm" data-testid="text-last-sync">
                {status?.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : "Never"}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">1. Install the Chrome extension</CardTitle>
          <CardDescription>One-time install. Connections never leave your browser except to your Whistle workspace.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button asChild data-testid="button-download-extension">
            <a href="/api/linkedin/extension.zip" download>
              <Download className="h-4 w-4 mr-2" />
              Download Whistle Connect (.zip)
            </a>
          </Button>
          <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
            <li>Unzip the file.</li>
            <li>Open <code className="text-xs">chrome://extensions/</code> and toggle <strong>Developer mode</strong> on.</li>
            <li>Click <strong>Load unpacked</strong> and select the unzipped folder.</li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">2. Generate your API key</CardTitle>
          <CardDescription>Each key is bound to your account. Paste it into the extension popup.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {revealedKey && (
            <Alert>
              <AlertTitle>Your new key — save it now</AlertTitle>
              <AlertDescription className="space-y-2">
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-muted px-2 py-1.5 rounded break-all" data-testid="text-revealed-key">{revealedKey}</code>
                  <Button size="sm" variant="outline" onClick={copyKey} data-testid="button-copy-key">
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  This is the only time you'll see this key. Whistle stores only a hashed version.
                </p>
              </AlertDescription>
            </Alert>
          )}

          <Button onClick={() => createKey.mutate()} disabled={createKey.isPending} data-testid="button-create-key">
            <Key className="h-4 w-4 mr-2" />
            {createKey.isPending ? "Creating..." : "Create API key"}
          </Button>

          {keysData && keysData.keys.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-medium">Your keys</div>
              {keysData.keys.map(k => (
                <div key={k.id} className="flex items-center justify-between gap-2 border rounded-md px-3 py-2" data-testid={`row-apikey-${k.id}`}>
                  <div className="flex-1">
                    <div className="text-sm font-mono">{k.prefix}…</div>
                    <div className="text-xs text-muted-foreground">
                      Created {new Date(k.createdAt).toLocaleDateString()}
                      {k.lastUsedAt ? ` · Last used ${new Date(k.lastUsedAt).toLocaleDateString()}` : ' · Never used'}
                    </div>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => revokeKey.mutate(k.id)} data-testid={`button-revoke-${k.id}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="h-4 w-4" />
              People you know in NCAA athletics
            </CardTitle>
            <CardDescription>Matched from your synced LinkedIn network.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => resync.mutate()} disabled={resync.isPending} data-testid="button-resync-all">
              <RefreshCw className={`h-3 w-3 mr-2 ${resync.isPending ? "animate-spin" : ""}`} />
              Resync all
            </Button>
            <Button size="sm" variant="outline" onClick={() => rematch.mutate()} disabled={rematch.isPending} data-testid="button-rematch">
              <RefreshCw className={`h-3 w-3 mr-2 ${rematch.isPending ? "animate-spin" : ""}`} />
              Re-match
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {connectionsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : !connections || connections.connections.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              <Linkedin className="h-10 w-10 mx-auto mb-3 opacity-40" />
              No matches yet. Sync your connections from the extension to populate this list.
            </div>
          ) : (
            <div className="space-y-2">
              {connections.connections.map(c => (
                <div key={c.id} className="flex items-start justify-between gap-3 border rounded-md p-3" data-testid={`row-connection-${c.id}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-medium truncate" data-testid={`text-connection-name-${c.id}`}>{c.fullName || "(unknown)"}</div>
                      {c.matchConfidence === 100 && (
                        <Badge variant="secondary" className="text-xs">Exact match</Badge>
                      )}
                      {c.matchConfidence !== null && c.matchConfidence < 100 && (
                        <Badge variant="outline" className="text-xs">{c.matchConfidence}% match</Badge>
                      )}
                    </div>
                    {c.headline && <div className="text-xs text-muted-foreground truncate">{c.headline}</div>}
                    {c.schoolName && (
                      <div className="text-xs mt-1 text-purple-700 flex items-center gap-1">
                        <ChevronRight className="h-3 w-3" />
                        {c.staffTitle ? `${c.staffTitle} · ` : ""}{c.schoolName}
                      </div>
                    )}
                  </div>
                  {c.profileUrl && (
                    <Button size="icon" variant="ghost" asChild>
                      <a href={c.profileUrl} target="_blank" rel="noopener noreferrer" data-testid={`link-linkedin-${c.id}`}>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-privacy">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Privacy &amp; LinkedIn Terms</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1.5">
          <p>Your synced LinkedIn connections are scoped to your Whistle account — no other Whistle user can see them.</p>
          <p>Connection data is stored only in this Whistle workspace's database. Whistle Connect sends no third-party analytics.</p>
          <p>
            You are responsible for using Whistle Connect in compliance with the{" "}
            <a className="underline" href="https://www.linkedin.com/legal/user-agreement" target="_blank" rel="noopener noreferrer">LinkedIn User Agreement</a>.
            Revoke your API key any time to stop ingestion.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
