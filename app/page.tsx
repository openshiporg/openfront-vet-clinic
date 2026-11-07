import { redirect } from "next/navigation";

// No customer-facing storefront is built by agents: the client booking site and portal wait for
// the owner's pick of a storefront design image (BUILD-PLAN §3). Until then the root opens the dashboard.
export default function Home() {
  redirect("/dashboard");
}
