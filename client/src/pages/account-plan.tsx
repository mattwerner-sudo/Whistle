import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'wouter';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  ArrowLeft, 
  Users, 
  Building2, 
  Calendar, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  Mail, 
  Phone,
  Server,
  Ticket,
  Activity,
  Shield,
  TrendingUp,
  ExternalLink
} from 'lucide-react';
import type { SchoolDirectory, StaffMember } from '@shared/schema';

interface PersonaGroup {
  label: string;
  icon: typeof Users;
  color: string;
  bgColor: string;
  members: StaffMember[];
}

function getBuyingWindowBadge(status: string | null | undefined) {
  switch (status) {
    case 'open':
      return (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 gap-1">
          <CheckCircle2 className="w-3 h-3" />
          Buying Window Open
        </Badge>
      );
    case 'planning':
      return (
        <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 gap-1">
          <Clock className="w-3 h-3" />
          Planning Phase
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="gap-1">
          <AlertCircle className="w-3 h-3" />
          Window Closed
        </Badge>
      );
  }
}

function TechStackCard({ techStack, categories }: { 
  techStack: string[] | null | undefined;
  categories: {
    cms: string[];
    ticketing: string[];
    operations: string[];
    analytics: string[];
    compliance: string[];
  } | null;
}) {
  if (!techStack || techStack.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="w-4 h-4" />
            Tech Stack
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No technologies detected yet.</p>
          <p className="text-xs text-muted-foreground mt-2">
            Technologies are detected during staff extraction.
          </p>
        </CardContent>
      </Card>
    );
  }

  const techCategories = [
    { label: 'CMS/Website', items: categories?.cms || [], icon: Building2 },
    { label: 'Ticketing', items: categories?.ticketing || [], icon: Ticket },
    { label: 'Operations', items: categories?.operations || [], icon: Activity },
    { label: 'Analytics', items: categories?.analytics || [], icon: TrendingUp },
    { label: 'Compliance', items: categories?.compliance || [], icon: Shield },
  ].filter(cat => cat.items.length > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Server className="w-4 h-4" />
          Tech Stack
        </CardTitle>
        <CardDescription>
          {techStack.length} technologies detected
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {techCategories.map(category => (
          <div key={category.label}>
            <div className="flex items-center gap-2 text-sm font-medium mb-2">
              <category.icon className="w-3.5 h-3.5 text-muted-foreground" />
              {category.label}
            </div>
            <div className="flex flex-wrap gap-2">
              {category.items.map(tech => (
                <Badge key={tech} variant="secondary" className="text-xs">
                  {tech}
                </Badge>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function PersonaSection({ group }: { group: PersonaGroup }) {
  const Icon = group.icon;
  
  if (group.members.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className={`p-1.5 rounded ${group.bgColor}`}>
          <Icon className={`w-4 h-4 ${group.color}`} />
        </div>
        <h3 className="font-medium">{group.label}</h3>
        <Badge variant="secondary" className="ml-auto">
          {group.members.length}
        </Badge>
      </div>
      <div className="space-y-2 pl-8">
        {group.members.map(member => (
          <div 
            key={member.id} 
            className="flex items-center gap-3 p-3 rounded-lg border bg-card hover-elevate"
            data-testid={`contact-card-${member.id}`}
          >
            <Avatar className="w-10 h-10">
              <AvatarImage src={member.imageUrl || undefined} alt={member.name} />
              <AvatarFallback className="text-sm">
                {member.name.split(' ').map(n => n[0]).join('').substring(0, 2)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{member.name}</p>
              <p className="text-xs text-muted-foreground truncate">{member.title || 'No title'}</p>
            </div>
            <div className="flex items-center gap-2">
              {member.email && (
                <a 
                  href={`mailto:${member.email}`}
                  className="text-muted-foreground hover:text-foreground"
                  data-testid={`email-link-${member.id}`}
                >
                  <Mail className="w-4 h-4" />
                </a>
              )}
              {member.phone && (
                <a 
                  href={`tel:${member.phone}`}
                  className="text-muted-foreground hover:text-foreground"
                  data-testid={`phone-link-${member.id}`}
                >
                  <Phone className="w-4 h-4" />
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function categorizeTechStack(techStack: string[] | null | undefined) {
  if (!techStack) return null;
  
  const categories = {
    cms: [] as string[],
    ticketing: [] as string[],
    operations: [] as string[],
    analytics: [] as string[],
    compliance: [] as string[],
  };

  const categoryMap: Record<string, keyof typeof categories> = {
    'Sidearm Sports': 'cms',
    'Neulion': 'cms',
    'WMT Digital': 'cms',
    'Presto Sports': 'cms',
    'Ticketmaster': 'ticketing',
    'Paciolan': 'ticketing',
    'Fevo': 'ticketing',
    'Teamworks': 'operations',
    'ARMS Software': 'operations',
    'JumpForward': 'operations',
    'INFLCR': 'operations',
    'Catapult Sports': 'analytics',
    'Hudl': 'analytics',
    'Genius Sports': 'analytics',
    'NCAA Compliance': 'compliance',
  };

  for (const tech of techStack) {
    const category = categoryMap[tech];
    if (category) {
      categories[category].push(tech);
    }
  }

  return categories;
}

export default function AccountPlan() {
  const params = useParams<{ schoolId: string }>();
  const schoolId = params.schoolId;

  const { data: schoolData, isLoading: schoolLoading } = useQuery<{ directories: SchoolDirectory[] }>({
    queryKey: [`/api/staff/schools?search=${schoolId}&limit=1`],
    enabled: !!schoolId,
  });
  const school = schoolData?.directories?.find(d => d.schoolId === schoolId);

  const { data: staffData, isLoading: staffLoading } = useQuery<{ members: StaffMember[] }>({
    queryKey: [`/api/staff/members?schoolId=${schoolId}&limit=200`],
    enabled: !!schoolId,
  });

  const staff = staffData?.members || [];

  const personaGroups: PersonaGroup[] = [
    {
      label: 'Executive Signers',
      icon: Users,
      color: 'text-green-600 dark:text-green-400',
      bgColor: 'bg-green-100 dark:bg-green-900/30',
      members: staff.filter(s => s.buyerPersona === 'signer'),
    },
    {
      label: 'Operational Champions',
      icon: Activity,
      color: 'text-blue-600 dark:text-blue-400',
      bgColor: 'bg-blue-100 dark:bg-blue-900/30',
      members: staff.filter(s => s.buyerPersona === 'champion'),
    },
    {
      label: 'Budget Gatekeepers',
      icon: Shield,
      color: 'text-red-600 dark:text-red-400',
      bgColor: 'bg-red-100 dark:bg-red-900/30',
      members: staff.filter(s => s.buyerPersona === 'blocker'),
    },
    {
      label: 'Key Influencers',
      icon: TrendingUp,
      color: 'text-purple-600 dark:text-purple-400',
      bgColor: 'bg-purple-100 dark:bg-purple-900/30',
      members: staff.filter(s => s.buyerPersona === 'influencer'),
    },
    {
      label: 'End Users',
      icon: Users,
      color: 'text-gray-600 dark:text-gray-400',
      bgColor: 'bg-gray-100 dark:bg-gray-900/30',
      members: staff.filter(s => s.buyerPersona === 'user' || !s.buyerPersona),
    },
  ];

  const techCategories = categorizeTechStack(school?.techStack);

  if (schoolLoading || staffLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-48" />
          <Skeleton className="h-48 lg:col-span-2" />
        </div>
      </div>
    );
  }

  if (!school) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-muted-foreground">School not found.</p>
            <Link href="/schools">
              <Button variant="ghost" className="mt-2">
                Back to Schools
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <Link href="/schools">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-3">
            {school.logoUrl && (
              <Avatar className="w-12 h-12">
                <AvatarImage src={school.logoUrl} alt={school.schoolName} />
                <AvatarFallback>{school.schoolName.substring(0, 2)}</AvatarFallback>
              </Avatar>
            )}
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-school-name">
                {school.schoolFullName}
              </h1>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{school.division}</span>
                {school.conference && (
                  <>
                    <span>•</span>
                    <span>{school.conference}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {getBuyingWindowBadge(school.buyingWindowStatus)}
          <Badge variant="outline" className="gap-1">
            <Calendar className="w-3 h-3" />
            FY End: {school.fiscalYearEnd || '06-30'}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-6">
          <TechStackCard techStack={school.techStack} categories={techCategories} />


          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                Account Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Contacts</span>
                <span className="font-medium">{staff.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Signers</span>
                <span className="font-medium text-green-600">
                  {personaGroups.find(g => g.label === 'Executive Signers')?.members.length || 0}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Champions</span>
                <span className="font-medium text-blue-600">
                  {personaGroups.find(g => g.label === 'Operational Champions')?.members.length || 0}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Gatekeepers</span>
                <span className="font-medium text-red-600">
                  {personaGroups.find(g => g.label === 'Budget Gatekeepers')?.members.length || 0}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                Buying Committee
              </CardTitle>
              <CardDescription>
                Contacts organized by buyer persona for strategic account planning
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {personaGroups.filter(g => g.members.length > 0).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No contacts found. Extract staff data to populate the buying committee.
                </p>
              ) : (
                personaGroups.map(group => (
                  <PersonaSection key={group.label} group={group} />
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
