import { Link } from "wouter";
import { Database } from "lucide-react";

export default function LegalFooter() {
  return (
    <footer className="py-10 border-t" data-testid="footer-legal">
      <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
            <Database className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-semibold">Whistle</span>
          <span className="text-xs text-muted-foreground hidden md:inline">
            © {new Date().getFullYear()} Whistle Intelligence
          </span>
        </div>
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <Link href="/pricing" data-testid="link-footer-pricing" className="text-muted-foreground hover:text-foreground">Pricing</Link>
          <Link href="/terms" data-testid="link-footer-terms" className="text-muted-foreground hover:text-foreground">Terms of Service</Link>
          <Link href="/privacy" data-testid="link-footer-privacy" className="text-muted-foreground hover:text-foreground">Privacy Policy</Link>
          <a href="mailto:support@gowhistle.io" data-testid="link-footer-support" className="text-muted-foreground hover:text-foreground">Contact</a>
        </nav>
      </div>
    </footer>
  );
}
