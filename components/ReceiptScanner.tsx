"use client";

import { useRef, useState } from "react";
import { EXPENSE_CATEGORIES, ExpenseCategory } from "@/lib/categories";
import { logout } from "@/app/actions/auth";
import { setupMonthAction } from "@/app/actions/setup";

type Step = "capture" | "scanning" | "confirm" | "saving" | "done" | "error";
type Mode = "scan" | "manual";

interface ReceiptData {
  date: string;
  amount: number;
  description: string;
  category: ExpenseCategory;
}

export default function ReceiptScanner() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("capture");
  const [mode, setMode] = useState<Mode>("scan");
  const [preview, setPreview] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [amountCandidates, setAmountCandidates] = useState<number[]>([]);
  const [clientError, setClientError] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [setupStatus, setSetupStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [setupMsg, setSetupMsg] = useState("");

  function todayISO() {
    return new Date().toISOString().split("T")[0];
  }

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onerror = () => {
      setErrorMsg("Could not read that image file");
      setStep("error");
    };
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setPreview(dataUrl);
      scanReceipt(dataUrl);
    };
    reader.readAsDataURL(file);
  }

  async function scanReceipt(dataUrl: string) {
    setStep("scanning");
    setErrorMsg("");
    setClientError("");
    setAmountCandidates([]);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 429) {
          throw new Error(data.error ?? "Rate limit reached — try again later");
        }
        // Soft-fail into manual entry with whatever we know
        setMode("manual");
        setReceipt({
          date: todayISO(),
          amount: 0,
          description: "",
          category: "Personal",
        });
        setAmountCandidates([]);
        setErrorMsg(data.error ?? "Scan failed");
        setStep("error");
        return;
      }

      const candidates: number[] = Array.isArray(data.amountCandidates)
        ? data.amountCandidates
        : data.amount
          ? [data.amount]
          : [];

      setReceipt({
        date: data.date ?? todayISO(),
        amount: typeof data.amount === "number" ? data.amount : 0,
        description: data.description ?? "",
        category: (data.category as ExpenseCategory) ?? "Personal",
      });
      setAmountCandidates(candidates);
      setMode("scan");
      setStep("confirm");
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setMode("manual");
      setReceipt({
        date: todayISO(),
        amount: 0,
        description: "",
        category: "Personal",
      });
      setStep("error");
    }
  }

  function validateBeforeSave(data: ReceiptData): string | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) return "Enter a valid date";
    if (!(data.amount > 0) || data.amount > 99_999.99) {
      return "Amount must be between $0.01 and $99,999.99";
    }
    if (!data.description.trim()) return "Enter a store or description";
    if (!EXPENSE_CATEGORIES.includes(data.category)) return "Pick a valid category";
    return null;
  }

  async function saveReceipt() {
    if (!receipt) return;
    const validationError = validateBeforeSave(receipt);
    if (validationError) {
      setClientError(validationError);
      return;
    }
    setClientError("");
    setStep("saving");
    try {
      const res = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(receipt),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setStep("done");
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setStep("error");
    }
  }

  async function setupMonth() {
    const confirmed = window.confirm(
      "Create this month's budget sheet by copying last month? This will clear Transactions on the new copy."
    );
    if (!confirmed) return;

    setSetupStatus("loading");
    setSetupMsg("");
    try {
      const result = await setupMonthAction();
      if (!result.ok) throw new Error(result.error);
      setSetupMsg(
        result.status === "already_exists"
          ? `"${result.name}" already exists — you're all set!`
          : `Created "${result.name}" and shared it to your Drive.`
      );
      setSetupStatus("done");
    } catch (err: unknown) {
      setSetupMsg(err instanceof Error ? err.message : "Setup failed");
      setSetupStatus("error");
    }
  }

  function startManualEntry(partial?: Partial<ReceiptData>, candidates: number[] = []) {
    setMode("manual");
    setReceipt({
      date: partial?.date ?? todayISO(),
      amount: partial?.amount ?? 0,
      description: partial?.description ?? "",
      category: partial?.category ?? "Personal",
    });
    setAmountCandidates(candidates);
    setErrorMsg("");
    setClientError("");
    setStep("confirm");
  }

  function continueFromError() {
    startManualEntry(receipt ?? undefined, amountCandidates);
  }

  function reset() {
    setStep("capture");
    setMode("scan");
    setPreview(null);
    setReceipt(null);
    setAmountCandidates([]);
    setErrorMsg("");
    setClientError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  }

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center px-4 py-8 font-sans">
      <div className="w-full max-w-sm flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 mb-1">Receipt Scanner</h1>
          <p className="text-sm text-gray-500">Scan → Review → Save to Google Sheets</p>
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="text-xs text-gray-500 hover:text-gray-800 underline underline-offset-2"
          >
            Sign out
          </button>
        </form>
      </div>

      {/* CAPTURE */}
      {step === "capture" && (
        <div className="w-full max-w-sm flex flex-col gap-4">
          <div className="flex rounded-xl overflow-hidden border border-gray-200 shadow-sm" role="tablist">
            <button
              role="tab"
              aria-selected={mode === "scan"}
              onClick={() => setMode("scan")}
              className={`flex-1 py-3 text-sm font-semibold transition-colors ${
                mode === "scan"
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-500 hover:bg-gray-50"
              }`}
            >
              Scan Receipt
            </button>
            <button
              role="tab"
              aria-selected={mode === "manual"}
              onClick={() => startManualEntry()}
              className={`flex-1 py-3 text-sm font-semibold transition-colors ${
                mode === "manual"
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-500 hover:bg-gray-50"
              }`}
            >
              Enter Manually
            </button>
          </div>

          <button
            onClick={() => cameraInputRef.current?.click()}
            className="w-full py-5 rounded-2xl bg-blue-600 text-white text-lg font-semibold shadow-md active:scale-95 transition-transform"
          >
            Take Photo
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full py-4 rounded-2xl border border-gray-300 bg-white text-gray-700 text-base font-semibold active:scale-95 transition-transform"
          >
            Choose from Gallery
          </button>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleImageSelect}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageSelect}
          />
          <p className="text-center text-xs text-gray-400">
            Camera opens on supported phones · gallery works everywhere
          </p>

          <div className="border-t border-gray-200 pt-4 flex flex-col gap-2">
            <button
              onClick={setupMonth}
              disabled={setupStatus === "loading"}
              className="w-full py-3 rounded-xl border border-blue-300 text-blue-600 text-sm font-medium active:scale-95 transition-transform disabled:opacity-50"
            >
              {setupStatus === "loading" ? "Setting up…" : "Setup This Month's Sheet"}
            </button>
            {setupStatus === "done" && (
              <p className="text-center text-xs text-green-600" role="status">
                {setupMsg}
              </p>
            )}
            {setupStatus === "error" && (
              <p className="text-center text-xs text-red-500" role="alert">
                {setupMsg}
              </p>
            )}
          </div>
        </div>
      )}

      {/* SCANNING */}
      {step === "scanning" && (
        <div className="flex flex-col items-center gap-4 mt-8" aria-live="polite">
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Receipt preview" className="w-48 rounded-xl shadow object-cover" />
          )}
          <div className="flex items-center gap-2 text-blue-600 font-medium">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            Reading receipt…
          </div>
        </div>
      )}

      {/* CONFIRM / EDIT */}
      {step === "confirm" && receipt && (
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-md p-6 flex flex-col gap-5">
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Receipt preview" className="w-full max-h-40 object-cover rounded-xl" />
          )}
          <h2 className="text-lg font-semibold text-gray-700">
            {mode === "manual" ? "Manual Entry" : "Review & Confirm"}
          </h2>

          {amountCandidates.length === 0 && mode === "scan" && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              No total detected — enter the amount below.
            </p>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Date</span>
            <input
              type="date"
              value={receipt.date}
              onChange={(e) => setReceipt({ ...receipt, date: e.target.value })}
              className="border border-gray-300 rounded-lg px-3 py-2 text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </label>

          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Total Amount ($)
              </span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={receipt.amount === 0 ? "" : receipt.amount}
                onFocus={(e) => {
                  if (receipt.amount === 0) e.target.value = "";
                }}
                onChange={(e) =>
                  setReceipt({ ...receipt, amount: parseFloat(e.target.value) || 0 })
                }
                placeholder="0.00"
                className="border border-gray-300 rounded-lg px-3 py-2 text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </label>
            {amountCandidates.length > 1 && (
              <div className="flex flex-wrap gap-2" aria-label="Amount suggestions">
                <span className="text-xs text-gray-500 w-full">Did you mean:</span>
                {amountCandidates.map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setReceipt({ ...receipt, amount: amt })}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                      receipt.amount === amt
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white text-gray-700 border-gray-300 hover:border-blue-400"
                    }`}
                  >
                    ${amt.toFixed(2)}
                  </button>
                ))}
              </div>
            )}
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Store / Description
            </span>
            <input
              type="text"
              value={receipt.description}
              onChange={(e) => setReceipt({ ...receipt, description: e.target.value })}
              className="border border-gray-300 rounded-lg px-3 py-2 text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Category</span>
            <select
              value={receipt.category}
              onChange={(e) =>
                setReceipt({ ...receipt, category: e.target.value as ExpenseCategory })
              }
              className="border border-gray-300 rounded-lg px-3 py-2 text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {EXPENSE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </label>

          {clientError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert">
              {clientError}
            </p>
          )}

          <div className="flex gap-3 mt-2">
            <button
              onClick={reset}
              className="flex-1 py-3 rounded-xl border border-gray-300 text-gray-600 font-medium active:scale-95 transition-transform"
            >
              Cancel
            </button>
            <button
              onClick={saveReceipt}
              className="flex-1 py-3 rounded-xl bg-green-600 text-white font-semibold shadow active:scale-95 transition-transform"
            >
              Save to Sheet
            </button>
          </div>
        </div>
      )}

      {/* SAVING */}
      {step === "saving" && (
        <div className="flex items-center gap-2 mt-12 text-green-600 font-medium" aria-live="polite">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          Saving to Google Sheets…
        </div>
      )}

      {/* DONE */}
      {step === "done" && (
        <div className="w-full max-w-sm flex flex-col items-center gap-6 mt-8" role="status">
          <p className="text-xl font-semibold text-green-700">Saved</p>
          <p className="text-sm text-gray-500 text-center">
            Entry added to the Transactions sheet.
          </p>
          <button
            onClick={reset}
            className="w-full py-4 rounded-2xl bg-blue-600 text-white font-semibold shadow-md active:scale-95 transition-transform"
          >
            {mode === "manual" ? "Add Another Entry" : "Scan Another Receipt"}
          </button>
        </div>
      )}

      {/* ERROR */}
      {step === "error" && (
        <div className="w-full max-w-sm flex flex-col items-center gap-4 mt-8">
          <p className="text-lg font-semibold text-red-600">Something went wrong</p>
          <p
            className="text-sm text-gray-600 text-center bg-red-50 rounded-lg px-4 py-3 border border-red-200"
            role="alert"
          >
            {errorMsg}
          </p>
          <button
            onClick={continueFromError}
            className="w-full py-4 rounded-2xl bg-blue-600 text-white font-semibold shadow-md active:scale-95 transition-transform"
          >
            Enter Manually Instead
          </button>
          <button
            onClick={reset}
            className="w-full py-3 rounded-xl border border-gray-300 text-gray-600 font-medium active:scale-95 transition-transform"
          >
            Try Again
          </button>
        </div>
      )}
    </main>
  );
}
