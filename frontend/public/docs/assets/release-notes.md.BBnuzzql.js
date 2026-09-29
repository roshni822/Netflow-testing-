import { _ as _export_sfc, C as resolveComponent, o as openBlock, c as createElementBlock, a2 as createStaticVNode, b as createBlock, w as withCtx, a as createTextVNode, E as createVNode, a3 as Suspense, j as createBaseVNode } from "./chunks/framework.CXM-6NNN.js";
const __pageData = JSON.parse('{"title":"Release notes","description":"","frontmatter":{},"headers":[],"relativePath":"release-notes.md","filePath":"release-notes.md","lastUpdated":1789563169000}');
const _sfc_main = { name: "release-notes.md" };
function _sfc_render(_ctx, _cache, $props, $setup, $data, $options) {
  const _component_Mermaid = resolveComponent("Mermaid");
  return openBlock(), createElementBlock("div", null, [
    _cache[2] || (_cache[2] = createStaticVNode('<h1 id="release-notes" tabindex="-1">Release notes <a class="header-anchor" href="#release-notes" aria-label="Permalink to &quot;Release notes&quot;">​</a></h1><p>Notable changes in the current NetFlow build.</p><h2 id="unreleased" tabindex="-1">Unreleased <a class="header-anchor" href="#unreleased" aria-label="Permalink to &quot;Unreleased&quot;">​</a></h2><h3 id="integrations" tabindex="-1">Integrations <a class="header-anchor" href="#integrations" aria-label="Permalink to &quot;Integrations&quot;">​</a></h3>', 4)),
    (openBlock(), createBlock(Suspense, null, {
      default: withCtx(() => [
        createVNode(_component_Mermaid, {
          id: "mermaid-12",
          class: "mermaid",
          graph: "flowchart%20LR%0A%20%20ext%5B%22External%20system%22%5D%20--%3E%7C%22Inbound%20webhook%22%7C%20nf%5B%22NetFlow%22%5D%0A%20%20nf%20--%3E%7C%22Integration%20node%22%7C%20api%5B%22Partner%20API%22%5D%0A%20%20nf%20--%3E%7C%22Result%20callback%22%7C%20ext%0A"
        })
      ]),
      fallback: withCtx(() => [..._cache[0] || (_cache[0] = [
        createTextVNode(" Loading... ", -1)
      ])]),
      _: 1
    })),
    _cache[3] || (_cache[3] = createStaticVNode('<ul><li><strong>Inbound webhooks</strong> — start a published workflow from an external system (signed requests, optional field contract, rate limits).</li><li><strong>Result callback + status polling</strong> — external forms receive approve/reject outcomes via callback URL or status URL.</li><li><strong>Outbound Integration node</strong> — mid-flow HTTPS calls; failed calls surface in the workflow dead-letter list.</li><li><strong>Webhook delivery log</strong> for inbound attempts.</li></ul><h3 id="new-features-dashboards" tabindex="-1">New Features &amp; Dashboards <a class="header-anchor" href="#new-features-dashboards" aria-label="Permalink to &quot;New Features &amp; Dashboards&quot;">​</a></h3><ul><li><strong>DMS dashboard UI</strong> — a full file browser for managing internal workspace documents.</li><li><strong>S3 storage UI</strong> — external AWS S3 bucket integration and file browser.</li><li><strong>Plan &amp; Usage page</strong> — dedicated billing dashboard for quota tracking and limits.</li><li><strong>AI assistant</strong> — global floating chat widget and AI-powered form/workflow builder.</li><li><strong>Product tour</strong> — role-based guided walkthrough for new users.</li><li><strong>Org Admin nav restructure</strong> — streamlined sidebar with MANAGEMENT, DMS, MONITORING, and SETTINGS sections.</li></ul><h3 id="plans-usage" tabindex="-1">Plans &amp; usage <a class="header-anchor" href="#plans-usage" aria-label="Permalink to &quot;Plans &amp; usage&quot;">​</a></h3><ul><li>Plans: Trial, Basic, Professional, Enterprise.</li><li>Negotiated limits keep the <strong>selected plan name</strong> (for example Enterprise with tightened seats still shows <strong>Enterprise</strong>).</li><li>Usage meters in the Administrator profile and Users area; read-only mode when a licence has ended.</li></ul><h3 id="roles-profile" tabindex="-1">Roles &amp; profile <a class="header-anchor" href="#roles-profile" aria-label="Permalink to &quot;Roles &amp; profile&quot;">​</a></h3>', 6)),
    (openBlock(), createBlock(Suspense, null, {
      default: withCtx(() => [
        createVNode(_component_Mermaid, {
          id: "mermaid-93",
          class: "mermaid",
          graph: "flowchart%20TB%0A%20%20o%5B%22Administrator%20%E2%80%94%20forms%2C%20workflows%2C%20users%22%5D%0A%20%20ops%5B%22Leaders%20%E2%80%94%20approvals%2C%20team%2C%20reports%22%5D%0A%20%20w%5B%22Employee%20%E2%80%94%20submit%20and%20track%22%5D%0A"
        })
      ]),
      fallback: withCtx(() => [..._cache[1] || (_cache[1] = [
        createTextVNode(" Loading... ", -1)
      ])]),
      _: 1
    })),
    _cache[4] || (_cache[4] = createBaseVNode("ul", null, [
      createBaseVNode("li", null, "Administrator Profile: identity, MFA, workspace summary, plan & usage, admin shortcuts."),
      createBaseVNode("li", null, "Leader / Employee Profile: notifications, out-of-office, reporting line where relevant.")
    ], -1)),
    _cache[5] || (_cache[5] = createBaseVNode("h3", {
      id: "sign-in",
      tabindex: "-1"
    }, [
      createTextVNode("Sign-in "),
      createBaseVNode("a", {
        class: "header-anchor",
        href: "#sign-in",
        "aria-label": 'Permalink to "Sign-in"'
      }, "​")
    ], -1)),
    _cache[6] || (_cache[6] = createBaseVNode("ul", null, [
      createBaseVNode("li", null, "Microsoft SSO, MFA for admins, forced password change when a temporary password was issued.")
    ], -1)),
    _cache[7] || (_cache[7] = createBaseVNode("h3", {
      id: "documentation",
      tabindex: "-1"
    }, [
      createTextVNode("Documentation "),
      createBaseVNode("a", {
        class: "header-anchor",
        href: "#documentation",
        "aria-label": 'Permalink to "Documentation"'
      }, "​")
    ], -1)),
    _cache[8] || (_cache[8] = createBaseVNode("ul", null, [
      createBaseVNode("li", null, "Product docs use step text, screenshots, and flowcharts (workflows, admin, roles).")
    ], -1))
  ]);
}
const releaseNotes = /* @__PURE__ */ _export_sfc(_sfc_main, [["render", _sfc_render]]);
export {
  __pageData,
  releaseNotes as default
};
