import { Switch, Route, Link, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
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
  SidebarFooter,
} from "@/components/ui/sidebar";
import { 
  Home, Users, Building2, Target, TrendingUp, 
  BarChart3, Database, Sparkles, FolderOpen, Zap, Activity, Heart, Linkedin, Settings as SettingsIcon
} from "lucide-react";
import HomePage from "@/pages/home";
import StaffDirectory from "@/pages/staff-directory";
import Reports from "@/pages/reports";
import ListMatcher from "@/pages/list-matcher";
import GrowthTools from "@/pages/growth-tools";
import AccountPlan from "@/pages/account-plan";
import Jobs from "@/pages/jobs";
import Signals from "@/pages/signals";
import WhistleConnect from "@/pages/whistle-connect";
import ScraperHealth from "@/pages/scraper-health";
import DataHealth from "@/pages/data-health";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import Pricing from "@/pages/pricing";
import Landing from "@/pages/landing";
import Billing from "@/pages/billing";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import VerifyEmail from "@/pages/verify-email";
import TermsPage from "@/pages/terms";
import PrivacyPage from "@/pages/privacy";
import VerificationBanner from "@/components/verification-banner";
import { GlobalPaymentFailureDialog } from "@/components/payment-failure-dialog";

const navItems = [
  { title: "Dashboard", url: "/dashboard", icon: Home },
  { title: "Staff Directory", url: "/staff", icon: Users },
  { title: "Browse Schools", url: "/schools", icon: Building2 },
  { title: "Jobs", url: "/jobs", icon: FolderOpen },
];

const toolsItems = [
  { title: "Signal Feed", url: "/signals", icon: Zap },
  { title: "ABM List Matcher", url: "/list-matcher", icon: Target },
  { title: "Growth Tools", url: "/growth", icon: TrendingUp },
  { title: "Reports", url: "/reports", icon: BarChart3 },
  { title: "Data Health", url: "/data-health", icon: Heart },
  { title: "Scraper Health", url: "/scraper-health", icon: Activity },
];

function AppSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar>
      <SidebarHeader className="p-4 border-b">
        <Link href="/dashboard">
          <div className="flex items-center gap-3 cursor-pointer" data-testid="link-logo">
            <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
              <Database className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-semibold text-foreground text-sm">Whistle</h1>
              <p className="text-xs text-muted-foreground">Athletics Intelligence</p>
            </div>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild 
                    isActive={location === item.url || (item.url !== "/dashboard" && location.startsWith(item.url))}
                  >
                    <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase().replace(/\s+/g, '-')}`}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Sales Tools</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {toolsItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild 
                    isActive={location === item.url}
                  >
                    <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase().replace(/\s+/g, '-')}`}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Settings</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={location.startsWith('/settings/whistle-connect') || location === '/whistle-connect'}
                >
                  <Link href="/settings/whistle-connect" data-testid="link-nav-settings-whistle-connect">
                    <Linkedin className="h-4 w-4" />
                    <span>Whistle Connect</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={location.startsWith('/settings/billing')}
                >
                  <Link href="/settings/billing" data-testid="link-nav-settings-billing">
                    <SettingsIcon className="h-4 w-4" />
                    <span>Billing</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4 border-t">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="h-3 w-3" />
          <span>AI-Powered Extraction</span>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/dashboard" component={HomePage} />
      <Route path="/staff" component={StaffDirectory} />
      <Route path="/schools" component={StaffDirectory} />
      <Route path="/jobs" component={Jobs} />
      <Route path="/reports" component={Reports} />
      <Route path="/signals" component={Signals} />
      <Route path="/settings/whistle-connect" component={WhistleConnect} />
      <Route path="/settings/billing" component={Billing} />
      <Route path="/settings" component={WhistleConnect} />
      <Route path="/whistle-connect" component={WhistleConnect} />
      <Route path="/scraper-health" component={ScraperHealth} />
      <Route path="/data-health" component={DataHealth} />
      <Route path="/list-matcher" component={ListMatcher} />
      <Route path="/growth" component={GrowthTools} />
      <Route path="/account/:schoolId" component={AccountPlan} />
      <Route component={NotFound} />
    </Switch>
  );
}

function PublicShell({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function AuthedShell() {
  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };
  return (
    <SidebarProvider style={sidebarStyle as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex items-center gap-2 p-3 border-b bg-background">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
          </header>
          <VerificationBanner />
          <main className="flex-1 overflow-auto">
            <AppRouter />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Switch>
          <Route path="/" component={Landing} />
          <Route path="/login" component={Login} />
          <Route path="/pricing" component={Pricing} />
          <Route path="/forgot-password" component={ForgotPassword} />
          <Route path="/reset-password/:token" component={ResetPassword} />
          <Route path="/verify-email" component={VerifyEmail} />
          <Route path="/terms" component={TermsPage} />
          <Route path="/privacy" component={PrivacyPage} />
          <Route><AuthedShell /></Route>
        </Switch>
        <GlobalPaymentFailureDialog />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
