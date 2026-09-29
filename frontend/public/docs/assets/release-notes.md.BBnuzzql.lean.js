import { _ as _export_sfc, C as resolveComponent, o as openBlock, c as createElementBlock, a2 as createStaticVNode, b as createBlock, w as withCtx, a as createTextVNode, E as createVNode, a3 as Suspense, j as createBaseVNode } from "./chunks/framework.CXM-6NNN.js";
const __pageData = JSON.parse('{"title":"Release notes","description":"","frontmatter":{},"headers":[],"relativePath":"release-notes.md","filePath":"release-notes.md","lastUpdated":1789563169000}');
const _sfc_main = { name: "release-notes.md" };
function _sfc_render(_ctx, _cache, $props, $setup, $data, $options) {
  const _component_Mermaid = resolveComponent("Mermaid");
  return openBlock(), createElementBlock("div", null, [
    _cache[2] || (_cache[2] = createStaticVNode("", 4)),
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
    _cache[3] || (_cache[3] = createStaticVNode("", 6)),
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
