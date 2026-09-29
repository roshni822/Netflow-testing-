import { _ as _export_sfc, C as resolveComponent, o as openBlock, c as createElementBlock, a2 as createStaticVNode, b as createBlock, w as withCtx, a as createTextVNode, E as createVNode, a3 as Suspense, j as createBaseVNode } from "./chunks/framework.CXM-6NNN.js";
const __pageData = JSON.parse('{"title":"Troubleshooting","description":"","frontmatter":{},"headers":[],"relativePath":"troubleshooting.md","filePath":"troubleshooting.md","lastUpdated":1789563169000}');
const _sfc_main = { name: "troubleshooting.md" };
function _sfc_render(_ctx, _cache, $props, $setup, $data, $options) {
  const _component_Mermaid = resolveComponent("Mermaid");
  return openBlock(), createElementBlock("div", null, [
    _cache[1] || (_cache[1] = createStaticVNode("", 26)),
    (openBlock(), createBlock(Suspense, null, {
      default: withCtx(() => [
        createVNode(_component_Mermaid, {
          id: "mermaid-182",
          class: "mermaid",
          graph: "flowchart%20TD%0A%20%20post%5B%22External%20system%20posts%20to%20webhook%22%5D%20--%3E%20chk%7B%22Published%20%2B%20enabled%20%2B%20valid%20signature%3F%22%7D%0A%20%20chk%20--%3E%7Cno%7C%20err%5B%22Request%20rejected%22%5D%0A%20%20chk%20--%3E%7Cyes%7C%20run%5B%22Execution%20starts%22%5D%0A%20%20run%20--%3E%20done%5B%22Complete%20%2F%20reject%20%2F%20fail%22%5D%0A%20%20done%20--%3E%20cb%7B%22Callback%20URL%20set%3F%22%7D%0A%20%20cb%20--%3E%7Cyes%7C%20postBack%5B%22Outcome%20sent%20to%20external%20system%22%5D%0A%20%20cb%20--%3E%7Cno%7C%20poll%5B%22External%20system%20checks%20status%20URL%22%5D%0A"
        })
      ]),
      fallback: withCtx(() => [..._cache[0] || (_cache[0] = [
        createTextVNode(" Loading... ", -1)
      ])]),
      _: 1
    })),
    _cache[2] || (_cache[2] = createBaseVNode("h2", {
      id: "still-stuck",
      tabindex: "-1"
    }, [
      createTextVNode("Still stuck? "),
      createBaseVNode("a", {
        class: "header-anchor",
        href: "#still-stuck",
        "aria-label": 'Permalink to "Still stuck?"'
      }, "​")
    ], -1)),
    _cache[3] || (_cache[3] = createBaseVNode("p", null, [
      createTextVNode("Ask your workspace "),
      createBaseVNode("strong", null, "Administrator"),
      createTextVNode(", or contact NetFlow support with the exact error message and what you were doing when it appeared.")
    ], -1))
  ]);
}
const troubleshooting = /* @__PURE__ */ _export_sfc(_sfc_main, [["render", _sfc_render]]);
export {
  __pageData,
  troubleshooting as default
};
