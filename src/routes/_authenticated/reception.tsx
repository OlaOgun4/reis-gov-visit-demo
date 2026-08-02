import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  LayoutDashboard,
  LogOut,
  MoreHorizontal,
  Plus,
  ScanLine,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import nigeriaCoatOfArms from "@/assets/nigeria-coat-of-arms.svg";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useSession } from "@/hooks/use-session";
import { DocumentScanner } from "@/components/scanner/document-scanner";
import { IdScanner, type IdScanResult } from "@/components/scanner/id-scanner";
import { QrCode } from "@/components/scanner/qr-code";
import type { ParsedIdentity } from "@/lib/mrz";
import { registrationErrorMessage, registrationStageError } from "@/lib/registration";
import {
  ACCESS_ZONES,
  APPROVALS,
  DOCUMENT_TYPES,
  DURATIONS,
  PURPOSES,
  VISIT_SELECT,
  type Booking,
  type Department,
  type FacilityConfig,
  type Host,
  type Visit,
  formatDuration,
  formatTime,
  fullName,
  initials,
  isOverdue,
  logAudit,
  minutesSince,
  roleLabel,
  canUseMobileApp,
} from "@/lib/govvisit";

export const Route = createFileRoute("/_authenticated/reception")({
  head: () => ({
    meta: [
      { title: "Reception desk — GovVisit" },
      {
        name: "description",
        content:
          "Register arrivals, check in pre-booked visitors, check out passes and review live occupancy from the GovVisit reception desk.",
      },
      { property: "og:title", content: "Reception desk — GovVisit" },
      {
        property: "og:description",
        content: "Mobile reception workflow for visitor registration and checkout.",
      },
    ],
  }),
  component: Reception,
});

type Screen =
  | "home"
  | "arrival"
  | "expected"
  | "booking"
  | "scan"
  | "details"
  | "visit"
  | "confirm"
  | "success"
  | "checkout"
  | "checkoutMatch"
  | "inside"
  | "more";

interface Draft {
  firstName: string;
  lastName: string;
  phone: string;
  organisation: string;
  documentType: string;
  documentNumber: string;
  departmentId: string;
  hostId: string;
  purpose: string;
  approval: string;
  expectedMinutes: number;
  accessZone: string;
  notes: string;
}

const emptyDraft: Draft = {
  firstName: "",
  lastName: "",
  phone: "",
  organisation: "",
  documentType: DOCUMENT_TYPES[0],
  documentNumber: "",
  departmentId: "",
  hostId: "",
  purpose: PURPOSES[0],
  approval: APPROVALS[0],
  expectedMinutes: 60,
  accessZone: ACCESS_ZONES[0],
  notes: "",
};

const selectClass =
  "mt-1.5 h-11 w-full rounded-lg border border-input bg-card px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function Reception() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  const [screen, setScreen] = useState<Screen>("home");
  const [scanMode, setScanMode] = useState<"photo" | "live">("photo");
  const [journey, setJourney] = useState<"walk_in" | "pre_booked">("walk_in");
  const [booking, setBooking] = useState<Booking | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [search, setSearch] = useState("");
  const [insideSearch, setInsideSearch] = useState("");
  const [checkoutVisit, setCheckoutVisit] = useState<Visit | null>(null);
  const [checkoutMode, setCheckoutMode] = useState<"id" | "code">("id");
  const [badgeReturned, setBadgeReturned] = useState(true);
  const [privacyAck, setPrivacyAck] = useState(true);
  const [lastVisit, setLastVisit] = useState<Visit | null>(null);
  const [saving, setSaving] = useState(false);
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // Department Receptionists are web-only; they never use the mobile reception app.
  useEffect(() => {
    if (session && !canUseMobileApp(session)) {
      toast.error("Department Receptionists use the web administration, not the mobile app.");
      navigate({ to: "/dashboard", replace: true });
    }
  }, [session, navigate]);

  const config = useQuery({
    queryKey: ["config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("facility_config")
        .select("*")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as FacilityConfig | null;
    },
  });

  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("departments")
        .select("*")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data as Department[];
    },
  });

  const hosts = useQuery({
    queryKey: ["hosts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hosts")
        .select("*, departments(name, code)")
        .eq("active", true)
        .order("full_name");
      if (error) throw error;
      return data as Host[];
    },
  });

  const bookings = useQuery({
    queryKey: ["bookings", "expected"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("*, departments(name, code), hosts(full_name)")
        .eq("status", "expected")
        .order("expected_at");
      if (error) throw error;
      return data as Booking[];
    },
  });

  const insideVisits = useQuery({
    queryKey: ["visits", "inside"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("visits")
        .select(VISIT_SELECT)
        .eq("status", "inside")
        .order("checked_in_at", { ascending: false });
      if (error) throw error;
      return data as Visit[];
    },
  });

  const grace = config.data?.overdue_grace_minutes ?? 15;
  const inside = insideVisits.data ?? [];
  const overdueCount = inside.filter((v) => isOverdue(v, grace)).length;
  const hostsForDepartment = useMemo(
    () =>
      (hosts.data ?? []).filter(
        (h) => !draft.departmentId || h.department_id === draft.departmentId,
      ),
    [hosts.data, draft.departmentId],
  );

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["visits"] });
    queryClient.invalidateQueries({ queryKey: ["bookings"] });
    queryClient.invalidateQueries({ queryKey: ["audit"] });
  }

  function startWalkIn() {
    setJourney("walk_in");
    setBooking(null);
    setDraft({
      ...emptyDraft,
      departmentId: departments.data?.[0]?.id ?? "",
      approval: config.data?.approval_workflow ?? APPROVALS[0],
    });
    setScreen("scan");
  }

  function selectBooking(b: Booking) {
    setJourney("pre_booked");
    setBooking(b);
    const [first, ...rest] = b.visitor_name.split(" ");
    setDraft({
      ...emptyDraft,
      firstName: first ?? "",
      lastName: rest.join(" "),
      organisation: b.organisation ?? "",
      phone: b.phone ?? "",
      departmentId: b.department_id ?? departments.data?.[0]?.id ?? "",
      hostId: b.host_id ?? "",
      purpose: b.purpose,
      approval: "Reception confirmation",
    });
    setScreen("booking");
  }

  /** Real on-device capture: OCR/MRZ/PDF417 results populate the visitor draft. */
  function applyIdentity(identity: ParsedIdentity) {
    setDraft((d) => ({
      ...d,
      firstName: identity.firstName || d.firstName,
      lastName: identity.lastName || d.lastName,
      documentNumber: identity.documentNumber || d.documentNumber,
      documentType: identity.documentType
        ? (DOCUMENT_TYPES.find((t) =>
            t.toLowerCase().includes(identity.documentType!.toLowerCase()),
          ) ?? d.documentType)
        : d.documentType,
    }));
    toast.success(
      `Identity captured from ${identity.source.toUpperCase()} · ${Math.round(identity.confidence * 100)}% confidence`,
    );
    setScreen("details");
  }

  /** OCR review accepted: only the four scanned fields are overwritten. */
  function applyScanResult(scan: IdScanResult) {
    setDraft((d) => ({
      ...d,
      firstName: scan.firstName || d.firstName,
      lastName: scan.lastName || d.lastName,
      documentNumber: scan.documentNumber || d.documentNumber,
      documentType: scan.formDocumentType ?? d.documentType,
    }));
    toast.success(
      scan.demo
        ? "Demonstration record loaded — not extracted from the document"
        : `Details captured from ${scan.detectedDocumentType} · ${Math.round(scan.confidence * 100)}% confidence`,
    );
    setScreen("details");
  }

  /** Pass code or document barcode read at the checkout desk. */
  function matchCheckoutCode(text: string) {
    const code = text.trim().toUpperCase();
    const match = inside.find(
      (v) =>
        v.pass_code.toUpperCase() === code ||
        (v.visitors?.document_number ?? "").toUpperCase() === code ||
        (v.visitors?.reference ?? "").toUpperCase() === code,
    );
    if (!match) {
      toast.error(`No active visit matches ${code}`);
      return;
    }
    setCheckoutVisit(match);
    setBadgeReturned(true);
    setScreen("checkoutMatch");
  }

  /** Identity document re-scanned at checkout: match first name, last name or document number. */
  function matchCheckoutIdentity(scan: IdScanResult) {
    const first = scan.firstName.trim().toLowerCase();
    const last = scan.lastName.trim().toLowerCase();
    const doc = scan.documentNumber.trim().toUpperCase();

    const byDocument = doc
      ? inside.filter((v) => (v.visitors?.document_number ?? "").toUpperCase() === doc)
      : [];
    const byName = inside.filter((v) => {
      const f = (v.visitors?.first_name ?? "").trim().toLowerCase();
      const l = (v.visitors?.last_name ?? "").trim().toLowerCase();
      return (first && (f === first || l === first)) || (last && (l === last || f === last));
    });
    const matches = byDocument.length ? byDocument : byName;

    if (matches.length === 0) {
      toast.error("No active visit matches the scanned identity document.");
      setScreen("inside");
      return;
    }
    if (matches.length > 1) {
      toast.warning(`${matches.length} active visits matched — select the correct visitor.`);
      setInsideSearch(last || first);
      setScreen("inside");
      return;
    }
    setCheckoutVisit(matches[0]);
    setBadgeReturned(true);
    toast.success(
      byDocument.length ? "Matched on document number" : "Matched on the visitor's name",
    );
    setScreen("checkoutMatch");
  }

  async function completeRegistration() {
    if (saving) return;
    if (!draft.firstName || !draft.lastName || !draft.documentNumber) {
      toast.error("Visitor name and document number are required");
      return;
    }
    setSaving(true);
    try {
      const { data: existing, error: lookupError } = await supabase
        .from("visitors")
        .select("*")
        .eq("document_number", draft.documentNumber)
        .maybeSingle();
      if (lookupError) throw registrationStageError("Finding visitor", lookupError);

      let visitorId = existing?.id as string | undefined;
      if (visitorId) {
        const { error: updateError } = await supabase
          .from("visitors")
          .update({
            first_name: draft.firstName,
            last_name: draft.lastName,
            phone: draft.phone || null,
            organisation: draft.organisation || null,
            document_type: draft.documentType,
          })
          .eq("id", visitorId);
        if (updateError) throw registrationStageError("Updating visitor", updateError);
      } else {
        const { data: created, error } = await supabase
          .from("visitors")
          .insert({
            first_name: draft.firstName,
            last_name: draft.lastName,
            phone: draft.phone || null,
            organisation: draft.organisation || null,
            document_type: draft.documentType,
            document_number: draft.documentNumber,
          })
          .select("*")
          .single();
        if (error) throw registrationStageError("Creating visitor", error);
        visitorId = created.id;
      }

      const { data: activeVisit, error: activeVisitError } = await supabase
        .from("visits")
        .select(VISIT_SELECT)
        .eq("visitor_id", visitorId!)
        .eq("status", "inside")
        .order("checked_in_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (activeVisitError) {
        throw registrationStageError("Checking for an active visit", activeVisitError);
      }

      if (activeVisit) {
        setLastVisit(activeVisit as Visit);
        refresh();
        setScreen("success");
        toast.info("This visitor is already checked in. Their active pass has been restored.");
        return;
      }

      const { data: visit, error: visitError } = await supabase
        .from("visits")
        .insert({
          visitor_id: visitorId!,
          booking_id: booking?.id ?? null,
          visit_type: journey,
          department_id: draft.departmentId || null,
          host_id: draft.hostId || null,
          purpose: draft.purpose,
          approval: draft.approval,
          expected_minutes: draft.expectedMinutes,
          access_zone: draft.accessZone,
          notes: draft.notes || null,
        })
        .select(VISIT_SELECT)
        .single();
      if (visitError) throw registrationStageError("Creating visit", visitError);

      if (booking) {
        const { error: bookingError } = await supabase
          .from("bookings")
          .update({ status: "arrived" })
          .eq("id", booking.id);
        if (bookingError) {
          toast.warning(
            `Check-in succeeded, but the booking status could not be updated: ${registrationErrorMessage(bookingError)}`,
          );
        }
      }
      await logAudit("Visitor check-in", (visit as Visit).pass_code);
      setLastVisit(visit as Visit);
      refresh();
      setScreen("success");
    } catch (err) {
      toast.error(registrationErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function confirmCheckout() {
    if (!checkoutVisit || saving) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("visits")
        .update({
          status: "checked_out",
          checked_out_at: new Date().toISOString(),
          badge_returned: badgeReturned,
        })
        .eq("id", checkoutVisit.id);
      if (error) throw error;
      await logAudit("Visitor checkout", checkoutVisit.pass_code);
      refresh();
      toast.success(`${fullName(checkoutVisit.visitors)} checked out`);
      setCheckoutVisit(null);
      setScreen("home");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const filteredBookings = (bookings.data ?? []).filter((b) =>
    `${b.visitor_name} ${b.reference} ${b.hosts?.full_name ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const filteredInside = inside.filter((v) =>
    `${fullName(v.visitors)} ${v.hosts?.full_name ?? ""} ${v.departments?.name ?? ""}`
      .toLowerCase()
      .includes(insideSearch.toLowerCase()),
  );

  const showBack = screen !== "home";

  return (
    <div className="mx-auto min-h-screen max-w-[430px] bg-background shadow-pop">
      <header className="sticky top-0 z-20 rounded-b-3xl bg-crest-gradient px-5 pb-5 pt-4 text-primary-foreground">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {showBack ? (
              <button
                onClick={() => setScreen("home")}
                aria-label="Back to home"
                className="grid size-10 place-items-center rounded-xl bg-primary-foreground/15"
              >
                <ArrowLeft className="size-5" />
              </button>
            ) : (
              <div className="grid size-10 place-items-center overflow-hidden rounded-xl bg-white p-0.5">
                <img
                  src={nigeriaCoatOfArms}
                  alt="Coat of Arms of the Federal Republic of Nigeria"
                  className="h-full w-full object-contain"
                />
              </div>
            )}
            <div>
              <p className="font-display text-lg leading-none">GovVisit Reception</p>
              <p className="text-[11px] opacity-80">
                {config.data?.organisation_name ?? "Federal Public Services Administration"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {session?.isAdmin && (
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="text-primary-foreground hover:bg-primary-foreground/15"
              >
                <Link to="/dashboard" aria-label="Administrator dashboard">
                  <LayoutDashboard />
                </Link>
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Sign out"
              onClick={signOut}
              className="text-primary-foreground hover:bg-primary-foreground/15"
            >
              <LogOut />
            </Button>
          </div>
        </div>
      </header>

      <main className="px-4 pb-28 pt-4">
        {screen === "home" && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-hero-gradient p-5 text-primary-foreground shadow-hero">
              <p className="text-xs opacity-80">
                {clock.toLocaleString([], { weekday: "long", hour: "2-digit", minute: "2-digit" })}
              </p>
              <h1 className="mt-2 text-xl font-bold">
                {greeting(clock)}, {session?.fullName ?? "officer"}
              </h1>
              <p className="text-xs opacity-90">
                {roleLabel(session?.role)}
                {session?.departmentName ? ` · ${session.departmentName}` : ""}
              </p>
              <p className="text-xs opacity-90">
                {config.data?.facility_name ?? "Abuja Headquarters"} · Main Reception
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Stat value={inside.length} label="Currently inside" />
              <Stat value={bookings.data?.length ?? 0} label="Expected today" />
            </div>
            <SectionTitle>Reception actions</SectionTitle>
            <div className="grid gap-3">
              <ActionTile
                icon={<Plus className="size-5" />}
                title="Register arrival"
                subtitle="Pre-booked or walk-in visitor"
                onClick={() => setScreen("arrival")}
              />
              <ActionTile
                icon={<CalendarClock className="size-5" />}
                title="Expected visitors"
                subtitle="Find and check in pre-booked visits"
                onClick={() => setScreen("expected")}
              />
              <ActionTile
                icon={<ScanLine className="size-5" />}
                title="Check out visitor"
                subtitle="Scan the same ID or visitor pass"
                onClick={() => setScreen("checkout")}
              />
              <ActionTile
                icon={<ScanLine className="size-5" />}
                title="Self-service kiosk"
                subtitle="Hand the device to the visitor to check themselves in"
                onClick={() => navigate({ to: "/kiosk" })}
              />
              <ActionTile
                icon={<Users className="size-5" />}
                title="Visitors inside"
                subtitle="View current occupancy"
                onClick={() => setScreen("inside")}
              />
            </div>
            <SectionTitle>Attention</SectionTitle>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
              <Badge variant={overdueCount ? "warning" : "success"}>
                {overdueCount ? `${overdueCount} overdue` : "No overdue visitors"}
              </Badge>
              <p className="mt-2 text-xs text-muted-foreground">
                {overdueCount
                  ? "These visitors have exceeded their expected duration."
                  : "All visitors onsite are within their expected duration."}
              </p>
            </div>
          </div>
        )}

        {screen === "arrival" && (
          <div className="space-y-4">
            <h1 className="text-xl font-bold">How is the visitor arriving?</h1>
            <p className="text-xs text-muted-foreground">Choose the correct visitor journey.</p>
            <ActionTile
              icon={<CalendarClock className="size-5" />}
              title="Pre-booked visitor"
              subtitle="Visitor has an appointment or invitation"
              onClick={() => setScreen("expected")}
            />
            <ActionTile
              icon={<Plus className="size-5" />}
              title="Walk-in visitor"
              subtitle="Visitor has no prior booking"
              onClick={startWalkIn}
            />
          </div>
        )}

        {screen === "expected" && (
          <div className="space-y-3">
            <h1 className="text-xl font-bold">Expected visitors</h1>
            <Input
              placeholder="Search name, reference or host"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {filteredBookings.length === 0 && (
              <p className="rounded-2xl border border-border bg-card p-4 text-xs text-muted-foreground">
                No pre-booked visits are waiting. Administrators create invitations from the
                dashboard.
              </p>
            )}
            <div className="grid gap-2.5">
              {filteredBookings.map((b) => (
                <button
                  key={b.id}
                  onClick={() => selectBooking(b)}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 text-left shadow-card hover:border-primary/40"
                >
                  <div>
                    <p className="text-sm font-bold">{b.visitor_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatTime(b.expected_at)} · {b.departments?.code ?? "—"} ·{" "}
                      {b.hosts?.full_name ?? "Unassigned"}
                    </p>
                  </div>
                  <Badge variant="success">Expected</Badge>
                </button>
              ))}
            </div>
          </div>
        )}

        {screen === "booking" && booking && (
          <div className="space-y-3">
            <h1 className="text-xl font-bold">Pre-booked visit found</h1>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
              <Badge variant="success">Pre-booked</Badge>
              <p className="mt-3 text-base font-bold">{booking.visitor_name}</p>
              <Field label="Reference" value={booking.reference} />
              <Field label="Expected" value={formatTime(booking.expected_at)} />
              <Field label="Department" value={booking.departments?.name ?? "—"} />
              <Field label="Host" value={booking.hosts?.full_name ?? "—"} />
            </div>
            <p className="text-xs text-muted-foreground">
              Confirm the visitor's identity before check-in.
            </p>
            <Button size="block" onClick={() => setScreen("scan")}>
              Scan visitor ID
            </Button>
            <Button size="block" variant="secondary" onClick={() => setScreen("details")}>
              Enter ID manually
            </Button>
          </div>
        )}

        {screen === "scan" && (
          <div className="space-y-3">
            <Stepper step={1} />
            <h1 className="text-xl font-bold">Scan identity document</h1>
            <p className="text-xs text-muted-foreground">
              Photograph or upload the passport, licence, NIN or voter card. Reading happens on this
              device — no images leave the reception desk.
            </p>
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-muted p-1">
              <button
                type="button"
                onClick={() => setScanMode("photo")}
                className={`h-9 rounded-xl text-xs font-bold ${scanMode === "photo" ? "bg-card shadow-card" : "text-muted-foreground"}`}
              >
                Photo scan (OCR)
              </button>
              <button
                type="button"
                onClick={() => setScanMode("live")}
                className={`h-9 rounded-xl text-xs font-bold ${scanMode === "live" ? "bg-card shadow-card" : "text-muted-foreground"}`}
              >
                Live camera / QR
              </button>
            </div>
            {scanMode === "photo" ? (
              <IdScanner onAccept={applyScanResult} onCancel={() => setScreen("details")} />
            ) : (
              <DocumentScanner
                mode="document"
                hint="Passport, driving licence, NIN card or staff ID"
                onIdentity={applyIdentity}
              />
            )}
            <Button size="block" variant="secondary" onClick={() => setScreen("details")}>
              Enter manually
            </Button>
          </div>
        )}

        {screen === "details" && (
          <div className="space-y-3">
            <Stepper step={2} />
            <h1 className="text-xl font-bold">Review visitor details</h1>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
              <Badge variant="gold">Captured from document</Badge>
              <p className="mt-2 text-xs text-muted-foreground">
                Confirm or correct the fields below.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>First name</Label>
                <Input
                  className="mt-1.5"
                  value={draft.firstName}
                  onChange={(e) => setDraft({ ...draft, firstName: e.target.value })}
                />
              </div>
              <div>
                <Label>Last name</Label>
                <Input
                  className="mt-1.5"
                  value={draft.lastName}
                  onChange={(e) => setDraft({ ...draft, lastName: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label>Mobile number</Label>
              <Input
                className="mt-1.5"
                value={draft.phone}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              />
            </div>
            <div>
              <Label>Organisation</Label>
              <Input
                className="mt-1.5"
                value={draft.organisation}
                onChange={(e) => setDraft({ ...draft, organisation: e.target.value })}
              />
            </div>
            <div>
              <Label>Document number</Label>
              <Input
                className="mt-1.5"
                value={draft.documentNumber}
                onChange={(e) => setDraft({ ...draft, documentNumber: e.target.value })}
              />
            </div>
            <Button
              size="block"
              onClick={() => setScreen(journey === "pre_booked" ? "confirm" : "visit")}
            >
              Continue
            </Button>
          </div>
        )}

        {screen === "visit" && (
          <div className="space-y-3">
            <Stepper step={3} />
            <h1 className="text-xl font-bold">Walk-in visit information</h1>
            <div>
              <Label>Department</Label>
              <select
                className={selectClass}
                value={draft.departmentId}
                onChange={(e) => setDraft({ ...draft, departmentId: e.target.value, hostId: "" })}
              >
                <option value="">Select department</option>
                {(departments.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Person to visit</Label>
              <select
                className={selectClass}
                value={draft.hostId}
                onChange={(e) => setDraft({ ...draft, hostId: e.target.value })}
              >
                <option value="">Select host</option>
                {hostsForDepartment.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.full_name} — {h.job_title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Purpose of visit</Label>
              <select
                className={selectClass}
                value={draft.purpose}
                onChange={(e) => setDraft({ ...draft, purpose: e.target.value })}
              >
                {PURPOSES.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Walk-in approval</Label>
              <select
                className={selectClass}
                value={draft.approval}
                onChange={(e) => setDraft({ ...draft, approval: e.target.value })}
              >
                {APPROVALS.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Expected duration</Label>
              <select
                className={selectClass}
                value={draft.expectedMinutes}
                onChange={(e) => setDraft({ ...draft, expectedMinutes: Number(e.target.value) })}
              >
                {DURATIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Access zone</Label>
              <select
                className={selectClass}
                value={draft.accessZone}
                onChange={(e) => setDraft({ ...draft, accessZone: e.target.value })}
              >
                {ACCESS_ZONES.map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                className="mt-1.5"
                rows={3}
                placeholder="Optional notes"
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </div>
            <Button size="block" onClick={() => setScreen("confirm")}>
              Review registration
            </Button>
          </div>
        )}

        {screen === "confirm" && (
          <div className="space-y-3">
            <Stepper step={4} />
            <h1 className="text-xl font-bold">Confirm registration</h1>
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-card">
              <div className="grid size-12 place-items-center rounded-full bg-accent font-bold text-accent-foreground">
                {initials(`${draft.firstName} ${draft.lastName}`) || "GV"}
              </div>
              <div>
                <p className="text-sm font-bold">
                  {draft.firstName} {draft.lastName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {journey === "pre_booked" ? "Pre-booked visitor" : "Walk-in visitor"}
                </p>
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
              <Field
                label="Department"
                value={
                  (departments.data ?? []).find((d) => d.id === draft.departmentId)?.name ?? "—"
                }
              />
              <Field
                label="Host"
                value={(hosts.data ?? []).find((h) => h.id === draft.hostId)?.full_name ?? "—"}
              />
              <Field label="Purpose" value={draft.purpose} />
              <Field label="Approval" value={draft.approval} />
              <Field label="Document" value={`${draft.documentType} · ${draft.documentNumber}`} />
            </div>
            <label className="flex items-start gap-2.5 rounded-2xl border border-border bg-card p-4 text-xs">
              <Checkbox
                checked={privacyAck}
                onCheckedChange={(v) => setPrivacyAck(Boolean(v))}
                className="mt-0.5"
              />
              <span>
                Visitor has acknowledged the privacy notice and premises security requirements.
              </span>
            </label>
            <Button size="block" disabled={!privacyAck || saving} onClick={completeRegistration}>
              {saving ? "Registering…" : "Register and check in"}
            </Button>
          </div>
        )}

        {screen === "success" && lastVisit && (
          <div className="space-y-3">
            <div className="py-6 text-center">
              <div className="mx-auto grid size-20 place-items-center rounded-full bg-accent text-primary">
                <CheckCircle2 className="size-10" />
              </div>
              <h1 className="mt-4 text-xl font-bold">Visitor checked in</h1>
              <p className="text-xs text-muted-foreground">
                Visitor pass {lastVisit.pass_code} has been created.
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
              <Field label="Visitor" value={fullName(lastVisit.visitors)} />
              <Field
                label="Journey"
                value={lastVisit.visit_type === "walk_in" ? "Walk-in" : "Pre-booked"}
              />
              <Field label="Host" value={lastVisit.hosts?.full_name ?? "—"} />
              <Field label="Check-in" value={formatTime(lastVisit.checked_in_at)} />
              <Field label="Access zone" value={lastVisit.access_zone} />
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 text-center shadow-card">
              <QrCode value={lastVisit.pass_code} />
              <p className="mt-2 text-[11px] font-semibold text-muted-foreground">
                {lastVisit.pass_code}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Scan this pass at the desk to check the visitor out.
              </p>
            </div>
            <Button
              size="block"
              onClick={async () => {
                await logAudit("Electronic pass issued", lastVisit.pass_code);
                queryClient.invalidateQueries({ queryKey: ["audit"] });
                toast.success("Electronic visitor pass sent");
              }}
            >
              Send electronic pass
            </Button>
            <Button
              size="block"
              variant="secondary"
              onClick={async () => {
                await logAudit("Pass printed (fallback)", lastVisit.pass_code);
                queryClient.invalidateQueries({ queryKey: ["audit"] });
                toast.success("Printed pass created as fallback");
              }}
            >
              Print pass (fallback)
            </Button>
            <Button size="block" variant="outline" onClick={() => setScreen("home")}>
              Done
            </Button>
          </div>
        )}

        {screen === "checkout" && (
          <div className="space-y-3">
            <h1 className="text-xl font-bold">Check out visitor</h1>
            <p className="text-xs text-muted-foreground">
              Scan the same identity document presented at check-in — the visitor is matched on
              first name, last name or document number. You can also scan the visitor pass or check
              out manually.
            </p>
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-muted p-1">
              <button
                type="button"
                onClick={() => setCheckoutMode("id")}
                className={`h-9 rounded-xl text-xs font-bold ${checkoutMode === "id" ? "bg-card shadow-card" : "text-muted-foreground"}`}
              >
                Scan identity document
              </button>
              <button
                type="button"
                onClick={() => setCheckoutMode("code")}
                className={`h-9 rounded-xl text-xs font-bold ${checkoutMode === "code" ? "bg-card shadow-card" : "text-muted-foreground"}`}
              >
                Pass QR / barcode
              </button>
            </div>
            {checkoutMode === "id" ? (
              <IdScanner onAccept={matchCheckoutIdentity} onCancel={() => setScreen("inside")} />
            ) : (
              <DocumentScanner
                mode="code"
                hint="Visitor pass QR code or ID barcode"
                onCode={matchCheckoutCode}
              />
            )}
            <Button size="block" variant="secondary" onClick={() => setScreen("inside")}>
              Manual checkout — select from visitors inside
            </Button>
          </div>
        )}

        {screen === "checkoutMatch" && checkoutVisit && (
          <div className="space-y-3">
            <h1 className="text-xl font-bold">Active visit found</h1>
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-card">
              <div className="grid size-12 place-items-center rounded-full bg-accent font-bold text-accent-foreground">
                {initials(fullName(checkoutVisit.visitors))}
              </div>
              <div>
                <p className="text-sm font-bold">{fullName(checkoutVisit.visitors)}</p>
                <p className="text-xs text-muted-foreground">
                  Checked in {formatDuration(minutesSince(checkoutVisit.checked_in_at))} ago
                </p>
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
              <Field label="Host" value={checkoutVisit.hosts?.full_name ?? "—"} />
              <Field label="Department" value={checkoutVisit.departments?.name ?? "—"} />
              <Field label="Pass" value={checkoutVisit.pass_code} />
            </div>
            <label className="flex items-center gap-2.5 rounded-2xl border border-border bg-card p-4 text-xs">
              <Checkbox
                checked={badgeReturned}
                onCheckedChange={(v) => setBadgeReturned(Boolean(v))}
              />
              <span>Badge returned</span>
            </label>
            <Button size="block" variant="destructive" disabled={saving} onClick={confirmCheckout}>
              {saving ? "Checking out…" : "Confirm checkout"}
            </Button>
          </div>
        )}

        {screen === "inside" && (
          <div className="space-y-3">
            <h1 className="text-xl font-bold">Visitors currently inside</h1>
            <Input
              placeholder="Search visitors, hosts or departments"
              value={insideSearch}
              onChange={(e) => setInsideSearch(e.target.value)}
            />
            {filteredInside.length === 0 && (
              <p className="rounded-2xl border border-border bg-card p-4 text-xs text-muted-foreground">
                Nobody is currently signed in to the building.
              </p>
            )}
            <div className="grid gap-2.5">
              {filteredInside.map((v) => (
                <button
                  key={v.id}
                  onClick={() => {
                    setCheckoutVisit(v);
                    setBadgeReturned(true);
                    setScreen("checkoutMatch");
                  }}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 text-left shadow-card hover:border-primary/40"
                >
                  <div>
                    <p className="text-sm font-bold">{fullName(v.visitors)}</p>
                    <p className="text-xs text-muted-foreground">
                      {v.departments?.code ?? "—"} · {v.hosts?.full_name ?? "—"} ·{" "}
                      {formatDuration(minutesSince(v.checked_in_at))}
                    </p>
                  </div>
                  <Badge variant={isOverdue(v, grace) ? "warning" : "success"}>
                    {isOverdue(v, grace) ? "Overdue" : "Inside"}
                  </Badge>
                </button>
              ))}
            </div>
          </div>
        )}

        {screen === "more" && (
          <div className="space-y-3">
            <h1 className="text-xl font-bold">More</h1>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
              <p className="text-sm font-bold">{session?.fullName}</p>
              <p className="text-xs text-muted-foreground">
                {session?.jobTitle} · {session?.isAdmin ? "Administrator" : "Receptionist"}
              </p>
            </div>
            <ActionTile
              icon={<CalendarClock className="size-5" />}
              title="Expected visitors"
              subtitle="Pre-registered appointments"
              onClick={() => setScreen("expected")}
            />
            <ActionTile
              icon={<Users className="size-5" />}
              title="Emergency evacuation list"
              subtitle={`${inside.length} visitors to account for`}
              onClick={() => {
                const rows = inside
                  .map(
                    (v) =>
                      `${fullName(v.visitors)} — ${v.departments?.name ?? "—"} — ${v.hosts?.full_name ?? "—"}`,
                  )
                  .join("\n");
                toast.success(rows ? "Evacuation list generated" : "No visitors onsite", {
                  description: rows || undefined,
                });
                void logAudit("Evacuation list generated", "EVAC");
              }}
            />
            {session?.isAdmin && (
              <ActionTile
                icon={<LayoutDashboard className="size-5" />}
                title="Administrator dashboard"
                subtitle="Records, reports and configuration"
                onClick={() => navigate({ to: "/dashboard" })}
              />
            )}
          </div>
        )}
      </main>

      <nav className="fixed bottom-0 left-1/2 z-30 grid w-full max-w-[430px] -translate-x-1/2 grid-cols-5 border-t border-border bg-card px-1 py-2">
        <NavButton
          active={screen === "home"}
          label="Home"
          icon={<Users className="size-5" />}
          onClick={() => setScreen("home")}
        />
        <NavButton
          active={["arrival", "scan", "details", "visit", "confirm", "success"].includes(screen)}
          label="Arrival"
          icon={<Plus className="size-5" />}
          onClick={() => setScreen("arrival")}
        />
        <NavButton
          active={screen === "checkout" || screen === "checkoutMatch"}
          label="Check out"
          icon={<ScanLine className="size-5" />}
          onClick={() => setScreen("checkout")}
        />
        <NavButton
          active={screen === "inside"}
          label="Inside"
          icon={<CheckCircle2 className="size-5" />}
          onClick={() => setScreen("inside")}
        />
        <NavButton
          active={screen === "more"}
          label="More"
          icon={<MoreHorizontal className="size-5" />}
          onClick={() => setScreen("more")}
        />
      </nav>
    </div>
  );
}

function greeting(d: Date) {
  const h = d.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
      <p className="text-2xl font-bold">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="pt-2 text-sm font-bold">{children}</h2>;
}

function ActionTile({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <Button variant="tile" size="tile" onClick={onClick}>
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold">{title}</span>
        <span className="block truncate text-xs font-medium text-muted-foreground">{subtitle}</span>
      </span>
    </Button>
  );
}

function NavButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 rounded-lg py-1 text-[10px] font-semibold ${
        active ? "text-primary" : "text-muted-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <p className="mt-1.5 text-xs">
      <span className="font-bold">{label}:</span>{" "}
      <span className="text-muted-foreground">{value}</span>
    </p>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <div className="flex gap-1.5">
      {[1, 2, 3, 4].map((n) => (
        <div
          key={n}
          className={`h-1.5 flex-1 rounded-full ${n <= step ? "bg-primary" : "bg-border"}`}
        />
      ))}
    </div>
  );
}
