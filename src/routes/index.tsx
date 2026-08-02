import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, ClipboardCheck, LayoutDashboard, ShieldCheck, Users } from "lucide-react";
import heroImage from "@/assets/govvisit-hero.jpg";
import nigeriaCoatOfArms from "@/assets/nigeria-coat-of-arms.svg";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/hooks/use-session";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "GovVisit — Visitor management for government facilities" },
      {
        name: "description",
        content:
          "GovVisit registers pre-booked and walk-in visitors, issues electronic passes, tracks occupancy and gives administrators a full visitor audit trail.",
      },
      { property: "og:title", content: "GovVisit — Visitor management for government facilities" },
      {
        property: "og:description",
        content:
          "Reception check-in, checkout, occupancy monitoring and reporting for public sector facilities.",
      },
    ],
  }),
  component: Landing,
});

const features = [
  {
    icon: ClipboardCheck,
    title: "Reception desk app",
    body: "Register pre-booked and walk-in visitors, capture identity documents and issue an electronic pass in under a minute.",
  },
  {
    icon: Users,
    title: "Live occupancy",
    body: "See who is inside the building right now, how long they have been onsite and who has exceeded their expected duration.",
  },
  {
    icon: LayoutDashboard,
    title: "Administrator dashboard",
    body: "Visitor records, pre-booked invitations, departments and hosts, exports and configuration in one console.",
  },
  {
    icon: ShieldCheck,
    title: "Full audit trail",
    body: "Every check-in, checkout, record change and export is written to an immutable activity log.",
  },
];

function Landing() {
  const { data: session } = useSession();
  const signedIn = Boolean(session?.userId);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <GovernmentBrand />
          {signedIn ? (
            <div className="flex items-center gap-2">
              <Button asChild variant="ghost" size="sm">
                <Link to="/dashboard">Dashboard</Link>
              </Button>
              <Button asChild size="sm">
                <Link to="/reception">Open reception</Link>
              </Button>
            </div>
          ) : (
            <Button asChild size="sm">
              <Link to="/auth">Staff sign in</Link>
            </Button>
          )}
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-14 lg:grid-cols-2 lg:py-20">
          <div>
            <Badge variant="gold">Demo prototype · Abuja Headquarters</Badge>
            <h1 className="mt-5 font-display text-4xl leading-[1.1] sm:text-5xl">
              Every visitor accounted for, from the gate to the checkout desk.
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              GovVisit replaces the paper visitor book with a reception app for officers and an
              administrator console for the facility team — pre-bookings, walk-ins, electronic
              passes, live occupancy and reporting.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to={signedIn ? "/reception" : "/auth"}>
                  {signedIn ? "Open reception desk" : "Sign in to start the demo"}
                  <ArrowRight />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link to={signedIn ? "/dashboard" : "/auth"}>Administrator dashboard</Link>
              </Button>
            </div>
            <dl className="mt-10 grid grid-cols-3 gap-4 border-t border-border pt-6">
              <div>
                <dt className="text-xs text-muted-foreground">Visitor journeys</dt>
                <dd className="text-xl font-bold">2</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Console modules</dt>
                <dd className="text-xl font-bold">9</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Staff roles</dt>
                <dd className="text-xl font-bold">2</dd>
              </div>
            </dl>
          </div>
          <div className="overflow-hidden rounded-3xl shadow-pop">
            <img
              src={heroImage}
              alt="Government administrative building entrance with flagpoles at dusk"
              width={1600}
              height={1008}
              className="h-full w-full object-cover"
            />
          </div>
        </section>

        <section className="border-t border-border bg-card">
          <div className="mx-auto max-w-6xl px-5 py-14">
            <h2 className="font-display text-3xl">What the prototype covers</h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {features.map((f) => (
                <div key={f.title} className="rounded-2xl border border-border p-5 shadow-card">
                  <div className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground">
                    <f.icon className="size-5" />
                  </div>
                  <h3 className="mt-4 text-base font-bold">{f.title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        GovVisit demo prototype · Restricted system · Authorised personnel only
      </footer>
    </div>
  );
}

function GovernmentBrand() {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-white p-1 shadow-sm">
        <img
          src={coatOfArms}
          alt="Coat of Arms of the Federal Republic of Nigeria"
          width={265}
          height={177}
          className="h-full w-full object-contain"
        />
      </div>
      <div className="min-w-0">
        <p className="font-display text-xl leading-none">GovVisit</p>
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Federal Republic of Nigeria
        </p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          Federal Public Services Administration
        </p>
      </div>
    </div>
  );
}
