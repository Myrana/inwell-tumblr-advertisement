import { FormEvent } from "react";

export type LoginMode = "login" | "register" | "reset";

type LoginWorkspaceProps = {
  bootstrapRequired: boolean;
  mode: LoginMode;
  form: {
    email: string;
    password: string;
    displayName: string;
    workspaceName: string;
  };
  status: string;
  onFormChange: (patch: Partial<LoginWorkspaceProps["form"]>) => void;
  onModeChange: (mode: LoginMode) => void;
  onLogin: (event: FormEvent) => void;
  onRegister: (event: FormEvent) => void;
  onPasswordReset: (event: FormEvent) => void;
};

export function LoginWorkspace({
  bootstrapRequired,
  mode,
  form,
  status,
  onFormChange,
  onModeChange,
  onLogin,
  onRegister,
  onPasswordReset,
}: LoginWorkspaceProps) {
  const activeMode = bootstrapRequired ? "register" : mode;
  const isRegistering = activeMode === "register";
  const isResetting = activeMode === "reset";
  const title = isRegistering ? "Create your Inkwell account" : isResetting ? "Reset your password" : "Log into Inkwell";
  const submitLabel = isRegistering ? "Create account" : isResetting ? "Send reset instructions" : "Log in";
  const submitHandler = isRegistering ? onRegister : isResetting ? onPasswordReset : onLogin;

  return (
    <main className="login-shell">
      <section className="login-panel" aria-label="Inkwell login">
        <div className="brand login-brand">
          <div className="brand-mark">I</div>
          <div>
            <strong>Inkwell</strong>
            <span>Tumblr Advertisement Assistant</span>
          </div>
        </div>
        <h1>{title}</h1>
        {!bootstrapRequired ? (
          <div className="login-mode-tabs" role="tablist" aria-label="Account options">
            <button type="button" className={activeMode === "login" ? "active" : ""} onClick={() => onModeChange("login")}>
              Log in
            </button>
            <button type="button" className={activeMode === "register" ? "active" : ""} onClick={() => onModeChange("register")}>
              Create account
            </button>
          </div>
        ) : null}
        <form className="login-form" onSubmit={submitHandler}>
          {isRegistering ? (
            <>
              <label>
                Name
                <input
                  autoComplete="name"
                  value={form.displayName}
                  onChange={(event) => onFormChange({ displayName: event.target.value })}
                  placeholder="Myrana"
                />
              </label>
              <label>
                Workspace
                <input
                  value={form.workspaceName}
                  onChange={(event) => onFormChange({ workspaceName: event.target.value })}
                  placeholder="Inkwell workspace"
                />
              </label>
            </>
          ) : null}
          <label>
            Email
            <input
              autoComplete="email"
              type="email"
              value={form.email}
              onChange={(event) => onFormChange({ email: event.target.value })}
              placeholder="you@example.com"
            />
          </label>
          {!isResetting ? (
            <label>
              Password
              <input
                autoComplete={isRegistering ? "new-password" : "current-password"}
                type="password"
                value={form.password}
                onChange={(event) => onFormChange({ password: event.target.value })}
              />
            </label>
          ) : null}
          <button className="primary" type="submit">
            {submitLabel}
          </button>
        </form>
        {!bootstrapRequired ? (
          <div className="login-secondary-actions">
            {activeMode === "login" ? (
              <button type="button" onClick={() => onModeChange("reset")}>
                Forgot password?
              </button>
            ) : (
              <button type="button" onClick={() => onModeChange("login")}>
                Back to login
              </button>
            )}
          </div>
        ) : null}
        {status ? <p className="queue-status">{status}</p> : null}
      </section>
    </main>
  );
}
