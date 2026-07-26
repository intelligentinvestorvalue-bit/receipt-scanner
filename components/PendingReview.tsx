"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { EXPENSE_CATEGORIES, ExpenseCategory } from "@/lib/categories";
import { logout } from "@/app/actions/auth";

interface PendingItem {
  rowNumber: number;
  date: string;
  amount: number;
  description: string;
  category: string;
  source: string;
  status: string;
  gmailMessageId: string;
  createdAt: string;
  snippet: string;
}

interface ScriptInstall {
  attempted: boolean;
  ok: boolean;
  scriptId?: string;
  message: string;
}

type Draft = {
  date: string;
  amount: number;
  description: string;
  category: ExpenseCategory;
};

function toDraft(item: PendingItem): Draft {
  const category = EXPENSE_CATEGORIES.includes(item.category as ExpenseCategory)
    ? (item.category as ExpenseCategory)
    : "Personal";
  return {
    date: item.date,
    amount: item.amount,
    description: item.description,
    category,
  };
}

export default function PendingReview() {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyRow, setBusyRow] = useState<number | null>(null);
  const [actionError, setActionError] = useState("");
  const [spreadsheetUrl, setSpreadsheetUrl] = useState("");
  const [spreadsheetName, setSpreadsheetName] = useState("");
  const [created, setCreated] = useState(false);
  const [script, setScript] = useState("");
  const [scriptInstall, setScriptInstall] = useState<ScriptInstall | null>(null);
  const [showScript, setShowScript] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/pending");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to load pending items");
      const list: PendingItem[] = data.items ?? [];
      setItems(list);
      const next: Record<number, Draft> = {};
      for (const item of list) next[item.rowNumber] = toDraft(item);
      setDrafts(next);
      setSpreadsheetUrl(data.spreadsheetUrl ?? "");
      setSpreadsheetName(data.spreadsheetName ?? "");
      setCreated(Boolean(data.created));
      setScript(typeof data.script === "string" ? data.script : "");
      setScriptInstall(data.scriptInstall ?? null);
      if (data.created || data.scriptInstall?.ok === false) {
        setShowScript(true);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function copyScript() {
    if (!script) return;
    try {
      await navigator.clipboard.writeText(script);
      setCopyStatus("Copied — paste into Extensions → Apps Script");
    } catch {
      setCopyStatus("Copy failed — select the script text manually");
    }
  }

  function updateDraft(rowNumber: number, patch: Partial<Draft>) {
    setDrafts((prev) => ({
      ...prev,
      [rowNumber]: { ...prev[rowNumber], ...patch },
    }));
  }

  async function approve(rowNumber: number) {
    const draft = drafts[rowNumber];
    if (!draft) return;
    if (!(draft.amount > 0)) {
      setActionError("Amount must be greater than 0");
      return;
    }
    if (!draft.description.trim()) {
      setActionError("Description is required");
      return;
    }
    setBusyRow(rowNumber);
    setActionError("");
    try {
      const res = await fetch("/api/pending/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowNumber, ...draft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Approve failed");
      setItems((prev) => prev.filter((i) => i.rowNumber !== rowNumber));
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setBusyRow(null);
    }
  }

  async function discard(rowNumber: number) {
    setBusyRow(rowNumber);
    setActionError("");
    try {
      const res = await fetch("/api/pending/discard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowNumber }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Discard failed");
      setItems((prev) => prev.filter((i) => i.rowNumber !== rowNumber));
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Discard failed");
    } finally {
      setBusyRow(null);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center px-4 py-8 font-sans">
      <div className="w-full max-w-lg flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 mb-1">Email Pending</h1>
          <p className="text-sm text-gray-500">
            Review Gmail charges, then approve to Google Sheets
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <Link href="/" className="text-xs text-blue-600 underline underline-offset-2">
            Back to scanner
          </Link>
          <form action={logout}>
            <button
              type="submit"
              className="text-xs text-gray-500 hover:text-gray-800 underline underline-offset-2"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>

      <div className="w-full max-w-lg flex flex-col gap-4">
        {!loading && !error && spreadsheetUrl && (
          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col gap-3 text-sm text-gray-700">
            {created ? (
              <p className="text-green-700 font-medium">
                Created a <span className="font-semibold">Pending</span> tab on{" "}
                <span className="font-semibold">{spreadsheetName || "this month's budget sheet"}</span>{" "}
                with all columns.
              </p>
            ) : (
              <p>
                Using the <span className="font-semibold">Pending</span> tab on{" "}
                <span className="font-semibold">{spreadsheetName || "this month's budget sheet"}</span>.
              </p>
            )}

            {scriptInstall && (
              <p className={scriptInstall.ok ? "text-green-700" : "text-amber-800"}>
                {scriptInstall.message}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <a
                href={spreadsheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium"
              >
                Open sheet
              </a>
              <button
                type="button"
                onClick={() => setShowScript((v) => !v)}
                className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium"
              >
                {showScript ? "Hide Apps Script" : "Show Apps Script"}
              </button>
              {script && (
                <button
                  type="button"
                  onClick={() => void copyScript()}
                  className="px-3 py-2 rounded-lg border border-blue-300 text-blue-700 text-sm font-medium"
                >
                  Copy script (ID filled in)
                </button>
              )}
            </div>

            {copyStatus && <p className="text-xs text-green-700">{copyStatus}</p>}

            {showScript && script && (
              <div className="flex flex-col gap-2">
                <ol className="list-decimal list-inside text-xs text-gray-600 space-y-1">
                  <li>Open the sheet → Extensions → Apps Script</li>
                  <li>Paste the copied script (sheet ID already set)</li>
                  <li>Run <code className="bg-gray-100 px-1 rounded">processCardAlertEmails</code> once and allow Gmail access</li>
                  <li>Triggers → every 10–15 minutes</li>
                </ol>
                <textarea
                  readOnly
                  value={script}
                  rows={12}
                  className="w-full font-mono text-[11px] border border-gray-200 rounded-lg p-2 bg-gray-50 text-gray-800"
                />
              </div>
            )}
          </section>
        )}

        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600" aria-live="polite">
            {loading ? "Setting up Pending sheet…" : `${items.length} waiting`}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="text-sm text-blue-600 font-medium disabled:opacity-50"
          >
            Refresh
          </button>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert">
            {error}
          </p>
        )}
        {actionError && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert">
            {actionError}
          </p>
        )}

        {!loading && items.length === 0 && !error && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 text-center text-gray-500 text-sm">
            No pending email charges yet. After Gmail Apps Script runs against your{" "}
            <span className="font-medium">card-alerts</span> label, items will appear here for approval.
          </div>
        )}

        {items.map((item) => {
          const draft = drafts[item.rowNumber];
          if (!draft) return null;
          const busy = busyRow === item.rowNumber;

          return (
            <article
              key={item.rowNumber}
              className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col gap-4"
            >
              {(item.source || item.snippet) && (
                <div className="text-xs text-gray-500 border-b border-gray-100 pb-3 space-y-1">
                  {item.source && <p className="font-medium text-gray-600">{item.source}</p>}
                  {item.snippet && <p className="line-clamp-3">{item.snippet}</p>}
                </div>
              )}

              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Date</span>
                <input
                  type="date"
                  value={draft.date}
                  onChange={(e) => updateDraft(item.rowNumber, { date: e.target.value })}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Amount ($)
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={draft.amount === 0 ? "" : draft.amount}
                  onChange={(e) =>
                    updateDraft(item.rowNumber, {
                      amount: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="border border-gray-300 rounded-lg px-3 py-2 text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Description
                </span>
                <input
                  type="text"
                  value={draft.description}
                  onChange={(e) =>
                    updateDraft(item.rowNumber, { description: e.target.value })
                  }
                  className="border border-gray-300 rounded-lg px-3 py-2 text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Category
                </span>
                <select
                  value={draft.category}
                  onChange={(e) =>
                    updateDraft(item.rowNumber, {
                      category: e.target.value as ExpenseCategory,
                    })
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

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void discard(item.rowNumber)}
                  className="flex-1 py-3 rounded-xl border border-gray-300 text-gray-600 font-medium active:scale-95 transition-transform disabled:opacity-50"
                >
                  Discard
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void approve(item.rowNumber)}
                  className="flex-1 py-3 rounded-xl bg-green-600 text-white font-semibold shadow active:scale-95 transition-transform disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Approve"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}
