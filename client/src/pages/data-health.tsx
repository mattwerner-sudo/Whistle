import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  RefreshCw,
  Database,
  Clock,
  AlertTriangle,
  CheckCircle,
  Users,
  Building2,
  TrendingUp,
  Calendar,
  Star,
  XCircle,
  Eye,
  RotateCcw,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ConfidenceValue {
  value: number;
  confidence: number;
}

interface TierMetrics {
  total: number;
  extracted: number;
  stale: number;
  fresh: number;
  maxDays: number;
  averagePriorityScore: ConfidenceValue | null;
}

interface ConferenceMetrics {
  conference: string;
  tier: "power5" | "midTier" | "other";
  total: number;
  extracted: number;
  stale: number;
  fresh: number;
  contacts: number;
}

interface StaleSchoolInfo {
  schoolId: string;
  schoolName: string;
  conference: string | null;
  tier: "power5" | "midTier" | "other";
  lastExtractedAt: string | null;
  daysSinceExtraction: number | null;
  maxAllowedDays: number;
  contactsCount: number;
  priorityScore: number;
}

interface FailedSchoolInfo {
  schoolId: string;
  schoolName: string;
  conference: string | null;
  tier: "power5" | "midTier" | "other";
  failureReason: string | null;
  extractionAttempts: number;
  extractionError: string | null;
  lastAttemptedAt: string | null;
  needsReview: boolean;
}

interface FailureReasonBreakdown {
  url_not_found: number;
  timeout: number;
  blocked: number;
  no_contacts: number;
  parse_error: number;
  unknown: number;
}

interface ReverifyRunStats {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  batches: number;
  checked: number;
  changed: number;
  trigger: "scheduled" | "manual" | "startup";
  error?: string;
}

interface EmailVerificationStatus {
  enabled: boolean;
  running: boolean;
  intervalMs: number;
  batchSize: number;
  maxBatchesPerRun: number;
  staleAfterMs: number;
  lastRun: ReverifyRunStats | null;
  nextRunAt: string | null;
}

interface DataHealthMetrics {
  status: string;
  emailVerification?: EmailVerificationStatus;
  totalSchools: number;
  extractedSchools: number;
  pendingSchools: number;
  staleSchools: number;
  freshSchools: number;
  neverExtracted: number;
  failedSchools: number;
  needsReviewSchools: number;
  failureReasonBreakdown: FailureReasonBreakdown;
  freshnessPercentage: ConfidenceValue;
  averageDaysSinceExtraction: ConfidenceValue | null;
  totalContacts: number;
  averageConfidence: ConfidenceValue | null;
  averagePriorityScore: ConfidenceValue | null;
  byConferenceTier: {
    power5: TierMetrics;
    midTier: TierMetrics;
    other: TierMetrics;
  };
  byConference: ConferenceMetrics[];
  staleSchoolsList: StaleSchoolInfo[];
  failedSchoolsList: FailedSchoolInfo[];
  timestamp: string;
}

function getTierBadgeVariant(tier: string): "default" | "secondary" | "outline" {
  switch (tier) {
    case "power5":
      return "default";
    case "midTier":
      return "secondary";
    default:
      return "outline";
  }
}

function getTierLabel(tier: string): string {
  switch (tier) {
    case "power5":
      return "Power 5";
    case "midTier":
      return "Mid-Tier";
    default:
      return "Other";
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDaysFromMs(ms: number): string {
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  return `${days}d`;
}

function getFailureReasonLabel(reason: string | null): string {
  switch (reason) {
    case "url_not_found": return "URL Not Found";
    case "timeout": return "Timeout";
    case "blocked": return "Blocked";
    case "no_contacts": return "No Contacts";
    case "parse_error": return "Parse Error";
    default: return "Unknown";
  }
}

function getFailureReasonVariant(reason: string | null): "default" | "secondary" | "outline" | "destructive" {
  switch (reason) {
    case "blocked": return "destructive";
    case "timeout": return "destructive";
    case "url_not_found": return "secondary";
    case "no_contacts": return "outline";
    case "parse_error": return "secondary";
    default: return "outline";
  }
}

function formatConfidenceValue(cv: ConfidenceValue | null, suffix: string = ""): string {
  if (!cv) return "N/A";
  return `${cv.value}${suffix}`;
}

function getConfidenceIndicator(confidence: number): string {
  if (confidence >= 0.9) return "high";
  if (confidence >= 0.7) return "medium";
  return "low";
}

export default function DataHealth() {
  const { toast } = useToast();
  const [retryConferenceFilter, setRetryConferenceFilter] = useState<string>("all");

  const { data: metrics, isLoading, refetch } = useQuery<DataHealthMetrics>({
    queryKey: ["/api/data-health"],
    refetchInterval: 30000,
  });

  const refreshMutation = useMutation({
    mutationFn: async (tier?: string) => {
      return apiRequest("POST", "/api/data-health/refresh-stale", { tier, limit: 50 });
    },
    onSuccess: (data: any) => {
      toast({
        title: "Refresh Started",
        description: data.message || "Stale schools queued for re-extraction",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/data-health"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
    onError: (error: any) => {
      toast({
        title: "Refresh Failed",
        description: error.message || "Failed to queue stale schools",
        variant: "destructive",
      });
    },
  });

  const retryFailedMutation = useMutation({
    mutationFn: async (params?: { failureReason?: string; includeNeedsReview?: boolean }) => {
      return apiRequest("POST", "/api/data-health/retry-failed", { 
        failureReason: params?.failureReason, 
        includeNeedsReview: params?.includeNeedsReview ?? false,
        conference: retryConferenceFilter !== "all" ? retryConferenceFilter : undefined,
        limit: 50 
      });
    },
    onSuccess: (data: any) => {
      toast({
        title: "Retry Started",
        description: data.message || "Failed schools queued for retry",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/data-health"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
    onError: (error: any) => {
      toast({
        title: "Retry Failed",
        description: error.message || "Failed to queue schools for retry",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Data Health</h1>
            <p className="text-muted-foreground">Database freshness monitoring</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <AlertTriangle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h2 className="text-lg font-medium">Failed to load data health metrics</h2>
          <Button onClick={() => refetch()} className="mt-4" data-testid="button-retry">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-page-title">
            <Database className="h-6 w-6" />
            Data Health
          </h1>
          <p className="text-muted-foreground">
            Keep your college staff data evergreen and up to date
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            data-testid="button-refresh-metrics"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button
            onClick={() => refreshMutation.mutate(undefined)}
            disabled={refreshMutation.isPending || metrics.staleSchools === 0}
            data-testid="button-refresh-stale"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
            Refresh All Stale ({metrics.staleSchools})
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              Data Freshness
            </CardDescription>
            <CardTitle className="text-3xl" data-testid="text-freshness-percentage">
              {metrics.freshnessPercentage.value}%
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={metrics.freshnessPercentage.value} className="h-2" />
            <p className="text-xs text-muted-foreground mt-2">
              {metrics.freshSchools} of {metrics.extractedSchools} schools are fresh
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Stale Schools
            </CardDescription>
            <CardTitle className="text-3xl" data-testid="text-stale-count">
              {metrics.staleSchools}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              P5: {metrics.byConferenceTier.power5.stale} | Mid: {metrics.byConferenceTier.midTier.stale} | Other: {metrics.byConferenceTier.other.stale}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-destructive" />
              Failed
            </CardDescription>
            <CardTitle className="text-3xl" data-testid="text-failed-count">
              {metrics.failedSchools || 0}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {metrics.needsReviewSchools || 0} need manual review
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Avg. Age
            </CardDescription>
            <CardTitle className="text-3xl" data-testid="text-avg-age">
              {formatConfidenceValue(metrics.averageDaysSinceExtraction, "d")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Average days since last extraction
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Star className="h-4 w-4 text-yellow-500" />
              Priority Score
            </CardDescription>
            <CardTitle className="text-3xl" data-testid="text-priority-score">
              {formatConfidenceValue(metrics.averagePriorityScore)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Average score (0-100 scale)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Total Contacts
            </CardDescription>
            <CardTitle className="text-3xl" data-testid="text-total-contacts">
              {metrics.totalContacts.toLocaleString()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Avg. confidence: {formatConfidenceValue(metrics.averageConfidence, "%")}
            </p>
          </CardContent>
        </Card>
      </div>

      {metrics.emailVerification && (
        <Card data-testid="card-email-verification">
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  Email Verification
                </CardTitle>
                <CardDescription>
                  Automatic re-checking of stale and flagged contact emails
                </CardDescription>
              </div>
              <Badge
                variant={metrics.emailVerification.enabled ? "default" : "outline"}
                data-testid="badge-reverify-status"
              >
                {metrics.emailVerification.running
                  ? "Running"
                  : metrics.emailVerification.enabled
                    ? "Scheduled"
                    : "Disabled"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground text-xs">Last Run</div>
                <div className="font-medium" data-testid="text-reverify-last-run">
                  {formatDateTime(metrics.emailVerification.lastRun?.finishedAt ?? null)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Last Result</div>
                <div className="font-medium" data-testid="text-reverify-last-result">
                  {metrics.emailVerification.lastRun
                    ? metrics.emailVerification.lastRun.error
                      ? `Error: ${metrics.emailVerification.lastRun.error}`
                      : `${metrics.emailVerification.lastRun.checked} checked, ${metrics.emailVerification.lastRun.changed} changed`
                    : "\u2014"}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Next Run</div>
                <div className="font-medium" data-testid="text-reverify-next-run">
                  {formatDateTime(metrics.emailVerification.nextRunAt)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Settings</div>
                <div className="font-medium" data-testid="text-reverify-settings">
                  Stale after {formatDaysFromMs(metrics.emailVerification.staleAfterMs)}, up to{" "}
                  {metrics.emailVerification.batchSize * metrics.emailVerification.maxBatchesPerRun}/run
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {(["power5", "midTier", "other"] as const).map((tier) => {
          const tierData = metrics.byConferenceTier[tier];
          const freshPercent = tierData.extracted > 0 
            ? Math.round((tierData.fresh / tierData.extracted) * 100) 
            : 0;

          return (
            <Card key={tier}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Building2 className="h-5 w-5" />
                    {getTierLabel(tier)}
                  </CardTitle>
                  <Badge variant={getTierBadgeVariant(tier)}>
                    {tierData.maxDays}d max
                  </Badge>
                </div>
                <CardDescription>
                  {tierData.total} schools in this tier
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Freshness</span>
                  <span className="font-medium">{freshPercent}%</span>
                </div>
                <Progress value={freshPercent} className="h-2" />
                <div className="grid grid-cols-4 gap-2 text-center text-xs">
                  <div>
                    <div className="font-medium text-green-600">{tierData.fresh}</div>
                    <div className="text-muted-foreground">Fresh</div>
                  </div>
                  <div>
                    <div className="font-medium text-amber-600">{tierData.stale}</div>
                    <div className="text-muted-foreground">Stale</div>
                  </div>
                  <div>
                    <div className="font-medium">{tierData.extracted}</div>
                    <div className="text-muted-foreground">Extracted</div>
                  </div>
                  <div>
                    <div className="font-medium text-yellow-600">
                      {tierData.averagePriorityScore ? tierData.averagePriorityScore.value : "—"}
                    </div>
                    <div className="text-muted-foreground">Avg Score</div>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => refreshMutation.mutate(tier)}
                  disabled={refreshMutation.isPending || tierData.stale === 0}
                  data-testid={`button-refresh-${tier}`}
                >
                  <RefreshCw className={`h-3 w-3 mr-2 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
                  Refresh {tierData.stale} Stale
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Stale Schools Requiring Refresh
          </CardTitle>
          <CardDescription>
            Schools with outdated staff data sorted by priority (Power 5 first, then age)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {metrics.staleSchoolsList.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-500" />
              <p>All extracted schools are fresh!</p>
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>School</TableHead>
                    <TableHead>Conference</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Last Extracted</TableHead>
                    <TableHead>Age</TableHead>
                    <TableHead>Contacts</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.staleSchoolsList.map((school) => (
                    <TableRow key={school.schoolId} data-testid={`row-school-${school.schoolId}`}>
                      <TableCell className="font-medium">{school.schoolName}</TableCell>
                      <TableCell>{school.conference || "—"}</TableCell>
                      <TableCell>
                        <Badge variant={getTierBadgeVariant(school.tier)}>
                          {getTierLabel(school.tier)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={school.priorityScore >= 60 ? "default" : school.priorityScore >= 30 ? "secondary" : "outline"}>
                          {school.priorityScore}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Calendar className="h-3 w-3 text-muted-foreground" />
                          {formatDate(school.lastExtractedAt)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={school.daysSinceExtraction && school.daysSinceExtraction > school.maxAllowedDays * 2 ? "destructive" : "secondary"}>
                          {school.daysSinceExtraction !== null ? `${school.daysSinceExtraction}d` : "Never"} / {school.maxAllowedDays}d max
                        </Badge>
                      </TableCell>
                      <TableCell>{school.contactsCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {(metrics.failedSchools > 0 || metrics.needsReviewSchools > 0) && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <XCircle className="h-5 w-5 text-destructive" />
                  Failed Extractions
                </CardTitle>
                <CardDescription>
                  {metrics.failedSchools} failed ({metrics.needsReviewSchools} need manual review)
                </CardDescription>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Select value={retryConferenceFilter} onValueChange={setRetryConferenceFilter}>
                  <SelectTrigger className="w-[160px]" data-testid="select-retry-conference">
                    <SelectValue placeholder="All Conferences" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Conferences</SelectItem>
                    {Array.from(new Set(metrics.failedSchoolsList.map(s => s.conference).filter(Boolean) as string[])).sort().map(conf => (
                      <SelectItem key={conf} value={conf}>{conf}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {metrics.failureReasonBreakdown && Object.entries(metrics.failureReasonBreakdown)
                  .filter(([reason, count]) => count > 0 && reason !== 'unknown')
                  .map(([reason, count]) => (
                    <Button
                      key={reason}
                      variant="outline"
                      size="sm"
                      onClick={() => retryFailedMutation.mutate({ failureReason: reason })}
                      disabled={retryFailedMutation.isPending}
                      data-testid={`button-retry-${reason}`}
                    >
                      <RotateCcw className={`h-3 w-3 mr-1 ${retryFailedMutation.isPending ? "animate-spin" : ""}`} />
                      {getFailureReasonLabel(reason)} ({count})
                    </Button>
                  ))}
                <Button
                  onClick={() => retryFailedMutation.mutate({})}
                  disabled={retryFailedMutation.isPending || metrics.failedSchools === 0}
                  data-testid="button-retry-all-failed"
                >
                  <RotateCcw className={`h-4 w-4 mr-2 ${retryFailedMutation.isPending ? "animate-spin" : ""}`} />
                  Retry Failed ({metrics.failedSchools})
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {metrics.failedSchoolsList.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-500" />
                <p>No failed extractions</p>
              </div>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>School</TableHead>
                      <TableHead>Conference</TableHead>
                      <TableHead>Failure Reason</TableHead>
                      <TableHead>Attempts</TableHead>
                      <TableHead>Last Attempted</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {metrics.failedSchoolsList.map((school) => (
                      <TableRow key={school.schoolId} data-testid={`row-failed-${school.schoolId}`}>
                        <TableCell className="font-medium">{school.schoolName}</TableCell>
                        <TableCell>{school.conference || "\u2014"}</TableCell>
                        <TableCell>
                          <Badge variant={getFailureReasonVariant(school.failureReason)}>
                            {getFailureReasonLabel(school.failureReason)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-sm">{school.extractionAttempts}</span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Calendar className="h-3 w-3 text-muted-foreground" />
                            {formatDate(school.lastAttemptedAt)}
                          </div>
                        </TableCell>
                        <TableCell>
                          {school.needsReview ? (
                            <Badge variant="destructive" className="flex items-center gap-1 w-fit">
                              <Eye className="h-3 w-3" />
                              Needs Review
                            </Badge>
                          ) : (
                            <Badge variant="secondary">Failed</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground max-w-48 truncate block">
                            {school.extractionError || "\u2014"}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Freshness by Conference
          </CardTitle>
          <CardDescription>
            Data quality breakdown across all conferences
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Conference</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Schools</TableHead>
                  <TableHead>Extracted</TableHead>
                  <TableHead>Fresh</TableHead>
                  <TableHead>Stale</TableHead>
                  <TableHead>Contacts</TableHead>
                  <TableHead>Health</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {metrics.byConference.slice(0, 30).map((conf) => {
                  const healthPercent = conf.extracted > 0 
                    ? Math.round((conf.fresh / conf.extracted) * 100) 
                    : 0;

                  return (
                    <TableRow key={conf.conference} data-testid={`row-conference-${conf.conference}`}>
                      <TableCell className="font-medium">{conf.conference}</TableCell>
                      <TableCell>
                        <Badge variant={getTierBadgeVariant(conf.tier)}>
                          {getTierLabel(conf.tier)}
                        </Badge>
                      </TableCell>
                      <TableCell>{conf.total}</TableCell>
                      <TableCell>{conf.extracted}</TableCell>
                      <TableCell className="text-green-600">{conf.fresh}</TableCell>
                      <TableCell className="text-amber-600">{conf.stale}</TableCell>
                      <TableCell>{conf.contacts.toLocaleString()}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={healthPercent} className="h-2 w-16" />
                          <span className="text-xs text-muted-foreground">{healthPercent}%</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground text-center">
        Last updated: {new Date(metrics.timestamp).toLocaleString()} | 
        Freshness thresholds: Power 5 = 7 days, Mid-Tier = 14 days, Other = 30 days
      </div>
    </div>
  );
}
