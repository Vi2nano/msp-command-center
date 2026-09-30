import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_platform/platform/")({
  beforeLoad: () => {
    throw redirect({ to: "/platform/workspaces" });
  },
});
