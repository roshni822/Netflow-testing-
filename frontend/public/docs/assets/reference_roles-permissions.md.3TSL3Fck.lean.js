import { _ as _export_sfc, C as resolveComponent, o as openBlock, c as createElementBlock, a2 as createStaticVNode, b as createBlock, w as withCtx, a as createTextVNode, E as createVNode, a3 as Suspense } from "./chunks/framework.CXM-6NNN.js";
const __pageData = JSON.parse('{"title":"Roles & permissions","description":"","frontmatter":{},"headers":[],"relativePath":"reference/roles-permissions.md","filePath":"reference/roles-permissions.md","lastUpdated":1789563169000}');
const _sfc_main = { name: "reference/roles-permissions.md" };
function _sfc_render(_ctx, _cache, $props, $setup, $data, $options) {
  const _component_Mermaid = resolveComponent("Mermaid");
  return openBlock(), createElementBlock("div", null, [
    _cache[1] || (_cache[1] = createStaticVNode("", 9)),
    (openBlock(), createBlock(Suspense, null, {
      default: withCtx(() => [
        createVNode(_component_Mermaid, {
          id: "mermaid-179",
          class: "mermaid",
          graph: "flowchart%20TB%0A%20%20platform%5B%22Platform%20Shell%20%E2%80%94%20Super%20Admin%22%5D%0A%20%20admin%5B%22Org%20Admin%20Shell%20%E2%80%94%20Forms%2C%20Workflows%2C%20Users%2C%20Reports%2C%20Storage%22%5D%0A%20%20leader%5B%22Ops%20Shell%20%E2%80%94%20Approvals%2C%20Forms%2C%20My%20Team%2C%20Reports%22%5D%0A%20%20emp%5B%22Workspace%20Shell%20%E2%80%94%20My%20Requests%2C%20Forms%2C%20Profile%22%5D%0A"
        })
      ]),
      fallback: withCtx(() => [..._cache[0] || (_cache[0] = [
        createTextVNode(" Loading... ", -1)
      ])]),
      _: 1
    })),
    _cache[2] || (_cache[2] = createStaticVNode("", 9))
  ]);
}
const rolesPermissions = /* @__PURE__ */ _export_sfc(_sfc_main, [["render", _sfc_render]]);
export {
  __pageData,
  rolesPermissions as default
};
