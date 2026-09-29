import { _ as _export_sfc, C as resolveComponent, o as openBlock, c as createElementBlock, a2 as createStaticVNode, b as createBlock, w as withCtx, a as createTextVNode, E as createVNode, a3 as Suspense } from "./chunks/framework.CXM-6NNN.js";
const __pageData = JSON.parse('{"title":"Introduction","description":"","frontmatter":{},"headers":[],"relativePath":"index.md","filePath":"index.md","lastUpdated":1789563169000}');
const _sfc_main = { name: "index.md" };
function _sfc_render(_ctx, _cache, $props, $setup, $data, $options) {
  const _component_Mermaid = resolveComponent("Mermaid");
  return openBlock(), createElementBlock("div", null, [
    _cache[1] || (_cache[1] = createStaticVNode("", 8)),
    (openBlock(), createBlock(Suspense, null, {
      default: withCtx(() => [
        createVNode(_component_Mermaid, {
          id: "mermaid-72",
          class: "mermaid",
          graph: "flowchart%20LR%0A%20%20builder%5B%22Admin%20creates%20Form%20%2B%20Workflow%22%5D%20--%3E%20publish%5B%22Publish%20both%22%5D%0A%20%20publish%20--%3E%20submit%5B%22User%20submits%20the%20form%22%5D%0A%20%20submit%20--%3E%20engine%5B%22Workflow%20engine%20starts%20an%20execution%22%5D%0A%20%20engine%20--%3E%20task%5B%22Task%20created%20for%20the%20approver%22%5D%0A%20%20task%20--%3E%20decide%7B%22Approver%20decides%22%7D%0A%20%20decide%20--%3E%7Capproved%7C%20next%5B%22Advance%20to%20next%20node%22%5D%0A%20%20decide%20--%3E%7Crejected%7C%20stop%5B%22Execution%20ends%22%5D%0A%20%20decide%20--%3E%7Cchanges%7C%20back%5B%22Sent%20back%20to%20submitter%22%5D%0A%20%20next%20--%3E%20done%5B%22End%20node%22%5D%0A%20%20done%20--%3E%20pdf%5B%22Optional%20signed%20PDF%20%2B%20audit%20log%22%5D%0A"
        })
      ]),
      fallback: withCtx(() => [..._cache[0] || (_cache[0] = [
        createTextVNode(" Loading... ", -1)
      ])]),
      _: 1
    })),
    _cache[2] || (_cache[2] = createStaticVNode("", 4))
  ]);
}
const index = /* @__PURE__ */ _export_sfc(_sfc_main, [["render", _sfc_render]]);
export {
  __pageData,
  index as default
};
