import { _ as _export_sfc, o as openBlock, c as createElementBlock, j as createBaseVNode, a as createTextVNode } from "./chunks/framework.CXM-6NNN.js";
const __pageData = JSON.parse('{"title":"Guide screenshots","description":"","frontmatter":{},"headers":[],"relativePath":"public/screenshots/guide/README.md","filePath":"public/screenshots/guide/README.md","lastUpdated":1789563169000}');
const _sfc_main = { name: "public/screenshots/guide/README.md" };
function _sfc_render(_ctx, _cache, $props, $setup, $data, $options) {
  return openBlock(), createElementBlock("div", null, [..._cache[0] || (_cache[0] = [
    createBaseVNode("h1", {
      id: "guide-screenshots",
      tabindex: "-1"
    }, [
      createTextVNode("Guide screenshots "),
      createBaseVNode("a", {
        class: "header-anchor",
        href: "#guide-screenshots",
        "aria-label": 'Permalink to "Guide screenshots"'
      }, "​")
    ], -1),
    createBaseVNode("p", null, "PNG files in this folder are used by the public VitePress guides.", -1),
    createBaseVNode("p", null, "Current captures come from the running application. Gray masks protect private values; no demo records or substituted role screens are used. Pending legacy assets are retained for reference but are not embedded in the current guides.", -1),
    createBaseVNode("p", null, [
      createTextVNode("Refresh instructions and the capture report are in "),
      createBaseVNode("code", null, "docs/screenshots.md"),
      createTextVNode(" and "),
      createBaseVNode("code", null, "docs/screenshots-report.json"),
      createTextVNode(". Never publish credentials or session tokens here.")
    ], -1)
  ])]);
}
const README = /* @__PURE__ */ _export_sfc(_sfc_main, [["render", _sfc_render]]);
export {
  __pageData,
  README as default
};
