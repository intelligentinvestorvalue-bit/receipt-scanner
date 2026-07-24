import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/session";
import LoginForm from "@/components/LoginForm";

export default async function LoginPage() {
  if (await isAuthenticated()) {
    redirect("/");
  }

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-gray-800 mb-1 text-center">
          Receipt Scanner
        </h1>
        <p className="text-sm text-gray-500 mb-8 text-center">
          Sign in to continue
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
