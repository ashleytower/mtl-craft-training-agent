import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import { Loader2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { useLocation } from "wouter";

export default function Login() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSendingMagicLink, setIsSendingMagicLink] = useState(false);

  const handleSignIn = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setInfo(null);

    if (!email.trim() || !password) {
      setError("Email and password are required.");
      return;
    }

    setIsSigningIn(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setError(signInError.message);
        return;
      }

      setLocation("/");
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleMagicLink = async () => {
    setError(null);
    setInfo(null);

    if (!email.trim()) {
      setError("Enter your email to receive a magic link.");
      return;
    }

    setIsSendingMagicLink(true);
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin },
      });

      if (otpError) {
        setError(otpError.message);
        return;
      }

      setInfo("Check your email for a magic link to sign in.");
    } finally {
      setIsSendingMagicLink(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4">
          <h1 className="text-xl font-semibold text-neutral-900">Sign In</h1>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-6 py-8 flex items-start justify-center">
        <Card className="p-8 w-full max-w-md bg-white border-neutral-200">
          <form onSubmit={handleSignIn} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            {error ? (
              <div className="text-sm text-red-500">{error}</div>
            ) : null}

            {info ? (
              <div className="text-sm text-neutral-600">{info}</div>
            ) : null}

            <Button type="submit" disabled={isSigningIn}>
              {isSigningIn ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Sign In"
              )}
            </Button>

            <Button
              type="button"
              variant="outline"
              disabled={isSendingMagicLink}
              onClick={handleMagicLink}
            >
              {isSendingMagicLink ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Send me a magic link"
              )}
            </Button>
          </form>
        </Card>
      </main>
    </div>
  );
}
