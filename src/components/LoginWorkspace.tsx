import { FormEvent } from "react";

type LoginWorkspaceProps = {
  bootstrapRequired: boolean;
  form: {
    email: string;
    password: string;
    displayName: string;
    workspaceName: string;
  };
  status: string;
  onFormChange: (patch: Partial<LoginWorkspaceProps["form"]>) => void;
  onLogin: (event: FormEvent) => void;
  onRegister: (event: FormEvent) => void;
};

export function LoginWorkspace({
  bootstrapRequired,
  form,
  status,
  onFormChange,
  onLogin,
  onRegister,
}: LoginWorkspaceProps) {
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
        <h1>{bootstrapRequired ? "Create your Inkwell login" : "Log into Inkwell"}</h1>
        <form className="login-form" onSubmit={bootstrapRequired ? onRegister : onLogin}>
          {bootstrapRequired ? (
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
          <label>
            Password
            <input
              autoComplete={bootstrapRequired ? "new-password" : "current-password"}
              type="password"
              value={form.password}
              onChange={(event) => onFormChange({ password: event.target.value })}
            />
          </label>
          <button className="primary" type="submit">
            {bootstrapRequired ? "Create login" : "Log in"}
          </button>
        </form>
        {status ? <p className="queue-status">{status}</p> : null}
      </section>
    </main>
  );
}
