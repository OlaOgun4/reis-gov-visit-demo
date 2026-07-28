import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Layers,
  Zap,
  Shield,
  BarChart3,
  Sparkles,
  Check,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lumina — Build better, ship faster" },
      {
        name: "description",
        content:
          "Lumina is the modern platform for teams who want to design, build, and launch products without friction.",
      },
      {
        property: "og:title",
        content: "Lumina — Build better, ship faster",
      },
      {
        property: "og:description",
        content:
          "Lumina is the modern platform for teams who want to design, build, and launch products without friction.",
      },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "https://id-preview--27876675-4a52-49f0-b27c-9a3ad5a723e0.lovable.app/images/hero-dashboard.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "https://id-preview--27876675-4a52-49f0-b27c-9a3ad5a723e0.lovable.app/images/hero-dashboard.png" },
    ],
  }),
  component: Index,
});

const features = [
  {
    icon: Zap,
    title: "Lightning fast",
    description:
      "Optimized workflows that cut release cycles from weeks to days without sacrificing quality.",
  },
  {
    icon: Layers,
    title: "Built for scale",
    description:
      "From your first prototype to your millionth user, our infrastructure grows with you.",
  },
  {
    icon: Shield,
    title: "Secure by default",
    description:
      "Enterprise-grade security, compliance, and permissions handled from the start.",
  },
  {
    icon: BarChart3,
    title: "Clear insights",
    description:
      "Real-time analytics and dashboards that help your team make smarter decisions.",
  },
  {
    icon: Sparkles,
    title: "AI assisted",
    description:
      "Intelligent suggestions and automation that remove repetitive busywork.",
  },
  {
    icon: Check,
    title: "Zero setup",
    description:
      "Get started in minutes with templates and integrations for your favorite tools.",
  },
];

function Index() {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6 lg:px-8">
        <Link to="/" className="flex items-center gap-2 text-foreground">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </div>
          <span className="text-lg font-semibold tracking-tight">Lumina</span>
        </Link>
        <nav className="hidden items-center gap-8 text-sm font-medium text-muted-foreground md:flex">
          <a href="#features" className="hover:text-foreground">
            Features
          </a>
          <a href="#pricing" className="hover:text-foreground">
            Pricing
          </a>
          <a href="#about" className="hover:text-foreground">
            About
          </a>
        </nav>
        <div className="flex items-center gap-3">
          <button className="hidden text-sm font-medium text-muted-foreground hover:text-foreground sm:inline">
            Log in
          </button>
          <button className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
            Get started
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main>
        <section className="relative px-6 pt-20 pb-24 lg:px-8 lg:pt-28 lg:pb-32">
          <div className="mx-auto max-w-4xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/40 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              New: AI-powered workflows are here
            </span>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              Build better products,{" "}
              <span className="text-primary">ship faster</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
              Lumina brings your design, engineering, and growth teams together
              on one streamlined platform. From idea to launch, without the
              friction.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <button className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:w-auto">
                Start building free
                <ArrowRight className="h-4 w-4" />
              </button>
              <button className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-border bg-background px-6 py-3 text-base font-medium text-foreground transition-colors hover:bg-secondary sm:w-auto">
                Book a demo
              </button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              No credit card required. Free plan available forever.
            </p>
          </div>

          <div className="mx-auto mt-16 max-w-5xl overflow-hidden rounded-2xl border border-border bg-card shadow-xl shadow-foreground/5">
            <img
              src="/images/hero-dashboard.png"
              alt="Lumina dashboard preview showing project overview, task list, and team activity"
              width={1344}
              height={756}
              className="w-full"
            />
          </div>
        </section>

        <section id="features" className="px-6 py-24 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                Everything you need to move fast
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                A complete toolkit designed to help small teams do big things.
              </p>
            </div>
            <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feature) => (
                <div
                  key={feature.title}
                  className="group rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/20"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                    <feature.icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-card-foreground">
                    {feature.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-secondary px-6 py-24 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <div>
                <h2 className="text-3xl font-semibold tracking-tight text-secondary-foreground sm:text-4xl">
                  Ready to ship your next idea?
                </h2>
                <p className="mt-4 text-lg text-muted-foreground">
                  Join thousands of teams using Lumina to turn ideas into live
                  products. Start free and upgrade when you need more.
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <button className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                    Get started for free
                    <ArrowRight className="h-4 w-4" />
                  </button>
                  <button className="inline-flex items-center justify-center rounded-full border border-border bg-background px-6 py-3 text-base font-medium text-foreground transition-colors hover:bg-secondary">
                    Talk to sales
                  </button>
                </div>
              </div>
              <div className="rounded-2xl border border-border bg-background p-8 shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Trusted by teams at
                    </p>
                    <p className="text-lg font-semibold text-foreground">
                      2,000+ companies
                    </p>
                  </div>
                </div>
                <div className="mt-6 grid grid-cols-3 gap-4 text-center text-sm text-muted-foreground">
                  <div className="rounded-xl bg-secondary p-4">
                    <p className="text-2xl font-semibold text-foreground">
                      99.9%
                    </p>
                    <p>Uptime</p>
                  </div>
                  <div className="rounded-xl bg-secondary p-4">
                    <p className="text-2xl font-semibold text-foreground">
                      10M+
                    </p>
                    <p>Projects</p>
                  </div>
                  <div className="rounded-xl bg-secondary p-4">
                    <p className="text-2xl font-semibold text-foreground">
                      4.9
                    </p>
                    <p>Rating</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-6 py-12 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="flex items-center gap-2 text-foreground">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <span className="text-sm font-semibold">Lumina</span>
          </div>
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Lumina. All rights reserved.
          </p>
          <div className="flex gap-6 text-sm text-muted-foreground">
            <a href="#" className="hover:text-foreground">
              Privacy
            </a>
            <a href="#" className="hover:text-foreground">
              Terms
            </a>
            <a href="#" className="hover:text-foreground">
              Contact
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
