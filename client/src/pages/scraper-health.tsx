import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RefreshCw, Activity, AlertTriangle, CheckCircle, XCircle, Clock, Database } from "lucide-react";
import { queryClient } from "@/lib/queryClient";

interface ParserMetrics {
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  lastSuccess: string | null;
  lastFailure: string | null;
  avgExtractionTime: number;
  totalContacts: number;
  disabledUntil: string | null;
  bioEmailsRecovered: number;
  bioPagesFetched: number;
  bioCacheHits: number;
  bioEnrichedRuns: number;
}

interface BioCacheStats {
  totalRecovered: number;
  totalFetched: number;
  totalCacheHits: number;
  totalLookups: number;
  hitRate: number;
  enrichedRuns: number;
}

interface HealthData {
  status: string;
  parsers: Record<string, ParserMetrics>;
  overall: {
    totalExtractions: number;
    successRate: number;
    avgContactsPerExtraction: number;
    avgExtractionTime: number;
  };
  bioCache: BioCacheStats;
  errors: {
    timeout: number;
    forbidden: number;
    parsing: number;
    noContacts: number;
    other: number;
  };
  timestamp: string;
}

function StatCard({ title, value, subtitle, icon: Icon, trend }: { 
  title: string; 
  value: string | number; 
  subtitle?: string;
  icon: typeof Activity;
  trend?: "up" | "down" | "neutral";
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}

function ParserCard({ name, metrics }: { name: string; metrics: ParserMetrics }) {
  const isDisabled = metrics.disabledUntil && new Date(metrics.disabledUntil) > new Date();
  const totalRuns = metrics.successCount + metrics.failureCount;
  const successRate = totalRuns > 0 ? (metrics.successCount / totalRuns) * 100 : 0;
  
  return (
    <Card className={isDisabled ? "border-destructive/50 bg-destructive/5" : ""}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base capitalize">{name}</CardTitle>
          {isDisabled ? (
            <Badge variant="destructive" className="gap-1">
              <XCircle className="h-3 w-3" />
              Circuit Open
            </Badge>
          ) : metrics.consecutiveFailures > 0 ? (
            <Badge variant="secondary" className="gap-1 bg-yellow-500/10 text-yellow-600">
              <AlertTriangle className="h-3 w-3" />
              {metrics.consecutiveFailures} failures
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1 bg-green-500/10 text-green-600">
              <CheckCircle className="h-3 w-3" />
              Healthy
            </Badge>
          )}
        </div>
        <CardDescription>
          {totalRuns} extractions, {metrics.totalContacts} contacts
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span>Success Rate</span>
            <span className="font-medium">{successRate.toFixed(1)}%</span>
          </div>
          <Progress value={successRate} className="h-2" />
        </div>
        
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-muted-foreground">Avg Time</span>
            <p className="font-medium">{Math.round(metrics.avgExtractionTime)}ms</p>
          </div>
          <div>
            <span className="text-muted-foreground">Contacts/Run</span>
            <p className="font-medium">
              {metrics.successCount > 0 
                ? Math.round(metrics.totalContacts / metrics.successCount) 
                : 0}
            </p>
          </div>
        </div>

        {(() => {
          const bioLookups = metrics.bioPagesFetched + metrics.bioCacheHits;
          if (bioLookups === 0) return null;
          const hitPct = (metrics.bioCacheHits / bioLookups) * 100;
          return (
            <div className="border-t pt-3 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Database className="h-3 w-3" />
                  Bio Cache Hit Rate
                </span>
                <span className="font-medium" data-testid={`text-bio-hit-rate-${name}`}>
                  {hitPct.toFixed(1)}%
                </span>
              </div>
              <Progress value={hitPct} className="h-2" />
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Hits</span>
                  <p className="font-medium" data-testid={`text-bio-hits-${name}`}>{metrics.bioCacheHits}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Fetched</span>
                  <p className="font-medium" data-testid={`text-bio-fetched-${name}`}>{metrics.bioPagesFetched}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Recovered</span>
                  <p className="font-medium" data-testid={`text-bio-recovered-${name}`}>{metrics.bioEmailsRecovered}</p>
                </div>
              </div>
            </div>
          );
        })()}
        
        {isDisabled && metrics.disabledUntil && (
          <div className="text-xs text-destructive flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Re-enables at {new Date(metrics.disabledUntil).toLocaleTimeString()}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ErrorBreakdown({ errors }: { errors: HealthData["errors"] }) {
  const total = Object.values(errors).reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;
  
  const categories = [
    { key: "timeout", label: "Timeout", color: "bg-yellow-500" },
    { key: "forbidden", label: "403 Forbidden", color: "bg-red-500" },
    { key: "parsing", label: "Parse Error", color: "bg-orange-500" },
    { key: "noContacts", label: "No Contacts", color: "bg-blue-500" },
    { key: "other", label: "Other", color: "bg-gray-500" },
  ] as const;
  
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Error Breakdown</CardTitle>
        <CardDescription>{total} total errors</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {categories.map(({ key, label, color }) => {
          const count = errors[key];
          const pct = total > 0 ? (count / total) * 100 : 0;
          if (count === 0) return null;
          return (
            <div key={key} className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${color}`} />
              <span className="text-sm flex-1">{label}</span>
              <span className="text-sm font-medium">{count}</span>
              <span className="text-xs text-muted-foreground w-12 text-right">
                {pct.toFixed(0)}%
              </span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export default function ScraperHealthPage() {
  const { data, isLoading, refetch, isFetching } = useQuery<HealthData>({
    queryKey: ["/api/scraper/health"],
    refetchInterval: 10000,
  });
  
  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/scraper/health"] });
    refetch();
  };
  
  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-9 w-24" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      </div>
    );
  }
  
  const parsers = data?.parsers ? Object.entries(data.parsers) : [];
  
  return (
    <div className="p-6 space-y-6" data-testid="scraper-health-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Scraper Health</h1>
          <p className="text-muted-foreground">
            Parser performance, circuit breaker status, and error tracking
          </p>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={handleRefresh}
          disabled={isFetching}
          data-testid="button-refresh"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <StatCard 
          title="Total Extractions" 
          value={data?.overall.totalExtractions || 0}
          icon={Activity}
        />
        <StatCard 
          title="Success Rate" 
          value={`${(data?.overall.successRate || 0).toFixed(1)}%`}
          icon={CheckCircle}
        />
        <StatCard 
          title="Avg Contacts/Run" 
          value={(data?.overall.avgContactsPerExtraction || 0).toFixed(1)}
          icon={Activity}
        />
        <StatCard 
          title="Avg Time" 
          value={`${Math.round(data?.overall.avgExtractionTime || 0)}ms`}
          icon={Clock}
        />
        <StatCard 
          title="Bio Cache Hit Rate" 
          value={`${(data?.bioCache?.hitRate || 0).toFixed(1)}%`}
          subtitle={
            data?.bioCache && data.bioCache.totalLookups > 0
              ? `${data.bioCache.totalCacheHits} of ${data.bioCache.totalLookups} lookups`
              : "No bio enrichment yet"
          }
          icon={Database}
        />
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-lg font-semibold">Parser Performance</h2>
          {parsers.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No parser metrics recorded yet. Run an extraction to see data.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {parsers.map(([name, metrics]) => (
                <ParserCard key={name} name={name} metrics={metrics} />
              ))}
            </div>
          )}
        </div>
        
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Error Analysis</h2>
          {data?.errors && <ErrorBreakdown errors={data.errors} />}
          
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Circuit Breaker</CardTitle>
              <CardDescription>Automatic parser recovery</CardDescription>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Failure Threshold</span>
                <span className="font-medium">3 consecutive</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Recovery Time</span>
                <span className="font-medium">30 minutes</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Active Parsers</span>
                <span className="font-medium">
                  {parsers.filter(([_, m]) => !m.disabledUntil || new Date(m.disabledUntil) <= new Date()).length}
                  /{parsers.length}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-bio-cache">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Database className="h-4 w-4" />
                Bio Page Cache
              </CardTitle>
              <CardDescription>
                Per-staffer bio fetches reused across scrapes
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              {data?.bioCache && data.bioCache.totalLookups > 0 ? (
                <>
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-muted-foreground">Hit Rate</span>
                      <span className="font-medium" data-testid="text-bio-cache-hit-rate">
                        {data.bioCache.hitRate.toFixed(1)}%
                      </span>
                    </div>
                    <Progress value={data.bioCache.hitRate} className="h-2" />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cache Hits</span>
                    <span className="font-medium" data-testid="text-bio-cache-hits">
                      {data.bioCache.totalCacheHits}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Pages Fetched</span>
                    <span className="font-medium" data-testid="text-bio-cache-fetched">
                      {data.bioCache.totalFetched}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Emails Recovered</span>
                    <span className="font-medium" data-testid="text-bio-cache-recovered">
                      {data.bioCache.totalRecovered}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Enriched Runs</span>
                    <span className="font-medium" data-testid="text-bio-cache-runs">
                      {data.bioCache.enrichedRuns}
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-muted-foreground text-xs">
                  No bio enrichment yet. Stats appear after the scraper recovers
                  emails from staffer bio pages.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      
      {data?.timestamp && (
        <p className="text-xs text-muted-foreground text-center">
          Last updated: {new Date(data.timestamp).toLocaleString()}
        </p>
      )}
    </div>
  );
}
