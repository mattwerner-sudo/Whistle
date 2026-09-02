import { useState, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Database } from 'lucide-react';
import { SiGoogle } from 'react-icons/si';

const GOOGLE_ERRORS: Record<string, string> = {
  use_password_signin: "An account with this email already uses a password. Sign in with your password instead.",
  email_unverified: "Your Google account email isn't verified. Verify it with Google and try again.",
  invalid_oauth_state: "Google sign-in session expired. Please try again.",
  google_failed: "Couldn't complete Google sign-in. Please try again.",
};

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerName, setRegisterName] = useState('');
  const [registerAcceptedTos, setRegisterAcceptedTos] = useState(false);

  // /free landing: default to the Register tab and carry an optional ?school=
  // deep link through signup so the user lands on that school's unlock banner.
  const [freeMode] = useState(() => window.location.pathname === '/free');
  const [deepLinkSchool] = useState(() => new URLSearchParams(window.location.search).get('school'));
  const postAuthDestination = deepLinkSchool ? `/schools?school=${encodeURIComponent(deepLinkSchool)}` : '/dashboard';

  const { data: googleConfig } = useQuery<{ enabled: boolean }>({
    queryKey: ['/api/auth/google/config'],
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (err) {
      toast({
        variant: 'destructive',
        title: 'Sign-in error',
        description: GOOGLE_ERRORS[err] || err,
      });
      // Clean the URL so the toast doesn't re-fire on re-render.
      window.history.replaceState({}, '', '/login');
    }
  }, [toast]);

  const loginMutation = useMutation({
    mutationFn: async (data: { email: string; password: string }) => {
      return await apiRequest('POST', '/api/auth/login', data);
    },
    onSuccess: (data) => {
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
        toast({ title: 'Welcome back!', description: 'You are now logged in.' });
        setLocation(postAuthDestination);
      }
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Login Failed',
        description: error.message || 'Invalid email or password',
      });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (data: { email: string; password: string; fullName: string; acceptedTos: boolean }) => {
      return await apiRequest('POST', '/api/auth/register', data);
    },
    onSuccess: (data) => {
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
        toast({ title: 'Account Created!', description: deepLinkSchool ? 'Welcome to Whistle — unlock your free preview school below.' : 'Welcome to Whistle.' });
        setLocation(postAuthDestination);
      }
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Registration Failed',
        description: error.message || 'Could not create account',
      });
    },
  });

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate({ email: loginEmail, password: loginPassword });
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    if (!registerAcceptedTos) {
      toast({
        variant: 'destructive',
        title: 'Please accept the terms',
        description: 'You must agree to the Terms of Service and Privacy Policy to create an account.',
      });
      return;
    }
    registerMutation.mutate({
      email: registerEmail,
      password: registerPassword,
      fullName: registerName,
      acceptedTos: true,
    });
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="h-12 w-12 rounded-lg bg-primary flex items-center justify-center">
              <Database className="h-6 w-6 text-primary-foreground" />
            </div>
          </div>
          <CardTitle>{freeMode ? 'Preview one school free' : 'Welcome to Whistle'}</CardTitle>
          <CardDescription>
            {freeMode
              ? 'Create a free account — no card required — then unlock every verified contact at any one school of your choice.'
              : 'Sign in to access college athletics intelligence'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {googleConfig?.enabled && (
            <div className="space-y-3 mb-4">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => { window.location.href = '/api/auth/google/start'; }}
                data-testid="button-google-signin"
              >
                <SiGoogle className="h-4 w-4 mr-2" /> Continue with Google
              </Button>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">Or with email</span>
                </div>
              </div>
            </div>
          )}
          <Tabs defaultValue={freeMode ? "register" : "login"}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login" data-testid="tab-login">Sign In</TabsTrigger>
              <TabsTrigger value="register" data-testid="tab-register">Register</TabsTrigger>
            </TabsList>
            
            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="you@example.com"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    required
                    data-testid="input-login-email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">Password</Label>
                  <Input
                    id="login-password"
                    type="password"
                    placeholder="Your password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    required
                    data-testid="input-login-password"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loginMutation.isPending} data-testid="button-login">
                  {loginMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  Sign In
                </Button>
                <div className="text-center">
                  <Link
                    href="/forgot-password"
                    className="text-sm text-muted-foreground hover:text-foreground"
                    data-testid="link-forgot-password"
                  >
                    Forgot your password?
                  </Link>
                </div>
              </form>
            </TabsContent>
            
            <TabsContent value="register">
              <form onSubmit={handleRegister} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="register-name">Full Name</Label>
                  <Input
                    id="register-name"
                    type="text"
                    placeholder="John Doe"
                    value={registerName}
                    onChange={(e) => setRegisterName(e.target.value)}
                    required
                    data-testid="input-register-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="register-email">Email</Label>
                  <Input
                    id="register-email"
                    type="email"
                    placeholder="you@example.com"
                    value={registerEmail}
                    onChange={(e) => setRegisterEmail(e.target.value)}
                    required
                    data-testid="input-register-email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="register-password">Password</Label>
                  <Input
                    id="register-password"
                    type="password"
                    placeholder="Choose a password"
                    value={registerPassword}
                    onChange={(e) => setRegisterPassword(e.target.value)}
                    required
                    minLength={6}
                    data-testid="input-register-password"
                  />
                </div>
                <div className="flex items-start gap-2 pt-1">
                  <input
                    id="register-tos"
                    type="checkbox"
                    checked={registerAcceptedTos}
                    onChange={(e) => setRegisterAcceptedTos(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-input"
                    data-testid="checkbox-register-tos"
                  />
                  <Label htmlFor="register-tos" className="text-xs text-muted-foreground leading-snug font-normal">
                    I agree to Whistle's{' '}
                    <Link href="/terms" className="underline text-foreground" data-testid="link-register-terms">Terms of Service</Link>{' '}
                    and{' '}
                    <Link href="/privacy" className="underline text-foreground" data-testid="link-register-privacy">Privacy Policy</Link>.
                  </Label>
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={registerMutation.isPending || !registerAcceptedTos}
                  data-testid="button-register"
                >
                  {registerMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  Create Account
                </Button>
                {googleConfig?.enabled && (
                  <p className="text-[11px] text-muted-foreground text-center">
                    Continuing with Google also accepts our{' '}
                    <Link href="/terms" className="underline">Terms</Link> and{' '}
                    <Link href="/privacy" className="underline">Privacy Policy</Link>.
                  </p>
                )}
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
