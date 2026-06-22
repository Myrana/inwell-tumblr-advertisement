const docsSections = [
  {
    title: "Local runner",
    items: [
      "Use Download runner for the first install, then use Start from the Runner page after Windows registers the launcher.",
      "When headless mode is on, the browser window may not stay visible. Watch the Runner page, queue item status, and runner logs on the website.",
      "Run locally processes the active queue. Test run keeps submit approval off so you can verify login, page loading, media fill, and failure handling without posting.",
      "Remote browser providers are no longer part of the supported workflow. The supported Tumblr automation path is the local runner on your Windows computer.",
    ],
  },
  {
    title: "Queues",
    items: [
      "Queues now live as named work lanes. Open Queues to create or switch lanes, then open Runner to run the selected lane.",
      "Content Library asks which queue to use when more than one queue exists, so saved drafts do not land in the wrong lane by accident.",
      "Completed posts appear in the post history archive, while failed or needs-review items stay visible for retry and manual attention.",
    ],
  },
  {
    title: "Content and templates",
    items: [
      "Content Library shows saved drafts, readiness, duplicate warnings, queue choices, and bulk edit controls for campaign names and tags.",
      "Saved Templates is back to a library-first view. Click a saved template to edit it on that page; the New Submission page still uses templates for applying copy.",
      "The editor readiness score is a quick health check for title, content, tags, forum link, media, target, and submission readiness.",
    ],
  },
  {
    title: "Tumblr accounts",
    items: [
      "Tumblr Accounts is where browser sessions are named, checked, and selected for queue runs.",
      "Runner browser account choices should be kept to linked accounts so the run uses a session you recognize.",
      "If an account needs login, launch the login helper, complete Tumblr login, then use a test run to verify the saved local session before running a real submit pass.",
    ],
  },
  {
    title: "Import and export",
    items: [
      "Operations has Import workspace and Export workspace. Export downloads a JSON backup of drafts, templates, queues, queue items, schedules, runner settings, submit targets, tag profiles, and Tumblr accounts.",
      "Import validates an Inkwell workspace JSON file, replaces the browser workspace state, and syncs included records to the backend when the API is available.",
      "Import does not delete backend records that are missing from the backup. Treat it as a restore or copy-in workflow, not a destructive reset.",
    ],
  },
  {
    title: "Suggested testing flow",
    items: [
      "Create or pick a Tumblr account, run Check login, and fix login before queue testing.",
      "Create a draft in New Submission, save it, then queue it from Content Library into a test queue.",
      "Turn Headless off for the first test if you want to watch the browser, then use Test run. Turn Headless on once the test path is working.",
      "Review Runner Logs after each run. A failed item should explain whether Tumblr login, rate limits, captcha, media, or submit-page controls blocked the run.",
      "Only turn Submit approved on when the queue looks right and you are ready for real Tumblr submission.",
    ],
  },
];

export function DocumentationWorkspace() {
  return (
    <section className="documentation-workspace" aria-label="Inkwell documentation">
      <div className="docs-intro">
        <p>
          This page summarizes the recent workflow changes and how to test them from inside the app.
        </p>
      </div>

      <div className="docs-grid">
        {docsSections.map((section) => (
          <article className="docs-section" key={section.title}>
            <h2>{section.title}</h2>
            <ul>
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
