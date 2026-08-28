import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Activity, 
  Download, 
  Search, 
  Users, 
  TrendingUp,
  Clock,
  School,
  AlertCircle
} from "lucide-react";
import { useState } from "react";
import { format, subDays } from "date-fns";

interface UsageStats {
  totalEvents: number;
  uniqueSessions: number;
  eventsByType: Record<string, number>;
  topSchools: Array<{ schoolId: string; schoolName: string; count: number }>;
  recentActivity: Array<{
    id: number;
    eventType: string;
    schoolId: string | null;
    schoolName: string | null;
    sessionId: string | null;
    details: Record<string, any> | null;
    createdAt: string;
  }>;
}

function StatCard({ title, value, icon: Icon, description }: { title: string; value: string | number; icon: any; description?: string }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </CardContent>
    </Card>
  );
}

function EventTypeBadge({ type }: { type: string }) {
  const variants: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; icon: any }> = {
    extraction: { variant: "default", icon: Users },
    export: { variant: "secondary", icon: Download },
    search: { variant: "outline", icon: Search },
    init: { variant: "outline", icon: Activity },
  };
  
  const config = variants[type] || { variant: "outline" as const, icon: Activity };
  const Icon = config.icon;
  
  return (
    <Badge variant={config.variant} className="gap-1">
      <Icon className="h-3 w-3" />
      {type}
    </Badge>
  );
}

export default function Reports() {
  const [timeRange, setTimeRange] = useState("7d");
  
  const getQueryUrl = () => {
    const now = new Date();
    const params = new URLSearchParams();
    
    switch (timeRange) {
      case "24h":
        params.set('startDate', subDays(now, 1).toISOString());
        params.set('endDate', now.toISOString());
        break;
      case "7d":
        params.set('startDate', subDays(now, 7).toISOString());
        params.set('endDate', now.toISOString());
        break;
      case "30d":
        params.set('startDate', subDays(now, 30).toISOString());
        params.set('endDate', now.toISOString());
        break;
      case "all":
      default:
        break;
    }
    
    return params.toString() ? `/api/reports/stats?${params}` : '/api/reports/stats';
  };
  
  const { data: stats, isLoading } = useQuery<UsageStats>({
    queryKey: ['/api/reports/stats', timeRange],
    queryFn: async () => {
      const url = getQueryUrl();
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch stats');
      return res.json();
    },
  });
  
  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64 mt-2" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }
  
  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="h-6 w-6" />
            Usage Reports
          </h1>
          <p className="text-muted-foreground">Track app activity, extractions, and exports</p>
        </div>
        <Select value={timeRange} onValueChange={setTimeRange}>
          <SelectTrigger className="w-[180px]" data-testid="select-time-range">
            <SelectValue placeholder="Select time range" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="24h">Last 24 hours</SelectItem>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="all">All time</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Events"
          value={stats?.totalEvents || 0}
          icon={Activity}
          description="Total tracked actions"
        />
        <StatCard
          title="Unique Sessions"
          value={stats?.uniqueSessions || 0}
          icon={Users}
          description="Anonymous user sessions"
        />
        <StatCard
          title="Extractions"
          value={stats?.eventsByType?.extraction || 0}
          icon={Download}
          description="School data extractions"
        />
        <StatCard
          title="Exports"
          value={stats?.eventsByType?.export || 0}
          icon={Download}
          description="Data exports"
        />
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <School className="h-5 w-5" />
              Top Schools by Activity
            </CardTitle>
            <CardDescription>Most extracted/viewed schools</CardDescription>
          </CardHeader>
          <CardContent>
            {stats?.topSchools && stats.topSchools.length > 0 ? (
              <div className="space-y-3">
                {stats.topSchools.map((school, index) => (
                  <div key={school.schoolId} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm text-muted-foreground w-6">{index + 1}.</span>
                      <span className="truncate font-medium">{school.schoolName || school.schoolId}</span>
                    </div>
                    <Badge variant="secondary">{school.count}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No school activity yet</p>
              </div>
            )}
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Recent Activity
            </CardTitle>
            <CardDescription>Latest tracked events</CardDescription>
          </CardHeader>
          <CardContent>
            {stats?.recentActivity && stats.recentActivity.length > 0 ? (
              <div className="space-y-3 max-h-[400px] overflow-y-auto">
                {stats.recentActivity.map((event) => (
                  <div key={event.id} className="flex items-start justify-between gap-2 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <EventTypeBadge type={event.eventType} />
                        {event.schoolName && (
                          <span className="text-muted-foreground truncate">{event.schoolName}</span>
                        )}
                      </div>
                      {event.details && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {event.details.query && <span>Query: "{event.details.query}"</span>}
                          {event.details.count !== undefined && <span> ({event.details.count} items)</span>}
                          {event.details.format && <span> Format: {event.details.format}</span>}
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(event.createdAt), 'MMM d, HH:mm')}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No activity recorded yet</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Events by Type
          </CardTitle>
          <CardDescription>Breakdown of activity types</CardDescription>
        </CardHeader>
        <CardContent>
          {stats?.eventsByType && Object.keys(stats.eventsByType).length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {Object.entries(stats.eventsByType).map(([type, count]) => (
                <div key={type} className="text-center p-4 rounded-lg bg-muted/50">
                  <EventTypeBadge type={type} />
                  <div className="text-2xl font-bold mt-2">{count}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No events recorded yet</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
