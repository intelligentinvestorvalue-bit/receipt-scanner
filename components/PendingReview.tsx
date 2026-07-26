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
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600" aria-live="polite">
            {loading ? "Loading…" : `${items.length} waiting`}
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
            No pending email charges. When Gmail Apps Script finds a card alert, it will show up here for
            your approval.
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
