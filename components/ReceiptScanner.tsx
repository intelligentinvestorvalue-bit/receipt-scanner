"use client";

import { useRef, useState } from "react";
import { EXPENSE_CATEGORIES, ExpenseCategory } from "@/lib/categories";

type Step = "capture" | "scanning" | "confirm" | "saving" | "done" | "error";

interface ReceiptData {
  date: string;
  amount: number;
  description: string;
  category: ExpenseCategory;
}

export default function ReceiptScanner() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("capture");
  const [preview, setPreview] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [setupStatus, setSetupStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [setupMsg, setSetupMsg] = useState("");

  // ── Step 1: User picks / captures an image ────────────────────────────────
  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setPreview(dataUrl);
      scanReceipt(dataUrl);
    };
    reader.readAsDataURL(file);
  }

  // ── Step 2: Send to /api/scan ─────────────────────────────────────────────
  async function scanReceipt(dataUrl: string) {
    setStep("scanning");
    setErrorMsg("");
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Scan failed");

      setReceipt({
        date: data.date,
        amount: data.amount,
        description: data.description,
        category: data.category,
      });
      setStep("confirm");
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setStep("error");
    }
  }

  // ── Step 3: User confirms / edits, then saves ─────────────────────────────
  async function saveReceipt() {
    if (!receipt) return;
    setStep("saving");
    try {
      const res = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(receipt),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setStep("done");
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setStep("error");
    }
  }

  // ── Setup: copy last month's sheet → new month ──────────────────────────
  async function setupMonth() {
    setSetupStatus("loading");
    setSetupMsg("");
    try {
      const res = await fetch("/api/setup-month", {
        method: "POST",
        headers: {
          "x-setup-secret": process.env.NEXT_PUBLIC_SETUP_SECRET ?? "",
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Setup failed");
      setSetupMsg(
        data.status === "already_exists"
          ? `"${data.name}" already exists — you're all set!`
          : `Created "${data.name}" and shared it to your Drive.`
      );
      setSetupStatus("done");
    } catch (err: unknown) {
      setSetupMsg(err instanceof Error ? err.message : "Setup failed");
      setSetupStatus("error");
    }
  }

  function reset() {
    setStep("capture");
    setPreview(null);
    setReceipt(null);
    setErrorMsg("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-800 mb-1">Receipt Scanner</h1>
      <p className="text-sm text-gray-500 mb-8">Scan → Review → Save to Google Sheets</p>

      {/* CAPTURE */}
      {step === "capture" && (
        <div className="w-full max-w-sm flex flex-col gap-4">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full py-5 rounded-2xl bg-blue-600 text-white text-lg font-semibold shadow-md active:scale-95 transition-transform"
          >
            📷 Take Photo / Upload Receipt
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageSelect}
          />
          <p className="text-center text-xs text-gray-400">
            Opens camera on mobile · or choose from gallery
          </p>

          {/* Monthly sheet setup */}
          <div className="border-t border-gray-200 pt-4 flex flex-col gap-2">
            <button
              onClick={setupMonth}
              disabled={setupStatus === "loading"}
              className="w-full py-3 rounded-xl border border-blue-300 text-blue-600 text-sm font-medium active:scale-95 transition-transform disabled:opacity-50"
            >
              {setupStatus === "loading" ? "Setting up…" : "🗓 Setup This Month's Sheet"}
            </button>
            {setupStatus === "done" && (
              <p className="text-center text-xs text-green-600">{setupMsg}</p>
            )}
            {setupStatus === "error" && (
              <p className="text-center text-xs text-red-500">{setupMsg}</p>
            )}
          </div>
        </div>
      )}

      {/* SCANNING */}
      {step === "scanning" && (
        <div className="flex flex-col items-center gap-4 mt-8">
          {preview && (
            <img src={preview} alt="Receipt preview" className="w-48 rounded-xl shadow object-cover" />
          )}
          <div className="flex items-center gap-2 text-blue-600 font-medium">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
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
            <img src={preview} alt="Receipt preview" className="w-full max-h-40 object-cover rounded-xl" />
          )}
          <h2 className="text-lg font-semibold text-gray-700">Review &amp; Confirm</h2>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Date</span>
            <input
              type="date"
              value={receipt.date}
              onChange={(e) => setReceipt({ ...receipt, date: e.target.value })}
              className="border border-gray-300 rounded-lg px-3 py-2 text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Amount ($)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={receipt.amount}
              onChange={(e) => setReceipt({ ...receipt, amount: parseFloat(e.target.value) || 0 })}
              className="border border-gray-300 rounded-lg px-3 py-2 text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Store / Description</span>
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
              onChange={(e) => setReceipt({ ...receipt, category: e.target.value as ExpenseCategory })}
              className="border border-gray-300 rounded-lg px-3 py-2 text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {EXPENSE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </label>

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
        <div className="flex items-center gap-2 mt-12 text-green-600 font-medium">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          Saving to Google Sheets…
        </div>
      )}

      {/* DONE */}
      {step === "done" && (
        <div className="w-full max-w-sm flex flex-col items-center gap-6 mt-8">
          <div className="text-6xl">✅</div>
          <p className="text-xl font-semibold text-gray-800">Saved!</p>
          <p className="text-sm text-gray-500">Entry added to the Transactions sheet.</p>
          <button
            onClick={reset}
            className="w-full py-4 rounded-2xl bg-blue-600 text-white font-semibold shadow-md active:scale-95 transition-transform"
          >
            Scan Another Receipt
          </button>
        </div>
      )}

      {/* ERROR */}
      {step === "error" && (
        <div className="w-full max-w-sm flex flex-col items-center gap-4 mt-8">
          <div className="text-5xl">⚠️</div>
          <p className="text-lg font-semibold text-red-600">Something went wrong</p>
          <p className="text-sm text-gray-600 text-center bg-red-50 rounded-lg px-4 py-3 border border-red-200">
            {errorMsg}
          </p>
          <button
            onClick={reset}
            className="w-full py-4 rounded-2xl bg-gray-700 text-white font-semibold shadow-md active:scale-95 transition-transform"
          >
            Try Again
          </button>
        </div>
      )}
    </main>
  );
}
