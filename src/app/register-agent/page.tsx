import { redirect } from "next/navigation";

export default function RegisterAgentRedirect() {
  redirect("/agents");
}
