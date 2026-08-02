import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { landingPath, roleRank, type AppRole } from "@/lib/govvisit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import nigeriaCoatOfArms from "@/assets/nigeria-coat-of-arms.svg";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Staff access and platform demo — GovVisit" },
      {
        name: "description",
        content:
          "Access GovVisit and explore the reception, visitor registration, live occupancy, reporting and audit capabilities included in the platform demo.",
      },
      { property: "og:title", content: "Staff access and platform demo — GovVisit" },
      {
        property: "og:description",
        content:
          "Reception and administrator access to the GovVisit visitor management platform.",
      },
    ],
  }),
  beforeLoad: async () => {
    if (typeof window === "undefined") return;

    const { data } = await supabase.auth.getSession();
    if (data.session) {
      throw redirect({ to: await landingFor(data.session.user.id) });
    }
  },
  component: AuthPage,
});

/**
 * Only the global Receptionist starts at the reception desk.
 * Every other role lands on the administration dashboard, scoped by role,
 * department and rank through the existing GovVisit authorization model.
 */
async function landingFor(userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);

  if (error) {
    throw new Error("Your account was authenticated, but its GovVisit role could not be loaded.");
  }

  const ranks = (data ?? []).map((record) => roleRank(record.role as AppRole));
  return landingPath(ranks.length ? Math.min(...ranks) : 99);
}

type AccessMode = "signin" | "signup";
type DemoArea = "reception" | "administration";

type Capability = {
  title: string;
  description: string;
  icon: ReactNode;
};

const receptionCapabilities: Capability[] = [
  {
    title: "Register arrivals",
    description: "Process pre-booked and walk-in visitors through guided reception journeys.",
    icon: <ArrivalIcon />,
  },
  {
    title: "Scan and verify identity",
    description: "Capture passport, driving licence, NIN card or staff ID details using OCR.",
    icon: <ScanIcon />,
  },
  {
    title: "Issue visitor passes",
    description: "Create electronic passes, provide a print fallback and assign access zones.",
    icon: <PassIcon />,
  },
  {
    title: "Control occupancy",
    description: "See who is inside, identify overdue visits and complete secure checkout.",
    icon: <OccupancyIcon />,
  },
];

const administrationCapabilities: Capability[] = [
  {
    title: "Executive dashboard",
    description: "Monitor visitor volumes, current occupancy, expected arrivals and trends.",
    icon: <DashboardIcon />,
  },
  {
    title: "Manage visit operations",
    description: "Create pre-bookings, review walk-in queues and maintain departments and hosts.",
    icon: <CalendarIcon />,
  },
  {
    title: "Review records and reports",
    description: "Search visitor history and export operational, traffic and overdue reports.",
    icon: <ReportIcon />,
  },
  {
    title: "Govern and audit",
    description: "Review immutable activity logs, configuration and service status.",
    icon: <AuditIcon />,
  },
];

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<AccessMode>("signin");
  const [demoArea, setDemoArea] = useState<DemoArea>("reception");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [jobTitle, setJobTitle] = useState("Reception Officer");
  const [busy, setBusy] = useState(false);
  const [staffExists, setStaffExists] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;

    void supabase
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .then(({ count, error }) => {
        if (!active || error) return;
        setStaffExists((count ?? 0) > 0);
      });

    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);

    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth`,
            data: {
              full_name: fullName.trim() || email.split("@")[0],
              job_title: jobTitle.trim() || "Staff Member",
            },
          },
        });

        if (error) throw error;

        if (!data.session) {
          toast.success("Account created. Check your work email to confirm the account.");
          setMode("signin");
          return;
        }

        toast.success("Account created and signed in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (error) throw error;
        toast.success("Signed in successfully.");
      }

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userData.user) throw new Error("The authenticated user could not be retrieved.");

      await navigate({ to: await landingFor(userData.user.id) });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  function switchMode(nextMode: AccessMode) {
    setMode(nextMode);
    setPassword("");
  }

  const activeCapabilities =
    demoArea === "reception" ? receptionCapabilities : administrationCapabilities;

  return (
    <main className="min-h-screen bg-background lg:grid lg:grid-cols-[minmax(0,1.45fr)_minmax(420px,0.75fr)]">
      <section className="relative overflow-hidden bg-crest-gradient px-6 py-8 text-primary-foreground sm:px-10 lg:min-h-screen lg:px-12 lg:py-10 xl:px-16">
        <div
          className="pointer-events-none absolute inset-0 opacity-20"
          aria-hidden="true"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 15%, rgba(255,255,255,.28), transparent 24%), radial-gradient(circle at 88% 78%, rgba(199,168,74,.35), transparent 28%)",
          }}
        />

        <div className="relative mx-auto flex h-full max-w-5xl flex-col">
          <header className="flex items-center justify-between gap-4">
            <GovernmentBrand variant="inverse" />
            <span className="hidden rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold backdrop-blur sm:inline-flex">
              Version 1 Demonstration
            </span>
          </header>

          <div className="mt-12 max-w-3xl lg:mt-16">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#ead692]">
              Secure visitor operations from arrival to departure
            </p>
            <h1 className="mt-4 font-display text-4xl leading-[1.08] sm:text-5xl xl:text-6xl">
              Every visitor accounted for, from the gate to the checkout desk.
            </h1>
            <p className="mt-5 max-w-2xl text-sm leading-6 opacity-85 sm:text-base">
              GovVisit connects reception processing, identity capture, visitor passes, live
              occupancy, administrative control, reporting and audit evidence in one governed
              platform.
            </p>
          </div>

          <div className="mt-9 max-w-4xl rounded-2xl border border-white/15 bg-black/10 p-2 backdrop-blur-sm">
            <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Demo capability areas">
              <button
                type="button"
                role="tab"
                aria-selected={demoArea === "reception"}
                onClick={() => setDemoArea("reception")}
                className={`rounded-xl px-4 py-3 text-left transition ${
                  demoArea === "reception"
                    ? "bg-white text-primary shadow-lg"
                    : "text-white hover:bg-white/10"
                }`}
              >
                <span className="block text-sm font-bold">Reception experience</span>
                <span className={`mt-0.5 block text-xs ${demoArea === "reception" ? "text-muted-foreground" : "opacity-70"}`}>
                  Mobile-first visitor processing
                </span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={demoArea === "administration"}
                onClick={() => setDemoArea("administration")}
                className={`rounded-xl px-4 py-3 text-left transition ${
                  demoArea === "administration"
                    ? "bg-white text-primary shadow-lg"
                    : "text-white hover:bg-white/10"
                }`}
              >
                <span className="block text-sm font-bold">Administration experience</span>
                <span className={`mt-0.5 block text-xs ${demoArea === "administration" ? "text-muted-foreground" : "opacity-70"}`}>
                  Desktop control and oversight
                </span>
              </button>
            </div>
          </div>

          <div className="mt-4 grid max-w-4xl gap-3 sm:grid-cols-2">
            {activeCapabilities.map((capability) => (
              <article
                key={capability.title}
                className="group rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-sm transition hover:-translate-y-0.5 hover:bg-white/[0.14]"
              >
                <div className="flex gap-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/15 text-[#ead692]">
                    {capability.icon}
                  </div>
                  <div>
                    <h2 className="text-sm font-bold">{capability.title}</h2>
                    <p className="mt-1 text-xs leading-5 opacity-75">{capability.description}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="mt-6 grid max-w-4xl grid-cols-3 gap-2 rounded-2xl border border-white/15 bg-white/[0.08] p-4 text-center backdrop-blur-sm sm:gap-4">
            <DemoMetric value="2" label="Role-based experiences" />
            <DemoMetric value="End-to-end" label="Visitor lifecycle" />
            <DemoMetric value="Live" label="Operational visibility" />
          </div>

          <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-10 text-xs opacity-70">
            <p>Restricted system · Authorised personnel only</p>
            <p>Security by design · Audit by design</p>
          </footer>
        </div>
      </section>

      <section className="flex min-h-[720px] items-center justify-center px-6 py-12 sm:px-10 lg:min-h-screen lg:px-12">
        <div className="w-full max-w-md">
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground transition hover:text-primary"
          >
            <span aria-hidden="true">←</span> Back to overview
          </Link>

          <div className="mt-8">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
              Secure staff access
            </p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">
              {mode === "signin" ? "Sign in to begin the demo" : "Create the first staff account"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {staffExists === false
                ? "No staff roles are configured yet. Under the current bootstrap rule, the first account created becomes the facility administrator."
                : mode === "signin"
                  ? "Your assigned role determines whether GovVisit opens the reception workspace or the administration dashboard."
                  : "Use an authorised work email. Account permissions are applied through the GovVisit role model."}
            </p>
          </div>

          <div className="mt-7 grid grid-cols-2 rounded-xl bg-muted p-1" aria-label="Authentication mode">
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
                mode === "signin"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => switchMode("signup")}
              className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
                mode === "signup"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Create account
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {mode === "signup" && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <div>
                  <Label htmlFor="fullName">Full name</Label>
                  <Input
                    id="fullName"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    placeholder="Aisha Bello"
                    autoComplete="name"
                    className="mt-1.5"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="jobTitle">Job title</Label>
                  <Input
                    id="jobTitle"
                    value={jobTitle}
                    onChange={(event) => setJobTitle(event.target.value)}
                    placeholder="Reception Officer"
                    autoComplete="organization-title"
                    className="mt-1.5"
                  />
                </div>
              </div>
            )}

            <div>
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@agency.gov.ng"
                autoComplete="email"
                inputMode="email"
                className="mt-1.5"
                required
              />
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="password">Password</Label>
                {mode === "signin" && (
                  <span className="text-xs text-muted-foreground">Minimum 6 characters</span>
                )}
              </div>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={6}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                className="mt-1.5"
                required
              />
            </div>

            <Button type="submit" size="block" disabled={busy} aria-busy={busy}>
              {busy
                ? mode === "signin"
                  ? "Signing in…"
                  : "Creating account…"
                : mode === "signin"
                  ? "Sign in and open workspace"
                  : "Create staff account"}
            </Button>
          </form>

          <div className="mt-6 rounded-xl border bg-muted/40 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-foreground">Demo routing</p>
            <div className="mt-3 space-y-3 text-xs leading-5 text-muted-foreground">
              <div className="flex gap-2">
                <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" />
                <p>
                  <strong className="text-foreground">Global Receptionist:</strong> opens the
                  mobile-first reception workspace for arrival, ID scan, pass issue and checkout.
                </p>
              </div>
              <div className="flex gap-2">
                <span className="mt-1 size-2 shrink-0 rounded-full bg-[#c7a84a]" />
                <p>
                  <strong className="text-foreground">All other authorised roles:</strong> open the
                  web administration dashboard, scoped by assigned role and department.
                </p>
              </div>
            </div>
          </div>

          <p className="mt-6 text-center text-xs leading-5 text-muted-foreground">
            By accessing GovVisit, staff acknowledge that activity is monitored and recorded in the
            platform audit trail.
          </p>
        </div>
      </section>
    </main>
  );
}

function GovernmentBrand({ variant = "default" }: { variant?: "default" | "inverse" }) {
  const inverse = variant === "inverse";

  return (
    <div className="flex min-w-0 items-center gap-3">
      <div
        className={`flex h-14 w-[4.5rem] shrink-0 items-center justify-center overflow-hidden rounded-xl border p-1 shadow-sm ${
          inverse ? "border-white/25 bg-white" : "border-border bg-white"
        }`}
      >
        <img
          src={coatOfArms}
          alt="Coat of Arms of the Federal Republic of Nigeria"
          width={265}
          height={177}
          className="h-full w-full object-contain"
        />
      </div>
      <div className="min-w-0">
        <p className="font-display text-2xl leading-none">GovVisit</p>
        <p className={`mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${inverse ? "text-white/75" : "text-muted-foreground"}`}>
          Federal Republic of Nigeria
        </p>
        <p className={`mt-0.5 text-[10px] ${inverse ? "text-white/60" : "text-muted-foreground"}`}>
          Federal Public Services Administration
        </p>
      </div>
    </div>
  );
}

function DemoMetric({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-sm font-bold sm:text-base">{value}</p>
      <p className="mt-1 text-[10px] leading-4 opacity-70 sm:text-xs">{label}</p>
    </div>
  );
}

function IconFrame({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function ArrivalIcon() {
  return (
    <IconFrame>
      <path d="M12 5v14M5 12h14" />
    </IconFrame>
  );
}

function ScanIcon() {
  return (
    <IconFrame>
      <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 12h8" />
    </IconFrame>
  );
}

function PassIcon() {
  return (
    <IconFrame>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M7 15h4M14 9h3M14 13h3" />
    </IconFrame>
  );
}

function OccupancyIcon() {
  return (
    <IconFrame>
      <circle cx="9" cy="8" r="3" />
      <path d="M4 19a5 5 0 0 1 10 0M16 8h4M18 6v4" />
    </IconFrame>
  );
}

function DashboardIcon() {
  return (
    <IconFrame>
      <rect x="4" y="4" width="6" height="7" rx="1" />
      <rect x="14" y="4" width="6" height="4" rx="1" />
      <rect x="14" y="12" width="6" height="8" rx="1" />
      <rect x="4" y="15" width="6" height="5" rx="1" />
    </IconFrame>
  );
}

function CalendarIcon() {
  return (
    <IconFrame>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3v4M16 3v4M4 10h16M8 14h3" />
    </IconFrame>
  );
}

function ReportIcon() {
  return (
    <IconFrame>
      <path d="M6 20V10M12 20V4M18 20v-7" />
    </IconFrame>
  );
}

function AuditIcon() {
  return (
    <IconFrame>
      <path d="M9 11l2 2 4-4" />
      <path d="M12 3l7 3v5c0 4.6-2.9 8-7 10-4.1-2-7-5.4-7-10V6l7-3z" />
    </IconFrame>
  );
}
