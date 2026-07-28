import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  FolderOpen, CheckCircle2, Clock, AlertCircle, 
  Loader2, Building2, Users, Calendar, Database, ChevronDown, ChevronRight
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import type { ExtractionJob, SchoolExtractionMeta } from "@shared/schema";

function BioCacheBreakdown({ jobId, metadata }: { jobId: number; metadata: Record<string, SchoolExtractionMeta> }) {
  const entries = Object.entries(metadata).filter(([, m]) =>
    (m.bioCacheHits ?? 0) + (m.bioPagesFetched ?? 0) + (m.bioEmailsRecovered ?? 0) > 0
  );
  if (entries.length === 0) return null;

  const totalHits = entries.reduce((s, [, m]) => s + (m.bioCacheHits ?? 0), 0);
  const totalFetched = entries.reduce((s, [, m]) => s + (m.bioPagesFetched ?? 0), 0);
  const totalRecovered = entries.reduce((s, [, m]) => s + (m.bioEmailsRecovered ?? 0), 0);
  const lookups = totalHits + totalFetched;
  const hitRate = lookups > 0 ? (totalHits / lookups) * 100 : 0;

  return (
    <div className="mt-3 border-t pt-3" data-testid={`bio-cache-section-${jobId}`}>
      <div className="flex items-center gap-2 mb-2">
        <Database className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">Bio Page Cache</span>
        <Badge variant="secondary" className="text-xs" data-testid={`badge-bio-hit-rate-${jobId}`}>
          {hitRate.toFixed(1)}% hit rate
        </Badge>
        <span className="text-xs text-muted-foreground">
          {totalHits}/{lookups} lookups · {totalFetched} fetched · {totalRecovered} emails recovered
        </span>
      </div>
      <div className="rounded-md border divide-y">
        {entries.map(([sid, m]) => {
          const sLookups = (m.bioCacheHits ?? 0) + (m.bioPagesFetched ?? 0);
          const sHit = sLookups > 0 ? ((m.bioCacheHits ?? 0) / sLookups) * 100 : 0;
          return (
            <div
              key={sid}
              className="grid grid-cols-5 items-center gap-2 px-3 py-2 text-xs"
              data-testid={`bio-row-${jobId}-${sid}`}
            >
              <div className="col-span-2 truncate font-medium" data-testid={`bio-school-${jobId}-${sid}`}>
                {sid}
              </div>
              <div data-testid={`bio-hit-rate-${jobId}-${sid}`}>
                <span className="text-muted-foreground">Hit rate:</span>{" "}
                <span className="font-medium">{sHit.toFixed(0)}%</span>
              </div>
              <div data-testid={`bio-counts-${jobId}-${sid}`}>
                <span className="text-muted-foreground">Hits/Fetched:</span>{" "}
                <span className="font-medium">{m.bioCacheHits ?? 0}/{m.bioPagesFetched ?? 0}</span>
              </div>
              <div data-testid={`bio-recovered-${jobId}-${sid}`}>
                <span className="text-muted-foreground">Recovered:</span>{" "}
                <span className="font-medium">{m.bioEmailsRecovered ?? 0}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getStatusBadge(status: string) {
  switch (status) {
    case "completed":
      return <Badge variant="default" data-testid={`badge-status-${status}`}><CheckCircle2 className="h-3 w-3 mr-1" />Completed</Badge>;
    case "running":
      return <Badge variant="secondary" data-testid={`badge-status-${status}`}><Loader2 className="h-3 w-3 mr-1 animate-spin" />Running</Badge>;
    case "pending":
      return <Badge variant="outline" data-testid={`badge-status-${status}`}><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
    case "failed":
      return <Badge variant="destructive" data-testid={`badge-status-${status}`}><AlertCircle className="h-3 w-3 mr-1" />Failed</Badge>;
    default:
      return <Badge variant="outline" data-testid={`badge-status-${status}`}>{status}</Badge>;
  }
}

function JobCard({ job }: { job: ExtractionJob }) {
  const progress = job.totalSchools && job.totalSchools > 0 
    ? Math.round((job.processedSchools || 0) / job.totalSchools * 100) 
    : 0;
  const metadata = (job.extractionMetadata || {}) as Record<string, SchoolExtractionMeta>;
  const hasBioMetrics = Object.values(metadata).some(m =>
    (m.bioCacheHits ?? 0) + (m.bioPagesFetched ?? 0) + (m.bioEmailsRecovered ?? 0) > 0
  );
  const [expanded, setExpanded] = useState(false);

  return (
    <Card data-testid={`card-job-${job.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-medium text-sm truncate" data-testid={`text-job-type-${job.id}`}>
                {job.type === 'single' ? 'Single School' : 
                 job.type === 'conference' ? 'Conference' : 
                 job.type === 'bulk' ? 'Bulk Extraction' : job.type}
              </span>
              {getStatusBadge(job.status)}
            </div>
            
            {job.targetId && (
              <p className="text-sm text-muted-foreground mb-2 truncate" data-testid={`text-job-target-${job.id}`}>
                Target: {job.targetId}
              </p>
            )}
            
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1" data-testid={`text-job-schools-${job.id}`}>
                <Building2 className="h-3 w-3" />
                {job.processedSchools || 0}/{job.totalSchools || 0} schools
              </span>
              <span className="flex items-center gap-1" data-testid={`text-job-contacts-${job.id}`}>
                <Users className="h-3 w-3" />
                {job.contactsFound || 0} contacts
              </span>
              <span className="flex items-center gap-1" data-testid={`text-job-time-${job.id}`}>
                <Calendar className="h-3 w-3" />
                {formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })}
              </span>
            </div>
            
            {job.status === 'running' && job.totalSchools && job.totalSchools > 0 && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span>Progress</span>
                  <span>{progress}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-primary transition-all duration-300" 
                    style={{ width: `${progress}%` }}
                    data-testid={`progress-bar-${job.id}`}
                  />
                </div>
              </div>
            )}

            {hasBioMetrics && (
              <div className="mt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 -ml-2 text-xs"
                  onClick={() => setExpanded(v => !v)}
                  data-testid={`button-toggle-bio-${job.id}`}
                >
                  {expanded ? <ChevronDown className="h-3 w-3 mr-1" /> : <ChevronRight className="h-3 w-3 mr-1" />}
                  Bio cache details
                </Button>
                {expanded && <BioCacheBreakdown jobId={job.id} metadata={metadata} />}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function JobsSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <Card key={i}>
          <CardContent className="p-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-5 w-20" />
              </div>
              <Skeleton className="h-3 w-48" />
              <div className="flex gap-4">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function Jobs() {
  const { data, isLoading, error } = useQuery<{ jobs: ExtractionJob[] }>({
    queryKey: ['/api/jobs'],
    refetchInterval: 5000,
  });

  const jobs = data?.jobs || [];
  
  const runningJobs = jobs.filter(j => j.status === 'running');
  const completedJobs = jobs.filter(j => j.status === 'completed');
  const pendingJobs = jobs.filter(j => j.status === 'pending');
  const failedJobs = jobs.filter(j => j.status === 'failed');

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <FolderOpen className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-jobs-title">Extraction Jobs</h1>
          <p className="text-sm text-muted-foreground">View all staff extraction jobs</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <Card data-testid="card-stats-running">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-primary" data-testid="text-count-running">{runningJobs.length}</div>
            <div className="text-xs text-muted-foreground">Running</div>
          </CardContent>
        </Card>
        <Card data-testid="card-stats-pending">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-muted-foreground" data-testid="text-count-pending">{pendingJobs.length}</div>
            <div className="text-xs text-muted-foreground">Pending</div>
          </CardContent>
        </Card>
        <Card data-testid="card-stats-completed">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-primary" data-testid="text-count-completed">{completedJobs.length}</div>
            <div className="text-xs text-muted-foreground">Completed</div>
          </CardContent>
        </Card>
        <Card data-testid="card-stats-failed">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-destructive" data-testid="text-count-failed">{failedJobs.length}</div>
            <div className="text-xs text-muted-foreground">Failed</div>
          </CardContent>
        </Card>
      </div>

      {error && (
        <Card className="border-destructive mb-4">
          <CardContent className="p-4">
            <p className="text-sm text-destructive" data-testid="text-error">Failed to load jobs</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <JobsSkeleton />
          ) : jobs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-jobs">
              <FolderOpen className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No extraction jobs yet</p>
              <p className="text-sm">Jobs will appear here when you extract staff data</p>
            </div>
          ) : (
            <ScrollArea className="h-[500px] pr-4">
              <div className="space-y-3">
                {jobs.map((job) => (
                  <JobCard key={job.id} job={job} />
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
