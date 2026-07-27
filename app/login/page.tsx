import { redirect } from "next/navigation";

/** Login temporarily disabled — send everyone to the app. */
export default function LoginPage() {
  redirect("/");
}
