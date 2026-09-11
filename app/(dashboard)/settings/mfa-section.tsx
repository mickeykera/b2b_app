"use client";

import { useState } from "react";
import { Check, Loader2, ShieldCheck } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

import { Button, Input, Label } from "@/components/ui";

interface MfaSectionProps {
  enabled: boolean;
  email: string;
}

export function MfaSection({ enabled, email }: MfaSectionProps) {
  const [step, setStep] = useState<"idle" | "setup" | "verify" | "disable">(
    enabled ? "idle" : "idle",
  );
  const [secret, setSecret] = useState("");
  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [code, setCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function startSetup() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/mfa/enable", { method: "POST" });
      const body = (await response.json()) as { secret?: string; otpauthUrl?: string; error?: string };
      if (!response.ok || !body.secret) {
        setError(body.error ?? "Could not start setup.");
        return;
      }
      setSecret(body.secret ?? "");
      setOtpauthUrl(body.otpauthUrl ?? "");
      setStep("verify");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetup() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/mfa/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = (await response.json()) as {
        ok?: boolean;
        recoveryCodes?: string[];
        error?: string;
      };
      if (!response.ok || !body.ok) {
        setError(body.error ?? "Code not accepted.");
        return;
      }
      setRecoveryCodes(body.recoveryCodes ?? []);
      setStep("disable");
      setInfo("Two-factor is now enabled on this account.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/mfa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: disablePassword }),
      });
      const body = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok) {
        setError(body.error ?? "Could not disable MFA.");
        return;
      }
      setStep("idle");
      setDisablePassword("");
      setInfo(null);
      setRecoveryCodes(null);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "verify") {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-4">
          <div className="rounded-md border border-border bg-background p-3">
            <QRCodeSVG value={otpauthUrl} size={124} />
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              Scan with your authenticator app, or enter this key manually:
            </p>
            <code className="block select-all rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs break-all">
              {secret}
            </code>
            <p className="text-xs text-muted-foreground">
              Account: <span className="font-medium">{email}</span>
            </p>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mfaCode">6-digit code</Label>
          <Input
            id="mfaCode"
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        <Button className="w-full" onClick={confirmSetup} disabled={busy || code.length !== 6}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify & enable"}
        </Button>
      </div>
    );
  }

  if (recoveryCodes && recoveryCodes.length > 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
          <Check className="h-3.5 w-3.5" /> {info}
        </div>
        <div>
          <p className="mb-2 text-xs text-muted-foreground">
            Save these backup codes somewhere safe. Each can be used once to
            sign in if you lose your authenticator.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {recoveryCodes.map((codeValue) => (
              <code
                key={codeValue}
                className="select-all rounded-md border border-border bg-muted/40 px-2 py-1 text-center text-xs"
              >
                {codeValue}
              </code>
            ))}
          </div>
        </div>
        <Button variant="secondary" className="w-full" onClick={() => setRecoveryCodes(null)}>
          Got it
        </Button>
      </div>
    );
  }

  if (enabled || step === "disable") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-success" />
          Two-factor is enabled. Sign-in requires a TOTP code.
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="disablePassword">Password to confirm</Label>
          <Input
            id="disablePassword"
            type="password"
            autoComplete="current-password"
            value={disablePassword}
            onChange={(e) => setDisablePassword(e.target.value)}
          />
        </div>
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        <Button variant="destructive" className="w-full" onClick={disable} disabled={busy || !disablePassword}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Disable two-factor"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Two-factor is currently <span className="font-medium text-foreground">off</span>.
        Enabling requires a code from your authenticator app.
      </p>
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      <Button className="w-full" onClick={startSetup} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enable two-factor"}
      </Button>
    </div>
  );
}