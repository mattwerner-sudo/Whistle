import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Rocket, 
  RefreshCw, 
  Users, 
  Zap, 
  TrendingDown, 
  TrendingUp, 
  Mail, 
  Check, 
  Copy,
  ArrowRight,
  Building2,
  Linkedin
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Signal } from "@shared/schema";

type SignalType = 'all' | 'new_hire' | 'departure' | 'tech_drop' | 'tech_add' | 'warm_path' | 'network_connection';

const signalTypeConfig: Record<string, { icon: typeof Rocket; label: string; color: string }> = {
  new_hire: { icon: Rocket, label: "New Hire", color: "bg-green-500/10 text-green-600 border-green-500/20" },
  departure: { icon: Users, label: "Departure", color: "bg-orange-500/10 text-orange-600 border-orange-500/20" },
  tech_drop: { icon: TrendingDown, label: "Tech Dropped", color: "bg-red-500/10 text-red-600 border-red-500/20" },
  tech_add: { icon: TrendingUp, label: "Tech Added", color: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  warm_path: { icon: Zap, label: "Warm Path", color: "bg-purple-500/10 text-purple-600 border-purple-500/20" },
  network_connection: { icon: Linkedin, label: "In Your Network", color: "bg-purple-500/10 text-purple-700 border-purple-500/20" },
};

function SignalCard({ signal, onDraftEmail }: { signal: Signal; onDraftEmail: (signal: Signal) => void }) {
  const config = signalTypeConfig[signal.type] || signalTypeConfig.new_hire;
  const Icon = config.icon;
  const meta = (signal.metadata as Record<string, any>) ?? {};
  
  const actionMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/signals/${signal.id}/action`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/signals'] });
    }
  });

  return (
    <Card className={`hover-elevate transition-all ${signal.isActioned ? 'opacity-60' : ''}`} data-testid={`card-signal-${signal.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg ${config.color}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className={config.color}>
                {config.label}
              </Badge>
              {signal.isActioned && (
                <Badge variant="secondary" className="text-xs">
                  <Check className="h-3 w-3 mr-1" />
                  Actioned
                </Badge>
              )}
              <span className="text-xs text-muted-foreground ml-auto">
                {signal.detectedAt ? new Date(signal.detectedAt).toLocaleDateString() : 'Recently'}
              </span>
            </div>
            <p className="text-sm font-medium" data-testid={`text-signal-description-${signal.id}`}>
              {signal.description}
            </p>
            {meta.newSchoolName && (
              <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                <Building2 className="h-3 w-3" />
                <span>{meta.newSchoolName}</span>
                {meta.oldSchoolName && (
                  <>
                    <ArrowRight className="h-3 w-3" />
                    <span>from {meta.oldSchoolName}</span>
                  </>
                )}
              </div>
            )}
            <div className="flex gap-2 mt-3">
              <Button 
                size="sm" 
                variant="outline"
                onClick={() => onDraftEmail(signal)}
                data-testid={`button-draft-email-${signal.id}`}
              >
                <Mail className="h-3 w-3 mr-1" />
                Draft Email
              </Button>
              {!signal.isActioned && (
                <Button 
                  size="sm" 
                  variant="ghost"
                  onClick={() => actionMutation.mutate()}
                  disabled={actionMutation.isPending}
                  data-testid={`button-mark-actioned-${signal.id}`}
                >
                  <Check className="h-3 w-3 mr-1" />
                  Mark Done
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EmailDraftDialog({ signal, open, onOpenChange }: { 
  signal: Signal | null; 
  open: boolean; 
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const meta = (signal?.metadata as Record<string, any>) || {};
  
  const draftMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/ai/signal-email", {
        signal,
        recipientName: meta.staffName || "Athletic Director",
        recipientEmail: "",
      });
      return response.json();
    }
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>AI Email Draft</DialogTitle>
          <DialogDescription>
            Generate a personalized email based on this signal
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Signal Context</CardTitle>
            </CardHeader>
            <CardContent className="py-2">
              <p className="text-sm text-muted-foreground">{signal?.description}</p>
            </CardContent>
          </Card>

          {!draftMutation.data && !draftMutation.isPending && (
            <Button 
              onClick={() => draftMutation.mutate()} 
              className="w-full"
              data-testid="button-generate-email"
            >
              <Mail className="h-4 w-4 mr-2" />
              Generate Email with AI
            </Button>
          )}

          {draftMutation.isPending && (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          )}

          {draftMutation.data && (
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium">Subject</label>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => copyToClipboard(draftMutation.data.subject)}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                <Card>
                  <CardContent className="p-3">
                    <p className="text-sm">{draftMutation.data.subject}</p>
                  </CardContent>
                </Card>
              </div>
              
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium">Body</label>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => copyToClipboard(draftMutation.data.body)}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                <Card>
                  <CardContent className="p-3">
                    <p className="text-sm whitespace-pre-wrap">{draftMutation.data.body}</p>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {draftMutation.isError && (
            <Card className="border-destructive">
              <CardContent className="p-3">
                <p className="text-sm text-destructive">Failed to generate email. Please try again.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function SignalsPage() {
  const [activeTab, setActiveTab] = useState<SignalType>('all');
  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);

  const signalsQuery = useQuery<{ signals: Signal[] }>({
    queryKey: ['/api/signals'],
  });

  const signals = signalsQuery.data?.signals || [];
  const filteredSignals = activeTab === 'all' 
    ? signals 
    : signals.filter(s => s.type === activeTab);

  const signalCounts = {
    all: signals.length,
    new_hire: signals.filter(s => s.type === 'new_hire').length,
    departure: signals.filter(s => s.type === 'departure').length,
    tech_drop: signals.filter(s => s.type === 'tech_drop').length,
    tech_add: signals.filter(s => s.type === 'tech_add').length,
    warm_path: signals.filter(s => s.type === 'warm_path' || s.type === 'network_connection').length,
    network_connection: signals.filter(s => s.type === 'network_connection').length,
  };

  const filteredVisible = activeTab === 'warm_path'
    ? signals.filter(s => s.type === 'warm_path' || s.type === 'network_connection')
    : filteredSignals;

  const handleDraftEmail = (signal: Signal) => {
    setSelectedSignal(signal);
    setEmailDialogOpen(true);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between p-4 border-b">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Signal Feed</h1>
          <p className="text-sm text-muted-foreground">
            High-intent events across your target accounts
          </p>
        </div>
        <Button 
          variant="outline" 
          onClick={() => signalsQuery.refetch()}
          disabled={signalsQuery.isFetching}
          data-testid="button-refresh-signals"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${signalsQuery.isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="flex-1 p-4 overflow-hidden">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as SignalType)}>
          <TabsList className="mb-4">
            <TabsTrigger value="all" data-testid="tab-all">
              All ({signalCounts.all})
            </TabsTrigger>
            <TabsTrigger value="new_hire" data-testid="tab-new-hire">
              <Rocket className="h-3 w-3 mr-1" />
              Hires ({signalCounts.new_hire})
            </TabsTrigger>
            <TabsTrigger value="warm_path" data-testid="tab-warm-path">
              <Zap className="h-3 w-3 mr-1" />
              Warm ({signalCounts.warm_path})
            </TabsTrigger>
            <TabsTrigger value="network_connection" data-testid="tab-network">
              <Linkedin className="h-3 w-3 mr-1" />
              Network ({signalCounts.network_connection})
            </TabsTrigger>
            <TabsTrigger value="tech_drop" data-testid="tab-tech-drop">
              <TrendingDown className="h-3 w-3 mr-1" />
              Tech- ({signalCounts.tech_drop})
            </TabsTrigger>
            <TabsTrigger value="tech_add" data-testid="tab-tech-add">
              <TrendingUp className="h-3 w-3 mr-1" />
              Tech+ ({signalCounts.tech_add})
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="h-[calc(100vh-220px)]">
            {signalsQuery.isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map(i => (
                  <Skeleton key={i} className="h-32 w-full" />
                ))}
              </div>
            ) : filteredVisible.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <Zap className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="font-semibold mb-2">No signals yet</h3>
                  <p className="text-sm text-muted-foreground">
                    Signals are generated when we detect new hires, departures, or technology changes across your target accounts.
                    Run an extraction job to start detecting signals.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {filteredVisible.map(signal => (
                  <SignalCard 
                    key={signal.id} 
                    signal={signal} 
                    onDraftEmail={handleDraftEmail}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        </Tabs>
      </div>

      <EmailDraftDialog 
        signal={selectedSignal}
        open={emailDialogOpen}
        onOpenChange={setEmailDialogOpen}
      />
    </div>
  );
}
