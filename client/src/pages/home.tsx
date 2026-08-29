import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Users, Building2, Search, Database, Download, 
  ArrowRight, TrendingUp, Sparkles, Target, Rocket,
  GraduationCap, Trophy, BarChart3, Clock, CheckCircle
} from 'lucide-react';

interface StatsResponse {
  totalSchools: number;
  extractedSchools: number;
  totalStaff: number;
  avgConfidence: number;
}

export default function Home() {
  const { data: stats } = useQuery<StatsResponse>({
    queryKey: ['/api/staff/stats'],
  });

  const totalSchools = stats?.totalSchools || 0;
  const extractedCount = stats?.extractedSchools || 0;
  const extractionProgress = totalSchools > 0 ? Math.round((extractedCount / totalSchools) * 100) : 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold text-foreground" data-testid="text-page-title">
            Welcome to Whistle
          </h1>
          <p className="text-muted-foreground mt-2">
            Your command center for college athletic staff data and sales intelligence
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card data-testid="card-stat-schools">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Schools</p>
                  <p className="text-3xl font-semibold text-foreground">{totalSchools.toLocaleString()}</p>
                </div>
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Building2 className="h-6 w-6 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-stat-extracted">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Schools Extracted</p>
                  <p className="text-3xl font-semibold text-foreground">{extractedCount.toLocaleString()}</p>
                </div>
                <div className="h-12 w-12 rounded-lg bg-green-500/10 flex items-center justify-center">
                  <CheckCircle className="h-6 w-6 text-green-500" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-stat-contacts">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Contacts</p>
                  <p className="text-3xl font-semibold text-foreground">{(stats?.totalStaff || 0).toLocaleString()}</p>
                </div>
                <div className="h-12 w-12 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Users className="h-6 w-6 text-blue-500" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-stat-confidence">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Avg Confidence</p>
                  <p className="text-3xl font-semibold text-foreground">{stats?.avgConfidence || 0}%</p>
                </div>
                <div className="h-12 w-12 rounded-lg bg-purple-500/10 flex items-center justify-center">
                  <TrendingUp className="h-6 w-6 text-purple-500" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mb-8">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-foreground">Database Coverage</h3>
                  <p className="text-sm text-muted-foreground">
                    {extractedCount} of {totalSchools} schools extracted
                  </p>
                </div>
                <Badge variant="secondary">{extractionProgress}%</Badge>
              </div>
              <Progress value={extractionProgress} className="h-2" />
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <Card className="hover-elevate cursor-pointer" data-testid="card-action-search">
            <Link href="/staff">
              <CardHeader>
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
                  <Search className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-lg">Search Staff</CardTitle>
                <CardDescription>
                  Search across {(stats?.totalStaff || 0).toLocaleString()} athletic department contacts
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center text-sm text-primary">
                  Browse directory <ArrowRight className="h-4 w-4 ml-1" />
                </div>
              </CardContent>
            </Link>
          </Card>

          <Card className="hover-elevate cursor-pointer" data-testid="card-action-schools">
            <Link href="/schools">
              <CardHeader>
                <div className="h-12 w-12 rounded-lg bg-green-500/10 flex items-center justify-center mb-2">
                  <GraduationCap className="h-6 w-6 text-green-500" />
                </div>
                <CardTitle className="text-lg">Browse Schools</CardTitle>
                <CardDescription>
                  Explore all {totalSchools} college institutions by conference and division
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center text-sm text-green-600">
                  View schools <ArrowRight className="h-4 w-4 ml-1" />
                </div>
              </CardContent>
            </Link>
          </Card>

          <Card className="hover-elevate cursor-pointer" data-testid="card-action-extract">
            <Link href="/schools">
              <CardHeader>
                <div className="h-12 w-12 rounded-lg bg-blue-500/10 flex items-center justify-center mb-2">
                  <Database className="h-6 w-6 text-blue-500" />
                </div>
                <CardTitle className="text-lg">Extract Data</CardTitle>
                <CardDescription>
                  Run AI-powered extraction on athletic department directories
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center text-sm text-blue-600">
                  Start extraction <ArrowRight className="h-4 w-4 ml-1" />
                </div>
              </CardContent>
            </Link>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Rocket className="h-5 w-5" />
                Quick Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link href="/list-matcher">
                <Button variant="outline" className="w-full justify-start gap-3" data-testid="button-abm-matcher">
                  <Target className="h-4 w-4" />
                  ABM List Matcher
                  <Badge variant="secondary" className="ml-auto">CSV Import</Badge>
                </Button>
              </Link>
              <Link href="/growth">
                <Button variant="outline" className="w-full justify-start gap-3" data-testid="button-growth-tools">
                  <TrendingUp className="h-4 w-4" />
                  Growth Tools
                  <Badge variant="secondary" className="ml-auto">New Hires</Badge>
                </Button>
              </Link>
              <Link href="/reports">
                <Button variant="outline" className="w-full justify-start gap-3" data-testid="button-reports">
                  <BarChart3 className="h-4 w-4" />
                  Usage Reports
                  <Badge variant="secondary" className="ml-auto">Analytics</Badge>
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Platform Features
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Database className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-sm">Hybrid Extraction Engine</p>
                  <p className="text-xs text-muted-foreground">CORS proxy + Playwright fallback for maximum coverage</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-lg bg-purple-500/10 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="h-4 w-4 text-purple-500" />
                </div>
                <div>
                  <p className="font-medium text-sm">AI-Enhanced Data</p>
                  <p className="text-xs text-muted-foreground">Gemini AI fills gaps for low-confidence extractions</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-lg bg-green-500/10 flex items-center justify-center flex-shrink-0">
                  <Trophy className="h-4 w-4 text-green-500" />
                </div>
                <div>
                  <p className="font-medium text-sm">Full College Coverage</p>
                  <p className="text-xs text-muted-foreground">All 1,100+ Division I, II, and III institutions</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                  <Download className="h-4 w-4 text-blue-500" />
                </div>
                <div>
                  <p className="font-medium text-sm">CRM Export Ready</p>
                  <p className="text-xs text-muted-foreground">CSV/JSON exports for HubSpot, Salesforce, Clay</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
