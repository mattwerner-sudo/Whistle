import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Database, Users, Zap, Download, Mail, Target,
  Building2, BarChart3, ArrowRight, CheckCircle2
} from 'lucide-react';
import LegalFooter from '@/components/legal-footer';

const features = [
  {
    icon: Users,
    title: 'Staff Directory Access',
    description: 'Access contact details for 1,100+ college athletic departments across all divisions.',
  },
  {
    icon: Zap,
    title: 'AI-Powered Extraction',
    description: 'Automatically extract names, titles, emails, and phone numbers from athletic websites.',
  },
  {
    icon: Download,
    title: 'Bulk Export',
    description: 'Export contacts to CSV for use in your CRM, email campaigns, or sales workflows.',
  },
  {
    icon: Mail,
    title: 'Email Drafting',
    description: 'AI-assisted email templates customized for each contact and their role.',
  },
  {
    icon: Target,
    title: 'Buyer Personas',
    description: 'Automatically categorize contacts as champions, signers, or influencers.',
  },
  {
    icon: BarChart3,
    title: 'Account Planning',
    description: 'Strategic insights on budget cycles, tech stack, and buying windows.',
  },
];

const stats = [
  { value: '1,100+', label: 'College Schools' },
  { value: '50,000+', label: 'Athletic Staff Contacts' },
  { value: '3', label: 'College Divisions' },
  { value: '32', label: 'Conferences' },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
              <Database className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-semibold text-lg">Whistle</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/pricing">
              <Button variant="ghost" data-testid="link-header-pricing">Pricing</Button>
            </Link>
            <Link href="/login">
              <Button variant="outline" data-testid="link-header-login">Sign In</Button>
            </Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-background" />
        <div className="max-w-7xl mx-auto px-6 py-24 relative">
          <div className="text-center max-w-3xl mx-auto">
            <Badge className="mb-6" variant="secondary">
              The #1 College Athletics Intelligence Platform
            </Badge>
            <h1 className="text-5xl font-bold tracking-tight text-foreground mb-6">
              Find and connect with college athletic staff in seconds
            </h1>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              Whistle gives you instant access to verified contact data for coaches, 
              athletic directors, and staff across all 1,100+ college institutions.
            </p>
            <div className="flex items-center justify-center gap-4">
              <Link href="/pricing">
                <Button size="lg" className="gap-2" data-testid="button-hero-cta">
                  Get Started
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 border-y bg-muted/30">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-4xl font-bold text-primary mb-2">{stat.value}</div>
                <div className="text-muted-foreground">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">How It Works</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Three simple steps to access the most comprehensive college staff database
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            <Card className="text-center">
              <CardContent className="pt-8 pb-6">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <Building2 className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold text-lg mb-2">1. Search Schools</h3>
                <p className="text-muted-foreground text-sm">
                  Browse 1,100+ college schools by division, conference, or name
                </p>
              </CardContent>
            </Card>
            
            <Card className="text-center">
              <CardContent className="pt-8 pb-6">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <Zap className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold text-lg mb-2">2. Extract Contacts</h3>
                <p className="text-muted-foreground text-sm">
                  AI extracts emails, phones, titles, and social links automatically
                </p>
              </CardContent>
            </Card>
            
            <Card className="text-center">
              <CardContent className="pt-8 pb-6">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <Download className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold text-lg mb-2">3. Export & Connect</h3>
                <p className="text-muted-foreground text-sm">
                  Download contacts to CSV or use AI to draft personalized emails
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <section className="py-24 bg-muted/30">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">Powerful Features</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Everything you need to build relationships with college athletic departments
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature) => (
              <Card key={feature.title} className="hover-elevate">
                <CardContent className="pt-6">
                  <feature.icon className="h-8 w-8 text-primary mb-4" />
                  <h3 className="font-semibold text-lg mb-2">{feature.title}</h3>
                  <p className="text-muted-foreground text-sm">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Simple Credit-Based Pricing</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Pay only for what you use. 1 credit = 1 exported contact = $1
            </p>
          </div>
          
          <div className="flex flex-col items-center gap-6">
            <div className="flex flex-wrap justify-center gap-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                Credits never expire
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                Bulk discounts available
              </div>
            </div>
            
            <Link href="/pricing">
              <Button size="lg" className="gap-2" data-testid="button-pricing-cta">
                View Credit Packages
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="py-24 bg-primary text-primary-foreground">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-3xl font-bold mb-4">
            Ready to connect with college athletics?
          </h2>
          <p className="text-primary-foreground/80 text-lg mb-8 max-w-2xl mx-auto">
            Join hundreds of sales teams, recruiters, and vendors who use Whistle 
            to reach athletic departments faster.
          </p>
          <Link href="/pricing">
            <Button size="lg" variant="secondary" className="gap-2" data-testid="button-final-cta">
              Get Started Now
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      <LegalFooter />
    </div>
  );
}
