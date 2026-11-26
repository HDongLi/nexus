import { Outlet, createRootRoute } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: () => (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Outlet />
    </main>
  ),
});
