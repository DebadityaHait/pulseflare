import {
  ClerkProvider,
  OrganizationSwitcher,
  SignIn,
  SignUp,
  UserButton,
  useAuth,
} from "@clerk/clerk-react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Brand, ThemeToggle } from "./components/ui";
import { setTokenProvider } from "./api/client";
import Workspace from "./Workspace";
type Mode = "login" | "signup" | "workspace";
function Gate({ mode }: { mode: Mode }) {
  const { isLoaded, isSignedIn, orgId, getToken } = useAuth();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setTokenProvider(getToken);
    setReady(true);
    return () => {
      setTokenProvider(undefined);
    };
  }, [getToken]);
  if (!isLoaded || !ready)
    return <div className="page-loading">Loading your session…</div>;
  if (isSignedIn && orgId && mode !== "workspace")
    return <Navigate to="/dashboard" replace />;
  if (isSignedIn && orgId)
    return (
      <Workspace
        demo={false}
        key={orgId}
        userControl={
          <>
            <OrganizationSwitcher
              hidePersonal
              afterSelectOrganizationUrl="/dashboard"
              afterCreateOrganizationUrl="/dashboard"
            />
            <UserButton />
          </>
        }
      />
    );
  return (
    <AuthLayout>
      {isSignedIn ? (
        <>
          <h1>Your team’s home.</h1>
          <p>Create or choose a workspace to continue.</p>
          <OrganizationSwitcher
            hidePersonal
            afterSelectOrganizationUrl="/dashboard"
            afterCreateOrganizationUrl="/dashboard"
          />
        </>
      ) : mode === "signup" ? (
        <SignUp
          routing="path"
          path="/signup"
          signInUrl="/login"
          forceRedirectUrl="/dashboard"
        />
      ) : (
        <SignIn
          routing="hash"
          signUpUrl="/signup"
          forceRedirectUrl="/dashboard"
        />
      )}
    </AuthLayout>
  );
}
function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-page">
      <header>
        <Brand />
        <ThemeToggle />
      </header>
      <main>{children}</main>
      <footer>
        <Link to="/">Back to website</Link>
        <Link to="/demo">
          Explore the demo <ArrowRight size={14} />
        </Link>
      </footer>
    </div>
  );
}
export default function Auth({ mode }: { mode: Mode }) {
  const key = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  if (!key)
    return (
      <AuthLayout>
        <span className="auth-mark">
          <ShieldCheck size={30} />
        </span>
        <span className="section-kicker">You’re early. We like that.</span>
        <h1>
          Your next lookout
          <br />
          is on its way.
        </h1>
        <p>
          Public workspace enrollment is coming soon. Get a feel for Pulseflare
          with a fully populated, interactive demo. No account needed.
        </p>
        <Link className="button primary" to="/demo">
          Explore the demo <ArrowRight size={16} />
        </Link>
        <small>No payment details. No signup. Just a look around.</small>
      </AuthLayout>
    );
  return (
    <ClerkProvider publishableKey={key}>
      <Gate mode={mode} />
    </ClerkProvider>
  );
}
