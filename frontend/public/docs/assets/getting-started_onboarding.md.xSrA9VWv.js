import { _ as _export_sfc, C as resolveComponent, o as openBlock, c as createElementBlock, j as createBaseVNode, a as createTextVNode, b as createBlock, w as withCtx, E as createVNode, a3 as Suspense, a2 as createStaticVNode } from "./chunks/framework.CXM-6NNN.js";
const __pageData = JSON.parse('{"title":"Onboarding guide","description":"","frontmatter":{},"headers":[],"relativePath":"getting-started/onboarding.md","filePath":"getting-started/onboarding.md","lastUpdated":1789563169000}');
const _sfc_main = { name: "getting-started/onboarding.md" };
function _sfc_render(_ctx, _cache, $props, $setup, $data, $options) {
  const _component_Mermaid = resolveComponent("Mermaid");
  return openBlock(), createElementBlock("div", null, [
    _cache[1] || (_cache[1] = createBaseVNode("h1", {
      id: "onboarding-guide",
      tabindex: "-1"
    }, [
      createTextVNode("Onboarding guide "),
      createBaseVNode("a", {
        class: "header-anchor",
        href: "#onboarding-guide",
        "aria-label": 'Permalink to "Onboarding guide"'
      }, "​")
    ], -1)),
    _cache[2] || (_cache[2] = createBaseVNode("p", null, [
      createTextVNode("This guide walks a brand-new organization from first sign-in to go-live. It's written for the "),
      createBaseVNode("strong", null, "Administrator"),
      createTextVNode(" who received workspace credentials.")
    ], -1)),
    _cache[3] || (_cache[3] = createBaseVNode("h2", {
      id: "the-onboarding-flow",
      tabindex: "-1"
    }, [
      createTextVNode("The onboarding flow "),
      createBaseVNode("a", {
        class: "header-anchor",
        href: "#the-onboarding-flow",
        "aria-label": 'Permalink to "The onboarding flow"'
      }, "​")
    ], -1)),
    (openBlock(), createBlock(Suspense, null, {
      default: withCtx(() => [
        createVNode(_component_Mermaid, {
          id: "mermaid-9",
          class: "mermaid",
          graph: "flowchart%20TD%0A%20%20creds%5B%22You%20receive%20workspace%20URL%20%2B%20temporary%20password%22%5D%20--%3E%20login%5B%22Sign%20in%20at%20the%20workspace%20URL%22%5D%0A%20%20login%20--%3E%20change%5B%22Forced%20password%20change%22%5D%0A%20%20change%20--%3E%20mfa%5B%22MFA%20enrolment%20(admins)%22%5D%0A%20%20mfa%20--%3E%20users%5B%22Invite%20users%20and%20assign%20roles%22%5D%0A%20%20users%20--%3E%20build%5B%22Build%20forms%20and%20workflows%22%5D%0A%20%20build%20--%3E%20publish%5B%22Publish%20and%20go%20live%22%5D%0A"
        })
      ]),
      fallback: withCtx(() => [..._cache[0] || (_cache[0] = [
        createTextVNode(" Loading... ", -1)
      ])]),
      _: 1
    })),
    _cache[4] || (_cache[4] = createStaticVNode('<h2 id="_1-you-receive-your-workspace" tabindex="-1">1. You receive your workspace <a class="header-anchor" href="#_1-you-receive-your-workspace" aria-label="Permalink to &quot;1. You receive your workspace&quot;">​</a></h2><p>Before first login you should have:</p><ul><li>a <strong>workspace URL</strong> (for example <code>acme.netflow.app</code> or a login link with your organization),</li><li>your <strong>admin email</strong>,</li><li>a <strong>temporary password</strong> (shown once when the workspace was set up).</li></ul><p>If anything is missing, contact whoever set up NetFlow for your company.</p><h2 id="_2-first-sign-in-and-forced-password-change" tabindex="-1">2. First sign-in and forced password change <a class="header-anchor" href="#_2-first-sign-in-and-forced-password-change" aria-label="Permalink to &quot;2. First sign-in and forced password change&quot;">​</a></h2><ol><li>Open your <strong>workspace URL</strong> and sign in with your email and temporary password.</li><li>You&#39;ll be redirected to <strong>Set a new password</strong> — you can&#39;t skip this. Choose a strong password (minimum 6 characters, different from the temporary one).</li><li>You&#39;re now signed in with a fresh session.</li></ol><h2 id="_3-enrol-in-mfa" tabindex="-1">3. Enrol in MFA <a class="header-anchor" href="#_3-enrol-in-mfa" aria-label="Permalink to &quot;3. Enrol in MFA&quot;">​</a></h2><p>As an admin you&#39;ll be prompted to set up MFA immediately. Store your backup codes safely — admins cannot disable MFA afterwards.</p><h2 id="_4-invite-users-and-assign-roles" tabindex="-1">4. Invite users and assign roles <a class="header-anchor" href="#_4-invite-users-and-assign-roles" aria-label="Permalink to &quot;4. Invite users and assign roles&quot;">​</a></h2><p>From <strong>Users</strong> you can add people individually or via CSV import, and assign each a role.</p><ul><li>If <strong>allowed email domains</strong> are configured, new users must use an email on one of those domains (unless outside collaborators are enabled for your workspace).</li><li>Choose roles deliberately — only the Administrator designs forms and workflows.</li></ul><p>See <strong>Workspace admin</strong> and <strong>Roles &amp; permissions</strong>.</p><h2 id="_5-build-your-first-form-and-workflow" tabindex="-1">5. Build your first form and workflow <a class="header-anchor" href="#_5-build-your-first-form-and-workflow" aria-label="Permalink to &quot;5. Build your first form and workflow&quot;">​</a></h2><ol><li><strong>Form</strong> — create the form that starts the process (for example, a Leave Request).</li><li><strong>Workflow</strong> — create the approval flow, add approval nodes, set SLAs, and <strong>link the form</strong>.</li><li><strong>Publish both.</strong> A form only triggers a workflow when both are published and the form&#39;s trigger is set to run on submission.</li></ol><h2 id="_6-go-live" tabindex="-1">6. Go live <a class="header-anchor" href="#_6-go-live" aria-label="Permalink to &quot;6. Go live&quot;">​</a></h2><ul><li>Share the form with your team (internal link, or a public share link for outside submitters).</li><li>Confirm approvers can see items in <strong>Approvals</strong> / <strong>My Requests</strong>.</li><li>Watch the first few runs under <strong>Workflows → Executions</strong> and the <strong>Audit log</strong>.</li></ul><h2 id="onboarding-checklist" tabindex="-1">Onboarding checklist <a class="header-anchor" href="#onboarding-checklist" aria-label="Permalink to &quot;Onboarding checklist&quot;">​</a></h2><ul><li>[ ] Signed in and changed the temporary password</li><li>[ ] MFA enrolled and backup codes saved</li><li>[ ] Allowed email domains confirmed (if your company uses them)</li><li>[ ] Users invited and roles assigned</li><li>[ ] First form created and published</li><li>[ ] First workflow created, linked to the form, and published</li><li>[ ] A test submission completed end to end</li></ul>', 18))
  ]);
}
const onboarding = /* @__PURE__ */ _export_sfc(_sfc_main, [["render", _sfc_render]]);
export {
  __pageData,
  onboarding as default
};
