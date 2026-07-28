import { createFileRoute, Outlet, redirect, useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // A transient network failure must not be treated as "signed out": retry once
    // before sending the user back to the sign-in screen.
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data, error } = await supabase.auth.getUser();
      if (data?.user) return { user: data.user };
      const message = error?.message ?? "";
      const recoverable = /fetch|network|timeout/i.test(message);
      if (!recoverable) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    throw redirect({ to: "/auth" });
  },
  component: () => <Outlet />,
  errorComponent: AuthedError,
  notFoundComponent: () => (
    <div className="grid min-h-screen place-items-center px-6 text-center">
      <div>
        <h1 className="text-xl font-bold">Screen not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This part of the dashboard does not exist.
        </p>
      </div>
    </div>
  ),
});

function AuthedError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  console.error(error);
  return (
    <div className="grid min-h-screen place-items-center px-6 text-center">
      <div className="max-w-sm">
        <h1 className="text-xl font-bold">This screen didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The connection to the backend was interrupted. Try again — you stay signed in.
        </p>
        <Button
          className="mt-5"
          onClick={() => {
            router.invalidate();
            reset();
          }}
        >
          Try again
        </Button>
      </div>
    </div>
  );
}
