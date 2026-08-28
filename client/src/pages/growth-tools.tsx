import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { createCSVBlob, downloadBlob } from '@/lib/csvExport';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Download, Rocket, Building, Users, Mail, Phone, ArrowLeft, Loader2, CheckCircle2, XCircle, Search, Calendar } from 'lucide-react';
import { Link } from 'wouter';
import { format } from 'date-fns';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

interface MatchResult {
  summary: {
    inputCount: number;
    matchedCount: number;
    contactsFound: number;
  };
  matches: Array<{
    input: string;
    match: string | null;
    id: string | null;
    score: number;
  }>;
  contacts: Array<{
    id: number;
    name: string;
    title: string | null;
    email: string;
    phone: string | null;
    department: string | null;
    schoolId: string;
    schoolName: string;
    conference: string | null;
    division: string | null;
  }>;
}

interface NewHire {
  id: number;
  name: string;
  title: string | null;
  email: string;
  phone: string | null;
  school: string;
  schoolId: string;
  conference: string | null;
  detectedAt: string;
}

export default function GrowthTools() {
  const [input, setInput] = useState('');
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [searchFilter, setSearchFilter] = useState('');

  const hiresQuery = useQuery<NewHire[]>({
    queryKey: ['/api/growth/new-hires'],
  });

  const matchMutation = useMutation({
    mutationFn: (names: string[]) => apiRequest('POST', '/api/growth/match-accounts', { accountNames: names }),
    onSuccess: (data: MatchResult) => setMatchResult(data)
  });

  const handleEnrich = () => {
    const names = input.split('\n').filter(n => n.trim().length > 0);
    if (names.length > 0) {
      matchMutation.mutate(names);
    }
  };

  const downloadCSV = () => {
    if (!matchResult?.contacts) return;
    const headers = ["Name", "Title", "Email", "School", "Phone", "Department", "Conference", "Division"];
    const rows = matchResult.contacts.map(c => [
      c.name,
      c.title,
      c.email,
      c.schoolName,
      c.phone,
      c.department,
      c.conference,
      c.division
    ]);
    const blob = createCSVBlob(headers, rows);
    downloadBlob(blob, `enriched_contacts_${new Date().toISOString().split('T')[0]}.csv`);
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  };

  const filteredHires = hiresQuery.data?.filter(hire => 
    !searchFilter || 
    hire.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
    hire.school.toLowerCase().includes(searchFilter.toLowerCase()) ||
    (hire.title?.toLowerCase().includes(searchFilter.toLowerCase()))
  ) || [];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon" data-testid="button-back">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">Growth Tools</h1>
              <p className="text-muted-foreground">Sales Intelligence & Account Enrichment</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* ABM LIST MATCHER */}
          <Card className="h-fit" data-testid="card-account-enrichment">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building className="h-5 w-5 text-primary" /> 
                Account Enrichment
              </CardTitle>
              <CardDescription>
                Paste target school names (one per line) to get all staff contacts
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea 
                rows={8} 
                placeholder="University of Alabama&#10;Ohio State&#10;Texas&#10;Notre Dame&#10;Michigan"
                value={input}
                onChange={e => setInput(e.target.value)}
                className="font-mono text-sm"
                data-testid="textarea-school-names"
              />
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>{input.split('\n').filter(n => n.trim()).length} schools entered</span>
              </div>
              <Button 
                className="w-full" 
                onClick={handleEnrich} 
                disabled={matchMutation.isPending || !input.trim()}
                data-testid="button-enrich"
              >
                {matchMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Matching...
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-4 w-4" />
                    Match & Enrich
                  </>
                )}
              </Button>

              {matchResult && (
                <div className="space-y-4">
                  <div className="rounded-lg bg-green-50 dark:bg-green-950/30 p-4 border border-green-200 dark:border-green-800">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-bold text-green-800 dark:text-green-300 flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4" />
                        Success!
                      </span>
                      <Badge variant="secondary">{matchResult.summary.contactsFound.toLocaleString()} Contacts Found</Badge>
                    </div>
                    <div className="text-sm text-green-700 dark:text-green-400 mb-4">
                      Matched {matchResult.summary.matchedCount} of {matchResult.summary.inputCount} schools
                    </div>
                    <Button 
                      variant="outline" 
                      className="w-full" 
                      onClick={downloadCSV}
                      data-testid="button-download-csv"
                    >
                      <Download className="mr-2 h-4 w-4" /> 
                      Download CSV
                    </Button>
                  </div>

                  {/* Match Details */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Match Details</p>
                    <div className="max-h-48 overflow-auto space-y-1 rounded-md border p-2">
                      {matchResult.matches.map((m, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm py-1 border-b last:border-0">
                          {m.match ? (
                            <CheckCircle2 className="h-3 w-3 text-green-600 flex-shrink-0" />
                          ) : (
                            <XCircle className="h-3 w-3 text-red-500 flex-shrink-0" />
                          )}
                          <span className="truncate">{m.input}</span>
                          {m.match && (
                            <>
                              <span className="text-muted-foreground">→</span>
                              <span className="font-medium text-primary truncate">{m.match}</span>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* NEW HIRES FEED */}
          <Card className="h-fit" data-testid="card-new-hires">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Rocket className="h-5 w-5 text-orange-600" /> 
                New Staff (Last 7 Days)
              </CardTitle>
              <CardDescription>
                Recently detected staff members from extracted schools
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <Input
                  placeholder="Filter by name, school, or title..."
                  value={searchFilter}
                  onChange={e => setSearchFilter(e.target.value)}
                  className="text-sm"
                  data-testid="input-filter-hires"
                />
              </div>
              
              {hiresQuery.isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredHires.length === 0 ? (
                <div className="text-center py-12">
                  <Users className="h-12 w-12 mx-auto text-muted-foreground/30" />
                  <p className="mt-4 text-muted-foreground text-sm">
                    {hiresQuery.data?.length === 0 
                      ? "No new staff detected this week. Run extractions to populate this feed."
                      : "No matches for your filter"}
                  </p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[500px] overflow-auto">
                  {filteredHires.map((hire) => (
                    <div 
                      key={hire.id} 
                      className="flex items-start gap-3 p-3 rounded-lg border bg-card hover-elevate"
                      data-testid={`card-hire-${hire.id}`}
                    >
                      <Avatar className="h-10 w-10 flex-shrink-0">
                        <AvatarFallback className="bg-orange-100 text-orange-700 text-xs font-bold">
                          {getInitials(hire.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{hire.name}</div>
                        {hire.title && (
                          <div className="text-xs text-muted-foreground truncate">{hire.title}</div>
                        )}
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <Badge variant="outline" className="text-xs">
                            {hire.school}
                          </Badge>
                          {hire.conference && (
                            <Badge variant="secondary" className="text-xs">
                              {hire.conference}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                          {hire.email && (
                            <a 
                              href={`mailto:${hire.email}`} 
                              className="flex items-center gap-1 hover:text-primary truncate"
                              data-testid={`link-email-${hire.id}`}
                            >
                              <Mail className="h-3 w-3" />
                              <span className="truncate">{hire.email}</span>
                            </a>
                          )}
                          {hire.phone && (
                            <a 
                              href={`tel:${hire.phone}`} 
                              className="flex items-center gap-1 hover:text-primary"
                              data-testid={`link-phone-${hire.id}`}
                            >
                              <Phone className="h-3 w-3" />
                              <span>{hire.phone}</span>
                            </a>
                          )}
                        </div>
                        <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          <span>Detected {format(new Date(hire.detectedAt), 'MMM d, yyyy')}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              {hiresQuery.data && hiresQuery.data.length > 0 && (
                <div className="mt-4 pt-4 border-t text-center">
                  <p className="text-sm text-muted-foreground">
                    Showing {filteredHires.length} of {hiresQuery.data.length} new staff members
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
