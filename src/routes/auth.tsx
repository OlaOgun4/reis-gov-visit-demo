import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { landingPath, roleRank, type AppRole } from "@/lib/govvisit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Staff sign in — GovVisit" },
      {
        name: "description",
        content:
          "Sign in to GovVisit to register visitors, manage check-ins and review facility visitor records.",
      },
      { property: "og:title", content: "Staff sign in — GovVisit" },
      {
        property: "og:description",
        content: "Reception and administrator access to the GovVisit visitor management system.",
      },
    ],
  }),
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: await landingFor(data.session.user.id) });
  },
  component: AuthPage,
});

/** Only the global Receptionist starts at the reception desk; every other role
 * lands on the administration dashboard scoped to their department and rank. */
async function landingFor(userId: string) {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const ranks = (data ?? []).map((r) => roleRank(r.role as AppRole));
  return landingPath(ranks.length ? Math.min(...ranks) : 99);
}

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [jobTitle, setJobTitle] = useState("Reception Officer");
  const [busy, setBusy] = useState(false);
  const [staffExists, setStaffExists] = useState<boolean | null>(null);

  useEffect(() => {
    supabase
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .then(({ count, error }) => {
        if (error) return;
        setStaffExists((count ?? 0) > 0);
      });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: fullName || email.split("@")[0], job_title: jobTitle },
          },
        });
        if (error) throw error;
        toast.success("Account created. You are signed in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Signed in");
      }
      const { data: userData } = await supabase.auth.getUser();
      navigate({ to: userData.user ? await landingFor(userData.user.id) : "/reception" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-crest-gradient p-10 text-primary-foreground lg:flex">
        <div className="flex items-center gap-3">
          <div className="grid size-12 place-items-center rounded-xl bg-primary-foreground font-display text-xl text-primary">
            FG
          </div>
          <div>
            <p className="font-display text-2xl leading-none">GovVisit</p>
            <p className="text-xs opacity-80">Federal Public Services Administration</p>
          </div>
        </div>
        <div className="max-w-md">
          <h1 className="font-display text-4xl leading-tight">
            Every visitor accounted for, from the gate to the checkout desk.
          </h1>
          <p className="mt-4 text-sm opacity-85">
            Reception officers register arrivals and issue electronic passes. Administrators monitor
            occupancy, pre-bookings and the full audit trail.
          </p>
        </div>
        <p className="text-xs opacity-70">Restricted system · Authorised personnel only</p>
      </section>

      <section className="flex items-center justify-center px-6 py-14">
        <div className="w-full max-w-sm">
          <Link to="/" className="text-xs font-semibold text-muted-foreground hover:text-primary">
            ← Back to overview
          </Link>
          <h2 className="mt-6 text-2xl font-bold">
            {mode === "signin" ? "Staff sign in" : "Create staff account"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {staffExists === false
              ? "No staff accounts exist yet — the first account created becomes the facility administrator."
              : "Use your official work email address."}
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {mode === "signup" && (
              <>
                <div>
                  <Label htmlFor="fullName">Full name</Label>
                  <Input
                    id="fullName"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Aisha Bello"
                    className="mt-1.5"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="jobTitle">Job title</Label>
                  <Input
                    id="jobTitle"
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    className="mt-1.5"
                  />
                </div>
              </>
            )}
            <div>
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@agency.gov.ng"
                className="mt-1.5"
                required
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                className="mt-1.5"
                required
              />
            </div>
            <Button type="submit" size="block" disabled={busy}>
              {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <button
            type="button"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="mt-5 w-full text-sm text-muted-foreground hover:text-primary"
          >
            {mode === "signin"
              ? "No account yet? Create a staff account"
              : "Already registered? Sign in instead"}
          </button>
        </div>
      </section>
    </main>
  );
}
