import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, LogIn, LogOut, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DocumentScanner } from "@/components/scanner/document-scanner";
import { QrCode } from "@/components/scanner/qr-code";
import type { ParsedIdentity } from "@/lib/mrz";
import {
  ACCESS_ZONES,
  PURPOSES,
  VISIT_SELECT,
  formatTime,
  fullName,
  logAudit,
  type Department,
  type Host,
  type Visit,
} from "@/lib/govvisit";

export const Route = createFileRoute("/_authenticated/kiosk")({
  head: () => ({
    meta: [
      { title: "Self-service kiosk — GovVisit" },
      {
        name: "description",
        content:
          "Unattended visitor kiosk: visitors scan their own identity document to check in, receive a QR visitor pass, and scan the pass again to check out.",
      },
      { property: "og:title", content: "Self-service kiosk — GovVisit" },
      {
        property: "og:description",
        content:
          "Touch-screen visitor self check-in and checkout with on-device document scanning.",
      },
    ],
  }),
  component: Kiosk,
});

type Step = "welcome" | "scan" | "confirm" | "pass" | "out" | "outDone";

function Kiosk() {
  const [step, setStep] = useState<Step>("welcome");
  const [busy, setBusy] = useState(false);
  const [identity, setIdentity] = useState<ParsedIdentity | null>(null);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    documentNumber: "",
    organisation: "",
    phone: "",
    departmentId: "",
    hostId: "",
    purpose: PURPOSES[0],
  });
  const [pass, setPass] = useState<Visit | null>(null);
  const [checkedOut, setCheckedOut] = useState<Visit | null>(null);

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
        .select("*")
        .eq("active", true)
        .order("full_name");
      if (error) throw error;
      return data as Host[];
    },
  });

  const hostOptions = (hosts.data ?? []).filter(
    (h) => !form.departmentId || h.department_id === form.departmentId,
  );

  function reset() {
    setIdentity(null);
    setPass(null);
    setCheckedOut(null);
    setForm({
      firstName: "",
      lastName: "",
      documentNumber: "",
      organisation: "",
      phone: "",
      departmentId: "",
      hostId: "",
      purpose: PURPOSES[0],
    });
    setStep("welcome");
  }

  function onIdentity(parsed: ParsedIdentity) {
    setIdentity(parsed);
    setForm((f) => ({
      ...f,
      firstName: parsed.firstName || f.firstName,
      lastName: parsed.lastName || f.lastName,
      documentNumber: parsed.documentNumber || f.documentNumber,
    }));
    setStep("confirm");
  }

  async function checkIn() {
    if (busy) return;
    if (!form.firstName || !form.lastName || !form.documentNumber) {
      toast.error("Please complete your name and document number");
      return;
    }
    if (!form.departmentId || !form.hostId) {
      toast.error("Please choose the department and person you are visiting");
      return;
    }
    setBusy(true);
    try {
      const { data: existing } = await supabase
        .from("visitors")
        .select("id")
        .eq("document_number", form.documentNumber)
        .maybeSingle();

      let visitorId = existing?.id as string | undefined;
      if (!visitorId) {
        const { data: created, error } = await supabase
          .from("visitors")
          .insert({
            first_name: form.firstName,
            last_name: form.lastName,
            phone: form.phone || null,
            organisation: form.organisation || null,
            document_type: identity?.documentType ?? "National ID (NIN)",
            document_number: form.documentNumber,
          })
          .select("id")
          .single();
        if (error) throw error;
        visitorId = created.id;
      }

      const { data: visit, error: visitError } = await supabase
        .from("visits")
        .insert({
          visitor_id: visitorId!,
          visit_type: "walk_in",
          department_id: form.departmentId,
          host_id: form.hostId,
          purpose: form.purpose,
          approval: "Self-service kiosk",
          access_zone: ACCESS_ZONES[0],
          notes: `Kiosk self check-in · document read via ${identity?.source ?? "manual entry"}`,
        })
        .select(VISIT_SELECT)
        .single();
      if (visitError) throw visitError;

      await logAudit("Kiosk self check-in", (visit as Visit).pass_code);
      setPass(visit as Visit);
      setStep("pass");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Check-in could not be completed");
    } finally {
      setBusy(false);
    }
  }

  async function checkOutByCode(text: string) {
    if (busy) return;
    const code = text.trim().toUpperCase();
    setBusy(true);
    try {
      const { data: matches, error } = await supabase
        .from("visits")
        .select(VISIT_SELECT)
        .eq("status", "inside");
      if (error) throw error;
      const visit = (matches as Visit[]).find(
        (v) =>
          v.pass_code.toUpperCase() === code ||
          (v.visitors?.document_number ?? "").toUpperCase() === code,
      );
      if (!visit) {
        toast.error("No active visit found for that pass");
        return;
      }
      const { error: upErr } = await supabase
        .from("visits")
        .update({
          status: "checked_out",
          checked_out_at: new Date().toISOString(),
          badge_returned: true,
        })
        .eq("id", visit.id);
      if (upErr) throw upErr;
      await logAudit("Kiosk self checkout", visit.pass_code);
      setCheckedOut(visit);
      setStep("outDone");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Checkout could not be completed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-12 place-items-center rounded-xl bg-primary font-display text-xl text-primary-foreground">
              FG
            </div>
            <div>
              <p className="font-display text-2xl leading-none">Visitor self-service</p>
              <p className="text-xs text-muted-foreground">Touch the screen to begin</p>
            </div>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/reception">
              <ArrowLeft /> Reception
            </Link>
          </Button>
        </header>

        {step === "welcome" && (
          <div className="space-y-4">
            <div className="rounded-3xl bg-hero-gradient p-8 text-primary-foreground shadow-hero">
              <h1 className="font-display text-3xl leading-tight">Welcome</h1>
              <p className="mt-2 text-sm opacity-90">
                Check yourself in by scanning your passport, driving licence or national ID card.
                Your document is read on this device only.
              </p>
            </div>
            <Button size="block" className="h-16 text-base" onClick={() => setStep("scan")}>
              <LogIn /> Check in
            </Button>
            <Button
              size="block"
              variant="secondary"
              className="h-16 text-base"
              onClick={() => setStep("out")}
            >
              <LogOut /> Check out
            </Button>
          </div>
        )}

        {step === "scan" && (
          <div className="space-y-4">
            <h1 className="text-xl font-bold">Scan your identity document</h1>
            <DocumentScanner
              mode="document"
              hint="Passport, driving licence or national ID card"
              onIdentity={onIdentity}
            />
            <Button size="block" variant="secondary" onClick={() => setStep("confirm")}>
              Enter my details instead
            </Button>
          </div>
        )}

        {step === "confirm" && (
          <div className="space-y-4">
            <h1 className="text-xl font-bold">Confirm your details</h1>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="First name"
                value={form.firstName}
                onChange={(v) => setForm({ ...form, firstName: v })}
              />
              <Field
                label="Last name"
                value={form.lastName}
                onChange={(v) => setForm({ ...form, lastName: v })}
              />
              <Field
                label="Document number"
                value={form.documentNumber}
                onChange={(v) => setForm({ ...form, documentNumber: v })}
              />
              <Field
                label="Mobile number"
                value={form.phone}
                onChange={(v) => setForm({ ...form, phone: v })}
              />
              <Field
                label="Organisation"
                value={form.organisation}
                onChange={(v) => setForm({ ...form, organisation: v })}
              />
              <div>
                <Label>Department</Label>
                <select
                  className="mt-1.5 h-12 w-full rounded-lg border border-input bg-card px-3 text-sm"
                  value={form.departmentId}
                  onChange={(e) => setForm({ ...form, departmentId: e.target.value, hostId: "" })}
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
                <Label>Person you are visiting</Label>
                <select
                  className="mt-1.5 h-12 w-full rounded-lg border border-input bg-card px-3 text-sm"
                  value={form.hostId}
                  onChange={(e) => setForm({ ...form, hostId: e.target.value })}
                >
                  <option value="">Select host</option>
                  {hostOptions.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Purpose of visit</Label>
                <select
                  className="mt-1.5 h-12 w-full rounded-lg border border-input bg-card px-3 text-sm"
                  value={form.purpose}
                  onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                >
                  {PURPOSES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {identity && (
              <p className="text-xs text-muted-foreground">
                Read from your document via {identity.source.toUpperCase()} ·{" "}
                {Math.round(identity.confidence * 100)}% confidence
              </p>
            )}
            <Button size="block" className="h-14 text-base" disabled={busy} onClick={checkIn}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              {busy ? "Checking you in…" : "Confirm check-in"}
            </Button>
            <Button size="block" variant="ghost" onClick={reset}>
              Cancel
            </Button>
          </div>
        )}

        {step === "pass" && pass && (
          <div className="space-y-4 text-center">
            <div className="mx-auto grid size-20 place-items-center rounded-full bg-accent text-primary">
              <CheckCircle2 className="size-10" />
            </div>
            <h1 className="text-xl font-bold">You are checked in</h1>
            <div className="rounded-3xl border border-border bg-card p-6 shadow-card">
              <QrCode value={pass.pass_code} size={200} />
              <p className="mt-3 text-sm font-bold">{pass.pass_code}</p>
              <p className="text-xs text-muted-foreground">
                {fullName(pass.visitors)} · {pass.departments?.name ?? "—"} ·{" "}
                {formatTime(pass.checked_in_at)}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Keep this pass visible. Scan it here when you leave.
              </p>
            </div>
            <Button size="block" onClick={reset}>
              Done
            </Button>
          </div>
        )}

        {step === "out" && (
          <div className="space-y-4">
            <h1 className="text-xl font-bold">Scan your visitor pass</h1>
            <DocumentScanner
              mode="code"
              hint="Hold the QR code on your pass up to the camera"
              onCode={checkOutByCode}
            />
            <Button size="block" variant="ghost" onClick={reset}>
              Cancel
            </Button>
          </div>
        )}

        {step === "outDone" && checkedOut && (
          <div className="space-y-4 text-center">
            <div className="mx-auto grid size-20 place-items-center rounded-full bg-accent text-primary">
              <CheckCircle2 className="size-10" />
            </div>
            <h1 className="text-xl font-bold">Thank you, {fullName(checkedOut.visitors)}</h1>
            <p className="text-sm text-muted-foreground">
              Pass {checkedOut.pass_code} has been closed and your badge marked as returned.
            </p>
            <Button size="block" onClick={reset}>
              Finish
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input className="mt-1.5 h-12" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
