"use client";

import { useActionState } from "react";
import { login, type LoginState } from "@/app/actions/auth";

export default function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(
    login,
    undefined
  );

  return (
    <form action={action} className="bg-white rounded-2xl shadow-md p-6 flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          Password
        </span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          className="border border-gray-300 rounded-lg px-3 py-2 text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </label>

      {state?.error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold shadow active:scale-95 transition-transform disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
