import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useWebSocket } from '@/hooks/use-websocket';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { useToast } from '@/hooks/use-toast';
import { emitPaymentFailure } from '@/components/payment-failure-dialog';
import { 
  Loader2, Search, Users, Building2, Mail, Phone, Download, 
  ExternalLink, RefreshCw, CheckCircle, XCircle, Clock, AlertCircle,
  GraduationCap, Briefcase, MapPin, Linkedin, ChevronRight, Database,
  Play, BarChart3, Trophy, List, Sparkles, Shield, Copy, PlusSquare, Twitter, Target, Rocket, Eye, EyeOff, Lock
} from 'lucide-react';

type MaskedStaff = StaffMember & { schoolName?: string; schoolLogo?: string; isRevealed?: boolean; emailRevealed?: boolean; phoneRevealed?: boolean };

function useRevealMutation() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (staffId: number) => {
      return await apiRequest('POST', `/api/staff/${staffId}/reveal`);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/staff/members'] });
      queryClient.invalidateQueries({ queryKey: ['/api/staff/schools'] });
      queryClient.invalidateQueries({ queryKey: ['/api/billing/account'] });
      queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
      const src = data?.source;
      const desc =
        src === 'cached' ? 'Re-reveal within 90 days — free.' :
        src === 'subscription' ? 'Included in your plan.' :
        src === 'payg_credits' ? '1 credit used.' :
        'Contact revealed.';
      toast({ title: 'Contact revealed', description: desc });
    },
    onError: (e: any) => {
      const msg = String(e?.message || '');
      const payload = e?.data ?? null;
      if (msg.includes('login_required') || msg.includes('Authentication required')) {
        toast({ variant: 'destructive', title: 'Sign in required', description: 'Sign in to reveal contacts.' });
        window.location.href = '/login';
        return;
      }
      if (payload?.code === 'payment_failed' || msg.includes('payment_failed')) {
        emitPaymentFailure({
          message: payload?.message || 'Your card was declined. Update your payment method to keep revealing contacts.',
          declineCode: payload?.declineCode ?? null,
          errorCode: payload?.errorCode ?? null,
        });
        return;
      }
      if (msg.includes('out_of_quota') || msg.includes('quota')) {
        toast({ variant: 'destructive', title: 'Out of reveals', description: 'Upgrade or buy credits to continue.' });
        window.location.href = '/pricing';
        return;
      }
      if (payload?.code === 'no_contact' || msg.includes('no_contact')) {
        toast({ title: 'No contact on file', description: 'The school’s directory doesn’t publish an email or phone for this person. No credit was used.' });
        return;
      }
      toast({ variant: 'destructive', title: 'Could not reveal', description: payload?.message || 'Please try again.' });
    },
  });
}

function RevealButton({ staffId, size = 'sm', variant = 'default', className = '', hasContact = true }: { staffId: number; size?: 'sm' | 'default' | 'icon'; variant?: 'default' | 'outline' | 'ghost'; className?: string; hasContact?: boolean }) {
  const mutation = useRevealMutation();
  // ~20% of records come from directories that publish no email or phone for
  // that person. Offering a Reveal button there is a dead end — show the
  // truth instead of an error after the click.
  if (!hasContact) {
    return (
      <span className={`inline-flex items-center text-xs text-muted-foreground ${className}`} data-testid={`text-no-contact-${staffId}`}>
        No contact listed
      </span>
    );
  }
  return (
    <Button
      size={size}
      variant={variant}
      onClick={(e) => { e.stopPropagation(); mutation.mutate(staffId); }}
      disabled={mutation.isPending}
      className={`gap-1 ${className}`}
      data-testid={`button-reveal-${staffId}`}
    >
      {mutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
      Reveal
    </Button>
  );
}
import type { SchoolDirectory, StaffMember, ExtractionJob } from '@shared/schema';
import { ncaaConferencesWithSchools, ncaaConferences } from '@shared/ncaa-conferences';

interface StaffStats {
  totalSchools: number;
  extractedSchools: number;
  totalStaff: number;
  avgConfidence: number;
}

interface StaffMembersResponse {
  members: (StaffMember & { schoolName?: string; schoolLogo?: string })[];
  total: number;
}

interface SchoolDirectoriesResponse {
  directories: SchoolDirectory[];
  total: number;
}

interface JobsResponse {
  jobs: ExtractionJob[];
}

interface ConferenceInfo {
  id: string;
  name: string;
  shortName: string;
}

const divisions = ['Division I', 'Division II', 'Division III'];

function StatusBadge({ status }: { status: string }) {
  const statusConfig: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: any; label: string }> = {
    success: { variant: 'default', icon: CheckCircle, label: 'Extracted' },
    completed: { variant: 'default', icon: CheckCircle, label: 'Completed' },
    pending: { variant: 'secondary', icon: Clock, label: 'Pending' },
    processing: { variant: 'outline', icon: Loader2, label: 'Processing' },
    failed: { variant: 'destructive', icon: XCircle, label: 'Failed' },
    no_directory: { variant: 'outline', icon: AlertCircle, label: 'No Directory' },
  };
  
  const config = statusConfig[status] || statusConfig.pending;
  const Icon = config.icon;
  
  return (
    <Badge variant={config.variant} className="gap-1">
      <Icon className={`h-3 w-3 ${status === 'processing' ? 'animate-spin' : ''}`} />
      {config.label}
    </Badge>
  );
}

function NetworkBadge({ staffId, connectedAt, connectionName }: { staffId: number; connectedAt?: string | null; connectionName?: string | null }) {
  const tipParts: string[] = [];
  if (connectionName) tipParts.push(`Connected to ${connectionName}`);
  if (connectedAt) tipParts.push(`since ${new Date(connectedAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`);
  const tip = tipParts.join(' ') || 'In your LinkedIn network';
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="secondary" className="text-xs gap-1 cursor-help" data-testid={`badge-in-network-${staffId}`}>
            <Linkedin className="h-3 w-3" />
            In your network
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top">{tip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function StaffCard({ member, onClick, inNetwork, networkConnectedAt, networkConnectionName }: { member: MaskedStaff; onClick?: () => void; inNetwork?: boolean; networkConnectedAt?: string | null; networkConnectionName?: string | null }) {
  const initials = member.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const confidence = member.confidence as { overall: number } | null;
  
  return (
    <Card 
      className="hover-elevate cursor-pointer" 
      data-testid={`card-staff-${member.id}`}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <Avatar className="h-12 w-12 flex-shrink-0">
            {member.imageUrl && <AvatarImage src={member.imageUrl} alt={member.name} />}
            <AvatarFallback className="bg-primary/10 text-primary">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-foreground truncate" data-testid="text-staff-name">{member.name}</h3>
              {inNetwork && (
                <NetworkBadge staffId={member.id} connectedAt={networkConnectedAt} connectionName={networkConnectionName} />
              )}
              {confidence && confidence.overall >= 80 && (
                <Badge variant="secondary" className="text-xs">High Confidence</Badge>
              )}
            </div>
            {member.title && (
              <p className="text-sm text-muted-foreground truncate" data-testid="text-staff-title">{member.title}</p>
            )}
            {member.schoolName && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                <GraduationCap className="h-3 w-3" />
                {member.schoolName}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <span
                className={`inline-flex items-center gap-1 text-xs ${member.isRevealed ? 'text-primary' : 'text-muted-foreground'}`}
                data-testid="link-staff-email"
              >
                {member.isRevealed ? <Mail className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                {member.email}
              </span>
              {member.phone && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  {member.isRevealed ? <Phone className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                  {member.phone}
                </span>
              )}
              {!member.isRevealed && (
                <RevealButton staffId={member.id} size="sm" variant="outline" className="ml-auto h-6 px-2 text-xs" hasContact={member.email != null || member.phone != null} />
              )}
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-1" />
        </div>
      </CardContent>
    </Card>
  );
}

function ExpandedContactDialog({ 
  member, 
  open, 
  onOpenChange,
  inNetwork,
  networkConnectedAt,
  networkConnectionName,
}: { 
  member: MaskedStaff | null; 
  open: boolean; 
  onOpenChange: (open: boolean) => void;
  inNetwork?: boolean;
  networkConnectedAt?: string | null;
  networkConnectionName?: string | null;
}) {
  const { toast } = useToast();
  
  if (!member) return null;
  
  const initials = member.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const confidence = member.confidence as { overall: number } | null;
  
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied!', description: `${label} copied to clipboard` });
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="dialog-expanded-contact">
        <DialogHeader className="pb-4">
          <div className="flex items-start gap-4">
            <Avatar className="h-20 w-20 flex-shrink-0">
              {member.imageUrl && <AvatarImage src={member.imageUrl} alt={member.name} />}
              <AvatarFallback className="bg-primary/10 text-primary text-2xl">{initials}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-xl" data-testid="text-expanded-name">{member.name}</DialogTitle>
              {member.title && (
                <DialogDescription className="text-base mt-1" data-testid="text-expanded-title">
                  {member.title}
                </DialogDescription>
              )}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {member.schoolName && (
                  <Badge variant="outline" className="gap-1">
                    <GraduationCap className="h-3 w-3" />
                    {member.schoolName}
                  </Badge>
                )}
                {inNetwork && (
                  <NetworkBadge
                    staffId={member.id}
                    connectedAt={networkConnectedAt}
                    connectionName={networkConnectionName}
                  />
                )}
                {confidence && confidence.overall >= 80 && (
                  <Badge variant="secondary">High Confidence</Badge>
                )}
              </div>
            </div>
          </div>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="grid gap-3">
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-3">
                {member.isRevealed ? <Mail className="h-5 w-5 text-primary" /> : <Lock className="h-5 w-5 text-muted-foreground" />}
                <div>
                  <p className="text-xs text-muted-foreground">Email</p>
                  {member.isRevealed ? (
                    <a
                      href={`mailto:${member.email}`}
                      className="text-sm font-medium text-primary hover:underline"
                      data-testid="link-expanded-email"
                    >
                      {member.email}
                    </a>
                  ) : (
                    <span className="text-sm font-medium text-muted-foreground" data-testid="link-expanded-email">{member.email}</span>
                  )}
                </div>
              </div>
              {member.isRevealed ? (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => copyToClipboard(member.email!, 'Email')}
                  data-testid="button-copy-email"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              ) : (
                <RevealButton staffId={member.id} variant="default" hasContact={member.email != null || member.phone != null} />
              )}
            </div>
            
            {member.phone && (
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-3">
                  {member.isRevealed ? <Phone className="h-5 w-5 text-muted-foreground" /> : <Lock className="h-5 w-5 text-muted-foreground" />}
                  <div>
                    <p className="text-xs text-muted-foreground">Phone</p>
                    {member.isRevealed ? (
                      <a
                        href={`tel:${member.phone}`}
                        className="text-sm font-medium hover:underline"
                        data-testid="link-expanded-phone"
                      >
                        {member.phone}
                      </a>
                    ) : (
                      <span className="text-sm font-medium text-muted-foreground" data-testid="link-expanded-phone">{member.phone}</span>
                    )}
                  </div>
                </div>
                {member.isRevealed && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => copyToClipboard(member.phone!, 'Phone')}
                    data-testid="button-copy-phone"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                )}
              </div>
            )}
            
            {member.department && (
              <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                <Briefcase className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Department</p>
                  <p className="text-sm font-medium" data-testid="text-expanded-department">{member.department}</p>
                </div>
              </div>
            )}
            
            {member.office && (
              <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                <MapPin className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Office</p>
                  <p className="text-sm font-medium" data-testid="text-expanded-office">{member.office}</p>
                </div>
              </div>
            )}
          </div>
          
          {(member.linkedinUrl || member.twitterHandle || member.bioUrl) && (
            <>
              <Separator />
              <div className="flex flex-wrap gap-2">
                {member.linkedinUrl && (
                  <a 
                    href={member.linkedinUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    data-testid="link-expanded-linkedin"
                  >
                    <Button variant="outline" className="gap-2">
                      <Linkedin className="h-4 w-4 text-blue-600" />
                      LinkedIn
                    </Button>
                  </a>
                )}
                {member.twitterHandle && (
                  <a 
                    href={`https://twitter.com/${member.twitterHandle}`} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    data-testid="link-expanded-twitter"
                  >
                    <Button variant="outline" className="gap-2">
                      <Twitter className="h-4 w-4 text-sky-500" />
                      @{member.twitterHandle}
                    </Button>
                  </a>
                )}
                {member.bioUrl && (
                  <a 
                    href={member.bioUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    data-testid="link-expanded-bio"
                  >
                    <Button variant="outline" className="gap-2">
                      <ExternalLink className="h-4 w-4" />
                      View Bio
                    </Button>
                  </a>
                )}
              </div>
            </>
          )}
        </div>
        
        <DialogFooter className="mt-4 gap-2">
          {member.isRevealed ? (
            <>
              <Button 
                variant="outline" 
                onClick={() => {
                  const text = `${member.name} <${member.email}>`;
                  copyToClipboard(text, 'Contact');
                }}
                className="gap-2"
                data-testid="button-copy-contact"
              >
                <Copy className="h-4 w-4" />
                Copy for Email
              </Button>
              <a href={`mailto:${member.email}`}>
                <Button className="gap-2" data-testid="button-send-email">
                  <Mail className="h-4 w-4" />
                  Send Email
                </Button>
              </a>
            </>
          ) : (
            <RevealButton staffId={member.id} variant="default" hasContact={member.email != null || member.phone != null} />
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JobProgressCard({ job }: { job: ExtractionJob }) {
  const progress = job.totalSchools && job.totalSchools > 0 
    ? Math.round((job.processedSchools || 0) / job.totalSchools * 100) 
    : 0;
  
  return (
    <Card className="mb-3">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <StatusBadge status={job.status} />
            <span className="text-sm font-medium capitalize">{job.type} Job</span>
          </div>
          <span className="text-xs text-muted-foreground">
            #{job.id}
          </span>
        </div>
        <Progress value={progress} className="h-2 mb-2" />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{job.processedSchools || 0} / {job.totalSchools || 0} schools</span>
          <span>{job.contactsFound || 0} contacts found</span>
        </div>
      </CardContent>
    </Card>
  );
}

function AppSidebar({ 
  selectedView, 
  onViewChange,
  selectedConference,
  onConferenceChange,
  stats,
}: {
  selectedView: string;
  onViewChange: (view: string) => void;
  selectedConference: string | null;
  onConferenceChange: (id: string | null) => void;
  stats?: StaffStats;
}) {
  const jobsQuery = useQuery<JobsResponse>({
    queryKey: ['/api/jobs'],
    refetchInterval: 5000, // Poll every 5 seconds for job updates
  });

  const activeJobs = jobsQuery.data?.jobs?.filter(j => j.status === 'processing' || j.status === 'pending') || [];
  const recentJobs = jobsQuery.data?.jobs?.slice(0, 5) || [];
  
  return (
    <Sidebar className="border-r">
      <SidebarHeader className="p-4 border-b">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
            <Users className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h2 className="font-semibold text-sm">Athletics CRM</h2>
            <p className="text-xs text-muted-foreground">Staff Directory</p>
          </div>
        </div>
      </SidebarHeader>
      
      <SidebarContent>
        {/* Quick Stats */}
        <SidebarGroup>
          <SidebarGroupLabel>Quick Stats</SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="grid grid-cols-2 gap-2 px-2">
              <div className="rounded-md bg-muted p-2 text-center">
                <div className="text-lg font-bold text-primary">{stats?.totalStaff?.toLocaleString() || 0}</div>
                <div className="text-xs text-muted-foreground">Contacts</div>
              </div>
              <div className="rounded-md bg-muted p-2 text-center">
                <div className="text-lg font-bold text-green-600">{stats?.extractedSchools || 0}</div>
                <div className="text-xs text-muted-foreground">Schools</div>
              </div>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
        
        {/* Navigation */}
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <Link href="/staff">
                  <SidebarMenuButton 
                    isActive={selectedView === 'search'}
                    data-testid="nav-search"
                  >
                    <Search className="h-4 w-4" />
                    <span>Search Staff</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <Link href="/schools">
                  <SidebarMenuButton 
                    isActive={selectedView === 'schools'}
                    data-testid="nav-schools"
                  >
                    <Building2 className="h-4 w-4" />
                    <span>Browse Schools</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <Link href="/jobs">
                  <SidebarMenuButton 
                    isActive={selectedView === 'jobs'}
                    data-testid="nav-jobs"
                  >
                    <List className="h-4 w-4" />
                    <span>Job Queue</span>
                    {activeJobs.length > 0 && (
                      <Badge variant="secondary" className="ml-auto">{activeJobs.length}</Badge>
                    )}
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <Link href="/reports">
                  <SidebarMenuButton data-testid="nav-reports">
                    <BarChart3 className="h-4 w-4" />
                    <span>Reports</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <Link href="/list-matcher">
                  <SidebarMenuButton data-testid="nav-list-matcher">
                    <Target className="h-4 w-4" />
                    <span>List Matcher</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <Link href="/growth">
                  <SidebarMenuButton data-testid="nav-growth-tools">
                    <Rocket className="h-4 w-4" />
                    <span>Growth Tools</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        
        {/* Active Jobs */}
        {activeJobs.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Active Jobs</SidebarGroupLabel>
            <SidebarGroupContent className="px-2">
              {activeJobs.map(job => (
                <JobProgressCard key={job.id} job={job} />
              ))}
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        
        {/* Conferences */}
        <SidebarGroup>
          <SidebarGroupLabel>Conferences</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton 
                  onClick={() => onConferenceChange(null)}
                  isActive={selectedConference === null}
                >
                  <Trophy className="h-4 w-4" />
                  <span>All Conferences</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {ncaaConferences.map((conf) => (
                <SidebarMenuItem key={conf.id}>
                  <SidebarMenuButton 
                    onClick={() => onConferenceChange(conf.id)}
                    isActive={selectedConference === conf.id}
                    data-testid={`nav-conference-${conf.id}`}
                  >
                    <GraduationCap className="h-4 w-4" />
                    <span className="truncate">{conf.shortName}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

export default function StaffDirectory() {
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  
  // Sync view with URL - /schools shows schools, /staff shows search
  const getViewFromLocation = () => {
    if (location === '/schools') return 'schools';
    if (location === '/jobs') return 'jobs';
    return 'search';
  };
  
  const [selectedView, setSelectedView] = useState<string>(getViewFromLocation());
  const [selectedConference, setSelectedConference] = useState<string | null>(null);
  
  // Update view when URL changes
  useEffect(() => {
    setSelectedView(getViewFromLocation());
  }, [location]);
  const [searchQuery, setSearchQuery] = useState('');
  const [divisionFilter, setDivisionFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(0);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string | null>(null);
  const [extractingSchoolId, setExtractingSchoolId] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const [addToListDialogOpen, setAddToListDialogOpen] = useState(false);
  const [selectedStaffIdForList, setSelectedStaffIdForList] = useState<number | null>(null);
  const [newListName, setNewListName] = useState('');
  const [expandedContact, setExpandedContact] = useState<(StaffMember & { schoolName?: string; schoolLogo?: string }) | null>(null);
  
  // Read ?school= URL parameter on mount and auto-select school
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const schoolParam = urlParams.get('school');
    if (schoolParam && !selectedSchoolId) {
      setSelectedSchoolId(schoolParam);
      setSelectedView('schools');
    }
  }, []);
  
  // Update URL when school is selected/deselected - preserves current path
  const handleSchoolSelect = useCallback((schoolId: string | null) => {
    setSelectedSchoolId(schoolId);
    // Use window.location.pathname to get fresh path (avoids stale closure)
    const basePath = window.location.pathname || '/schools';
    if (schoolId) {
      setLocation(`${basePath}?school=${schoolId}`, { replace: true });
    } else {
      setLocation(basePath, { replace: true });
    }
  }, [setLocation]);
  
  const handleJobProgress = useCallback((update: any) => {
    if (update.data?.status === 'processing') {
      queryClient.invalidateQueries({ queryKey: ['/api/jobs'] });
      queryClient.invalidateQueries({ queryKey: ['/api/staff/schools'] });
    }
  }, []);
  
  const handleJobCompleted = useCallback((update: any) => {
    toast({ 
      title: 'Extraction Complete', 
      description: `Job #${update.jobId} finished: ${update.data?.contactsFound || 0} contacts found` 
    });
    queryClient.invalidateQueries({ queryKey: ['/api/jobs'] });
    queryClient.invalidateQueries({ queryKey: ['/api/staff'] });
    // Refresh school staff in modal
    if (selectedSchoolId) {
      queryClient.invalidateQueries({ queryKey: ['/api/staff/members', 'school', selectedSchoolId] });
    }
    setExtractingSchoolId(null);
    if (update.jobId === activeJobId) {
      setActiveJobId(null);
    }
  }, [activeJobId, toast, selectedSchoolId]);
  
  const { isConnected: wsConnected } = useWebSocket({
    onJobProgress: handleJobProgress,
    onJobCompleted: handleJobCompleted,
    autoSubscribeAll: true,
  });
  
  const pageSize = 20;
  
  // Fetch stats
  const statsQuery = useQuery<StaffStats>({
    queryKey: ['/api/staff/stats'],
    refetchInterval: 30000,
  });
  
  // Fetch saved lists
  const listsQuery = useQuery<any[]>({
    queryKey: ['/api/lists'],
  });
  
  // Create list mutation
  const createListMutation = useMutation({
    mutationFn: (data: { name: string; description?: string }) => 
      apiRequest('POST', '/api/lists', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/lists'] });
      setNewListName('');
      toast({ title: 'List Created', description: 'Your new list has been created.' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to create list', variant: 'destructive' });
    },
  });
  
  // Add to list mutation
  const addToListMutation = useMutation({
    mutationFn: (data: { listId: number; staffId: number }) => 
      apiRequest('POST', `/api/lists/${data.listId}/add`, { staffId: data.staffId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/lists'] });
      setAddToListDialogOpen(false);
      setSelectedStaffIdForList(null);
      toast({ title: 'Added to List', description: 'Contact has been added to your list.' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to add to list', variant: 'destructive' });
    },
  });
  
  // Fetch staff members with full-text search
  const buildStaffQueryUrl = () => {
    const params = new URLSearchParams();
    if (searchQuery) params.set('search', searchQuery);
    if (divisionFilter && divisionFilter !== 'all') params.set('division', divisionFilter);
    if (selectedConference) params.set('conference', selectedConference);
    params.set('limit', pageSize.toString());
    params.set('offset', (currentPage * pageSize).toString());
    return `/api/staff/members?${params.toString()}`;
  };
  const staffQueryUrl = buildStaffQueryUrl();
  const networkStaffIdsQuery = useQuery<{
    staffIds: number[];
    connectedAt?: Record<string, string | null>;
    connectionName?: Record<string, string | null>;
  }>({
    queryKey: ['/api/linkedin/network-staff-ids'],
  });
  const networkStaffIdSet = new Set(networkStaffIdsQuery.data?.staffIds || []);
  const networkConnectedAt = networkStaffIdsQuery.data?.connectedAt || {};
  const networkConnectionName = networkStaffIdsQuery.data?.connectionName || {};

  const staffQuery = useQuery<StaffMembersResponse>({
    queryKey: [staffQueryUrl],
    enabled: selectedView === 'search',
  });
  
  // Fetch school directories
  const buildSchoolsQueryUrl = () => {
    const params = new URLSearchParams();
    if (divisionFilter && divisionFilter !== 'all') params.set('division', divisionFilter);
    if (selectedConference) params.set('conference', selectedConference);
    params.set('limit', pageSize.toString());
    params.set('offset', (currentPage * pageSize).toString());
    return `/api/staff/schools?${params.toString()}`;
  };
  const schoolsQueryUrl = buildSchoolsQueryUrl();
  const schoolsQuery = useQuery<SchoolDirectoriesResponse>({
    queryKey: [schoolsQueryUrl],
    enabled: selectedView === 'schools',
  });
  
  // Fetch jobs
  const jobsQuery = useQuery<JobsResponse>({
    queryKey: ['/api/jobs'],
    refetchInterval: selectedView === 'jobs' ? 3000 : 10000,
  });
  
  // Fetch staff for selected school (modal view)
  const schoolStaffQuery = useQuery<StaffMembersResponse>({
    queryKey: ['/api/staff/members', 'school', selectedSchoolId],
    queryFn: async () => {
      const res = await fetch(`/api/staff/members?schoolId=${selectedSchoolId}&limit=500`);
      if (!res.ok) throw new Error('Failed to fetch school staff');
      return res.json();
    },
    enabled: !!selectedSchoolId,
  });
  
  // Fetch single school data when accessed via URL or modal (uses the school+members endpoint)
  const singleSchoolQuery = useQuery<{ school: SchoolDirectory; members: any[]; count: number }>({
    queryKey: ['/api/staff/schools', selectedSchoolId, 'members'],
    queryFn: async () => {
      const res = await fetch(`/api/staff/schools/${selectedSchoolId}/members`);
      if (!res.ok) throw new Error('School not found');
      return res.json();
    },
    enabled: !!selectedSchoolId,
  });
  
  // Get the selected school data from either the single query or schools list
  const selectedSchoolData = singleSchoolQuery.data?.school || schoolsQuery.data?.directories?.find(
    (s) => s.schoolId === selectedSchoolId
  );
  
  // Initialize schools mutation
  const initSchoolsMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/staff/init-schools'),
    onSuccess: () => {
      toast({ title: 'Success', description: 'School directories initialized' });
      queryClient.invalidateQueries({ queryKey: ['/api/staff'] });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });
  
  // Seed database mutation (Power 4 + Pac-12)
  const seedMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/admin/seed'),
    onSuccess: (data: any) => {
      toast({ title: 'Database Seeded!', description: `Added ${data.schools} Power 5 schools` });
      queryClient.invalidateQueries({ queryKey: ['/api/staff/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/staff/schools'] });
      queryClient.invalidateQueries({ queryKey: ['/api/staff/members'] });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });
  
  // Extract single school mutation (async mode by default)
  const extractMutation = useMutation({
    mutationFn: (schoolId: string) => apiRequest('POST', `/api/staff/extract/${schoolId}`, { async: true }),
    onSuccess: (data: any) => {
      if (data.locked) {
        toast({ 
          title: 'Extraction In Progress', 
          description: 'This school is already being extracted by another process',
          variant: 'destructive' 
        });
        setExtractingSchoolId(null);
        return;
      }
      
      if (data.async && data.jobId) {
        toast({ 
          title: 'Extraction Started', 
          description: `Job #${data.jobId} queued. View progress in Jobs tab.` 
        });
        setActiveJobId(data.jobId);
        queryClient.invalidateQueries({ queryKey: ['/api/jobs'] });
      } else if (data.success) {
        toast({ title: 'Extraction Complete', description: `Extracted ${data.contacts} contacts` });
        setExtractingSchoolId(null);
      } else {
        toast({ title: 'Extraction Issue', description: data.message, variant: 'destructive' });
        setExtractingSchoolId(null);
      }
      queryClient.invalidateQueries({ queryKey: ['/api/staff'] });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      setExtractingSchoolId(null);
    },
  });
  
  // Create job mutation (for conference extraction)
  const createJobMutation = useMutation({
    mutationFn: (params: { type: string; targetId: string }) => 
      apiRequest('POST', '/api/jobs', params),
    onSuccess: (data: any) => {
      toast({ title: 'Job Created', description: data.message });
      queryClient.invalidateQueries({ queryKey: ['/api/jobs'] });
      setSelectedView('jobs');
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });
  
  const handleExtract = (schoolId: string) => {
    setExtractingSchoolId(schoolId);
    extractMutation.mutate(schoolId);
  };
  
  const handleExtractConference = () => {
    if (!selectedConference) {
      toast({ title: 'Select a Conference', description: 'Please select a conference from the sidebar first', variant: 'destructive' });
      return;
    }
    createJobMutation.mutate({ type: 'conference', targetId: selectedConference });
  };
  
  const handleExportCSV = () => {
    const members = staffQuery.data?.members || [];
    if (members.length === 0) {
      toast({ title: 'No Data', description: 'No staff members to export', variant: 'destructive' });
      return;
    }
    
    const headers = ['Name', 'Title', 'Email', 'Phone', 'Department', 'Office', 'School', 'LinkedIn'];
    const rows = members.map(m => [
      m.name,
      m.title || '',
      m.email,
      m.phone || '',
      m.department || '',
      m.office || '',
      m.schoolName || m.schoolId,
      m.linkedinUrl || '',
    ]);
    
    const csvContent = '\uFEFF' + [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `athletics-staff-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast({ title: 'Download Started', description: `Exporting ${members.length} contacts` });
    
    apiRequest('POST', '/api/reports/log-export', {
      format: 'csv',
      count: members.length,
    }).catch(() => {});
  };

  // Export individual school staff to CSV
  const handleExportSchoolCSV = () => {
    const members = schoolStaffQuery.data?.members || [];
    if (members.length === 0) {
      toast({ title: 'No Data', description: 'No staff members to export for this school', variant: 'destructive' });
      return;
    }
    
    const schoolName = selectedSchoolData?.schoolName || 'school';
    const safeSchoolName = schoolName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    
    const headers = ['Name', 'Title', 'Email', 'Phone', 'Department', 'Office', 'LinkedIn'];
    const rows = members.map(m => [
      m.name,
      m.title || '',
      m.email,
      m.phone || '',
      m.department || '',
      m.office || '',
      m.linkedinUrl || '',
    ]);
    
    const csvContent = '\uFEFF' + [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeSchoolName}-staff-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast({ title: 'Download Started', description: `Exporting ${members.length} contacts from ${schoolName}` });
    
    apiRequest('POST', '/api/reports/log-export', {
      schoolId: selectedSchoolData?.schoolId,
      schoolName,
      format: 'csv',
      count: members.length,
    }).catch(() => {});
  };
  
  // Handle Add to List - opens dialog
  const handleAddToList = (staffId: number) => {
    setSelectedStaffIdForList(staffId);
    setAddToListDialogOpen(true);
  };
  
  // CRM Export with First/Last Name split
  const handleCRMExport = () => {
    const members = schoolStaffQuery.data?.members || [];
    if (members.length === 0) {
      toast({ title: 'No Data', description: 'No staff members to export', variant: 'destructive' });
      return;
    }
    
    const schoolName = selectedSchoolData?.schoolName || 'school';
    const safeSchoolName = schoolName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    
    const rows = members.map((m: any) => {
      const nameParts = m.name.split(' ');
      const lastName = nameParts.pop() || '';
      const firstName = nameParts.join(' ');
      
      return [
        firstName,
        lastName,
        m.email,
        m.title || '',
        m.phone || '',
        schoolName,
        m.linkedinUrl || '',
        'NCSA Directory'
      ].map(f => `"${(f || '').replace(/"/g, '""')}"`).join(',');
    });
    
    const csv = '\uFEFF' + [
      'First Name,Last Name,Email,Job Title,Mobile Phone,Company,LinkedIn URL,Lead Source',
      ...rows
    ].join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeSchoolName}-crm-import-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast({ title: 'CRM Export Ready', description: `${members.length} contacts formatted for CRM import` });
    
    apiRequest('POST', '/api/reports/log-export', {
      schoolId: selectedSchoolData?.schoolId,
      schoolName,
      format: 'crm-csv',
      count: members.length,
    }).catch(() => {});
  };
  
  const stats = statsQuery.data;
  
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between gap-4 p-4 border-b bg-card">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-lg font-semibold" data-testid="heading-staff-directory">
              {selectedView === 'search' ? 'Search Staff' : 
               selectedView === 'schools' ? 'Browse Schools' : 
               'Job Queue'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {selectedConference 
                ? `${ncaaConferences.find(c => c.id === selectedConference)?.name || selectedConference}`
                : 'All conferences'}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Select value={selectedConference || 'all'} onValueChange={(v) => { setSelectedConference(v === 'all' ? null : v); setCurrentPage(0); }}>
            <SelectTrigger className="w-40" data-testid="select-conference">
              <SelectValue placeholder="Conference" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Conferences</SelectItem>
              {ncaaConferences.map((conf) => (
                <SelectItem key={conf.id} value={conf.id}>{conf.shortName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedView === 'search' && (
            <Button 
              variant="outline" 
              onClick={handleExportCSV}
              disabled={!staffQuery.data?.members?.length}
              data-testid="button-export-csv"
            >
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          )}
          {selectedView === 'schools' && selectedConference && (
            <Button 
              onClick={handleExtractConference}
                  disabled={createJobMutation.isPending}
                  data-testid="button-extract-conference"
                >
                  {createJobMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  Extract Conference
                </Button>
              )}
              {stats?.totalSchools === 0 && (
                <Button 
                  onClick={() => initSchoolsMutation.mutate()} 
                  disabled={initSchoolsMutation.isPending}
                  data-testid="button-init-schools"
                >
                  {initSchoolsMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Database className="h-4 w-4 mr-2" />
                  )}
                  Initialize Schools
                </Button>
              )}
            </div>
          </header>
          
          {/* Main Content */}
          <main className="flex-1 overflow-auto p-6">
            {selectedView === 'search' && (
              <div className="space-y-6">
                {/* Search Bar */}
                <div className="flex gap-4 flex-wrap">
                  <div className="relative flex-1 min-w-[300px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by name, title, email, or department... (uses full-text search)"
                      value={searchQuery}
                      onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(0); }}
                      className="pl-10"
                      data-testid="input-search-staff"
                    />
                  </div>
                  <Select value={divisionFilter} onValueChange={(v) => { setDivisionFilter(v); setCurrentPage(0); }}>
                    <SelectTrigger className="w-40" data-testid="select-division">
                      <SelectValue placeholder="Division" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Divisions</SelectItem>
                      {divisions.map(d => (
                        <SelectItem key={d} value={d}>{d}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                {/* Results */}
                {staffQuery.isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : staffQuery.data?.members?.length === 0 ? (
                  <Card>
                    <CardContent className="py-12 text-center">
                      <Users className="h-12 w-12 mx-auto text-muted-foreground/50" />
                      <h3 className="mt-4 font-semibold">No Staff Found</h3>
                      <p className="text-muted-foreground mt-2">
                        {stats?.totalStaff === 0 
                          ? "Start by extracting staff from schools in the sidebar"
                          : "Try adjusting your search or filters"}
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Showing {staffQuery.data?.members?.length || 0} of {staffQuery.data?.total || 0} results
                    </p>
                    <div className="grid gap-4 md:grid-cols-2">
                      {staffQuery.data?.members?.map(member => (
                        <StaffCard 
                          key={member.id} 
                          member={member} 
                          inNetwork={networkStaffIdSet.has(member.id)}
                          networkConnectedAt={networkConnectedAt[String(member.id)]}
                          networkConnectionName={networkConnectionName[String(member.id)]}
                          onClick={() => setExpandedContact(member)}
                        />
                      ))}
                    </div>
                    
                    {staffQuery.data && staffQuery.data.total > pageSize && (
                      <div className="flex items-center justify-center gap-2 mt-6">
                        <Button 
                          variant="outline" 
                          disabled={currentPage === 0}
                          onClick={() => setCurrentPage(p => p - 1)}
                        >
                          Previous
                        </Button>
                        <span className="text-sm text-muted-foreground">
                          Page {currentPage + 1} of {Math.ceil(staffQuery.data.total / pageSize)}
                        </span>
                        <Button 
                          variant="outline"
                          disabled={(currentPage + 1) * pageSize >= staffQuery.data.total}
                          onClick={() => setCurrentPage(p => p + 1)}
                        >
                          Next
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            
            {selectedView === 'schools' && (
              <div className="space-y-6">
                <div className="flex gap-4 flex-wrap">
                  <Select value={divisionFilter} onValueChange={(v) => { setDivisionFilter(v); setCurrentPage(0); }}>
                    <SelectTrigger className="w-40" data-testid="select-division-schools">
                      <SelectValue placeholder="Division" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Divisions</SelectItem>
                      {divisions.map(d => (
                        <SelectItem key={d} value={d}>{d}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                {schoolsQuery.isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : schoolsQuery.data?.directories?.length === 0 ? (
                  <Card>
                    <CardContent className="py-12 text-center">
                      <Building2 className="h-12 w-12 mx-auto text-muted-foreground/50" />
                      <h3 className="mt-4 font-semibold">No Schools Found</h3>
                      <p className="text-muted-foreground mt-2">
                        Click "Initialize Schools" to load college school data
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Showing {schoolsQuery.data?.directories?.length || 0} of {schoolsQuery.data?.total || 0} schools
                    </p>
                    <div className="grid gap-3">
                      {schoolsQuery.data?.directories?.map(school => (
                        <Card 
                          key={school.id} 
                          className="hover-elevate cursor-pointer" 
                          data-testid={`card-school-${school.schoolId}`}
                          onClick={() => handleSchoolSelect(school.schoolId)}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-center gap-4">
                              <Avatar className="h-10 w-10 flex-shrink-0">
                                {school.logoUrl && <AvatarImage src={school.logoUrl} alt={school.schoolName} />}
                                <AvatarFallback className="bg-primary/10 text-primary text-xs">
                                  {school.schoolName.slice(0, 2).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h3 className="font-medium truncate">{school.schoolName}</h3>
                                  <StatusBadge status={school.status} />
                                </div>
                                <p className="text-sm text-muted-foreground truncate">{school.schoolFullName}</p>
                                {school.division && (
                                  <p className="text-xs text-muted-foreground">{school.division}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                {school.contactsCount && school.contactsCount > 0 && (
                                  <Badge variant="outline">
                                    <Users className="h-3 w-3 mr-1" />
                                    {school.contactsCount}
                                  </Badge>
                                )}
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                    
                    {schoolsQuery.data && schoolsQuery.data.total > pageSize && (
                      <div className="flex items-center justify-center gap-2 mt-6">
                        <Button 
                          variant="outline" 
                          disabled={currentPage === 0}
                          onClick={() => setCurrentPage(p => p - 1)}
                        >
                          Previous
                        </Button>
                        <span className="text-sm text-muted-foreground">
                          Page {currentPage + 1} of {Math.ceil(schoolsQuery.data.total / pageSize)}
                        </span>
                        <Button 
                          variant="outline"
                          disabled={(currentPage + 1) * pageSize >= schoolsQuery.data.total}
                          onClick={() => setCurrentPage(p => p + 1)}
                        >
                          Next
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            
            {selectedView === 'jobs' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Extraction Jobs</h2>
                  <Button
                    variant="outline"
                    onClick={() => queryClient.invalidateQueries({ queryKey: ['/api/jobs'] })}
                    data-testid="button-refresh-jobs"
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refresh
                  </Button>
                </div>
                
                {jobsQuery.isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : jobsQuery.data?.jobs?.length === 0 ? (
                  <Card>
                    <CardContent className="py-12 text-center">
                      <List className="h-12 w-12 mx-auto text-muted-foreground/50" />
                      <h3 className="mt-4 font-semibold">No Jobs Yet</h3>
                      <p className="text-muted-foreground mt-2">
                        Start a conference extraction from the sidebar
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-4">
                    {jobsQuery.data?.jobs?.map(job => (
                      <Card key={job.id} data-testid={`card-job-${job.id}`}>
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-base flex items-center gap-2">
                              Job #{job.id}
                              <StatusBadge status={job.status} />
                            </CardTitle>
                            <span className="text-xs text-muted-foreground">
                              {new Date(job.createdAt).toLocaleString()}
                            </span>
                          </div>
                          <CardDescription className="capitalize">
                            {job.type} extraction{job.targetId && ` - ${job.targetId}`}
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-3">
                            <Progress 
                              value={job.totalSchools && job.totalSchools > 0 
                                ? Math.round((job.processedSchools || 0) / job.totalSchools * 100) 
                                : 0} 
                              className="h-2" 
                            />
                            <div className="flex justify-between text-sm text-muted-foreground">
                              <span>{job.processedSchools || 0} / {job.totalSchools || 0} schools processed</span>
                              <span>{job.contactsFound || 0} contacts extracted</span>
                            </div>
                            
                            {job.logs && (job.logs as string[]).length > 0 && (
                              <div className="mt-4">
                                <h4 className="text-sm font-medium mb-2">Recent Logs</h4>
                                <ScrollArea className="h-32 rounded-md border p-2">
                                  <div className="text-xs font-mono space-y-1">
                                    {(job.logs as string[]).slice(-10).map((log, i) => (
                                      <div key={i} className="text-muted-foreground">{log}</div>
                                    ))}
                                  </div>
                                </ScrollArea>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}
          </main>
      
      {/* Floating Initialize Button - Only appears if DB is empty */}
      {stats?.totalSchools === 0 && selectedConference === null && !searchQuery && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-1000">
          <Button 
            size="lg"
            className="shadow-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-8 py-6 rounded-full gap-2"
            onClick={() => seedMutation.mutate()}
            disabled={seedMutation.isPending}
            data-testid="button-seed-database"
          >
            {seedMutation.isPending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Database className="h-5 w-5" />
            )}
            {seedMutation.isPending ? 'Loading Schools...' : 'Load Power 5 Schools'}
          </Button>
        </div>
      )}

      {/* School Detail Modal */}
      <Dialog open={!!selectedSchoolId} onOpenChange={(open) => !open && handleSchoolSelect(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col" data-testid="dialog-school-detail">
          <DialogHeader className="pb-4 border-b">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16 border bg-white shadow-sm flex-shrink-0">
                  {selectedSchoolData?.logoUrl && (
                    <AvatarImage src={selectedSchoolData.logoUrl} className="object-contain p-2" />
                  )}
                  <AvatarFallback className="bg-primary/10 text-primary">
                    {selectedSchoolData?.schoolName?.slice(0, 2).toUpperCase() || 'SC'}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <DialogTitle className="text-xl truncate">{selectedSchoolData?.schoolName}</DialogTitle>
                  <DialogDescription className="mt-1 flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-foreground">{selectedSchoolData?.conference}</span>
                    <span>•</span>
                    <StatusBadge status={selectedSchoolData?.status || 'pending'} />
                    {selectedSchoolData?.directoryUrl && (
                      <>
                        <span>•</span>
                        <a 
                          href={selectedSchoolData.directoryUrl} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-primary hover:underline flex items-center gap-1"
                        >
                          Visit Directory <ExternalLink className="h-3 w-3" />
                        </a>
                      </>
                    )}
                  </DialogDescription>
                </div>
              </div>
              <Button 
                onClick={(e) => {
                  e.stopPropagation();
                  handleExtract(selectedSchoolId!);
                }}
                disabled={extractingSchoolId === selectedSchoolId}
                data-testid="button-extract-modal"
              >
                {extractingSchoolId === selectedSchoolId ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Extracting...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Run Extraction
                  </>
                )}
              </Button>
            </div>
          </DialogHeader>

          {/* Modal Content: Staff Table */}
          <div className="flex-1 overflow-auto min-h-[300px]">
            {schoolStaffQuery.isLoading ? (
              <div className="flex h-full items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : !schoolStaffQuery.data?.members?.length ? (
              <div className="flex h-full flex-col items-center justify-center text-muted-foreground gap-2 py-12">
                <Users className="h-12 w-12 opacity-20" />
                <p className="text-lg font-medium">No staff extracted yet</p>
                <p className="text-sm">Click "Run Extraction" to fetch staff contacts from this school's website.</p>
                <Button 
                  variant="outline" 
                  onClick={() => handleExtract(selectedSchoolId!)}
                  disabled={extractingSchoolId === selectedSchoolId}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  {extractingSchoolId === selectedSchoolId ? 'Extracting...' : 'Run Extraction Now'}
                </Button>
              </div>
            ) : (
              <ScrollArea className="h-[400px]" data-testid="scroll-staff-table">
                <Table data-testid="table-school-staff">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody data-testid="tbody-school-staff">
                    {schoolStaffQuery.data.members.map((member: any) => (
                      <TableRow key={member.id} data-testid={`row-staff-${member.id}`}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <span>{member.name}</span>
                            {networkStaffIdSet.has(member.id) && (
                              <NetworkBadge
                                staffId={member.id}
                                connectedAt={networkConnectedAt[String(member.id)]}
                                connectionName={networkConnectionName[String(member.id)]}
                              />
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">{member.title || '-'}</TableCell>
                        <TableCell>
                          {member.isRevealed ? (
                            <a 
                              href={`mailto:${member.email}`} 
                              className="text-primary hover:underline text-sm flex items-center gap-1"
                            >
                              <Mail className="h-3 w-3" /> {member.email}
                            </a>
                          ) : (
                            <span className="text-sm text-muted-foreground flex items-center gap-1">
                              <Lock className="h-3 w-3" /> {member.email}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {member.phone || '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {!member.isRevealed && (
                              <RevealButton staffId={member.id} size="sm" variant="outline" hasContact={member.email != null || member.phone != null} />
                            )}
                            {member.linkedinUrl && (
                              <a 
                                href={member.linkedinUrl} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:text-blue-800"
                                data-testid={`link-linkedin-${member.id}`}
                              >
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <Linkedin className="h-4 w-4" />
                                </Button>
                              </a>
                            )}
                            {member.twitterHandle && (
                              <a 
                                href={`https://twitter.com/${member.twitterHandle}`} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-sky-500 hover:text-sky-600"
                                data-testid={`link-twitter-${member.id}`}
                              >
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <Twitter className="h-4 w-4" />
                                </Button>
                              </a>
                            )}
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8"
                              onClick={() => {
                                navigator.clipboard.writeText(`${member.name} <${member.email}>`);
                                toast({ title: "Copied!", description: "Ready to paste into Gmail." });
                              }}
                              title="Copy for Email"
                              data-testid={`button-copy-${member.id}`}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-primary"
                              onClick={() => handleAddToList(member.id)}
                              title="Add to List"
                              data-testid={`button-add-to-list-${member.id}`}
                            >
                              <PlusSquare className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </div>
          
          <DialogFooter className="border-t pt-4">
            <div className="flex items-center justify-between w-full gap-4">
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {schoolStaffQuery.data?.members?.length || 0} contacts found
                </span>
                {selectedSchoolData?.avgConfidence && selectedSchoolData.avgConfidence > 0 && (
                  <Badge variant="outline" className="text-xs gap-1">
                    <Shield className="h-3 w-3" />
                    {selectedSchoolData.avgConfidence}% confidence
                  </Badge>
                )}
                {schoolStaffQuery.data?.members?.some((m: any) => m.confidence?.overall >= 80) && (
                  <Badge variant="secondary" className="text-xs gap-1 bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                    <Sparkles className="h-3 w-3" />
                    AI Enhanced
                  </Badge>
                )}
                {selectedSchoolData?.lastExtractedAt && (
                  <span className="text-xs text-muted-foreground">
                    Last: {new Date(selectedSchoolData.lastExtractedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportSchoolCSV}
                disabled={!schoolStaffQuery.data?.members?.length}
                data-testid="button-export-school-csv"
              >
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleCRMExport}
                disabled={!schoolStaffQuery.data?.members?.length}
                data-testid="button-crm-export"
              >
                <Download className="h-4 w-4 mr-2" />
                CRM Export
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Add to List Dialog */}
      <Dialog open={addToListDialogOpen} onOpenChange={setAddToListDialogOpen}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-add-to-list">
          <DialogHeader>
            <DialogTitle>Add to List</DialogTitle>
            <DialogDescription>
              Select an existing list or create a new one to save this contact.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Existing Lists */}
            {listsQuery.data && listsQuery.data.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Your Lists</p>
                <div className="space-y-1">
                  {listsQuery.data.map((list: any) => (
                    <Button
                      key={list.id}
                      variant="outline"
                      className="w-full justify-between"
                      onClick={() => {
                        if (selectedStaffIdForList) {
                          addToListMutation.mutate({ listId: list.id, staffId: selectedStaffIdForList });
                        }
                      }}
                      disabled={addToListMutation.isPending}
                      data-testid={`button-select-list-${list.id}`}
                    >
                      <span>{list.name}</span>
                      <Badge variant="secondary">{list.itemCount} contacts</Badge>
                    </Button>
                  ))}
                </div>
              </div>
            )}
            
            {/* Create New List */}
            <div className="space-y-2">
              <p className="text-sm font-medium">Create New List</p>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g., SEC Football Leads"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  data-testid="input-new-list-name"
                />
                <Button
                  onClick={() => {
                    if (newListName.trim()) {
                      createListMutation.mutate({ name: newListName.trim() });
                    }
                  }}
                  disabled={!newListName.trim() || createListMutation.isPending}
                  data-testid="button-create-list"
                >
                  {createListMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create'}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Expanded Contact Dialog */}
      <ExpandedContactDialog 
        member={expandedContact}
        open={!!expandedContact}
        onOpenChange={(open) => !open && setExpandedContact(null)}
        inNetwork={expandedContact ? networkStaffIdSet.has(expandedContact.id) : false}
        networkConnectedAt={expandedContact ? networkConnectedAt[String(expandedContact.id)] : null}
        networkConnectionName={expandedContact ? networkConnectionName[String(expandedContact.id)] : null}
      />
    </div>
  );
}
