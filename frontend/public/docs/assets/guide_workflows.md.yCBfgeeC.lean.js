import { _ as _export_sfc, C as resolveComponent, o as openBlock, c as createElementBlock, a2 as createStaticVNode, b as createBlock, w as withCtx, a as createTextVNode, E as createVNode, a3 as Suspense } from "./chunks/framework.CXM-6NNN.js";
const _imports_0 = "/docs/screenshots/guide/workflows-list.png";
const _imports_1 = "/docs/screenshots/guide/workflows-wizard.png";
const _imports_2 = "/docs/screenshots/guide/workflows-canvas.png";
const _imports_3 = "/docs/screenshots/guide/workflows-settings.png";
const _imports_4 = "/docs/screenshots/guide/workflows-publish.png";
const _imports_5 = "/docs/screenshots/guide/workflows-executions.png";
const __pageData = JSON.parse('{"title":"Workflows","description":"","frontmatter":{},"headers":[],"relativePath":"guide/workflows.md","filePath":"guide/workflows.md","lastUpdated":1789563169000}');
const _sfc_main = { name: "guide/workflows.md" };
function _sfc_render(_ctx, _cache, $props, $setup, $data, $options) {
  const _component_Mermaid = resolveComponent("Mermaid");
  return openBlock(), createElementBlock("div", null, [
    _cache[3] || (_cache[3] = createStaticVNode("", 7)),
    (openBlock(), createBlock(Suspense, null, {
      default: withCtx(() => [
        createVNode(_component_Mermaid, {
          id: "mermaid-58",
          class: "mermaid",
          graph: "flowchart%20LR%0A%20%20form%5B%22Published%20form%20submit%22%5D%20--%3E%20nf%5B%22NetFlow%20workflow%22%5D%0A%20%20manual%5B%22Manual%20Execute%20in%20UI%22%5D%20--%3E%20nf%0A%20%20ext%5B%22External%20app%20%2F%20n8n%22%5D%20--%3E%7C%22POST%20%2Fapi%2Fhooks%2Ftoken%22%7C%20nf%0A%20%20nf%20--%3E%20tasks%5B%22Approvals%20%26%20tasks%22%5D%0A%20%20nf%20--%3E%20out%5B%22Integration%20node%20%E2%86%92%20partner%20API%22%5D%0A%20%20nf%20--%3E%20cb%5B%22Result%20callback%20%E2%86%92%20external%20URL%22%5D%0A"
        })
      ]),
      fallback: withCtx(() => [..._cache[0] || (_cache[0] = [
        createTextVNode(" Loading... ", -1)
      ])]),
      _: 1
    })),
    _cache[4] || (_cache[4] = createStaticVNode("", 19)),
    (openBlock(), createBlock(Suspense, null, {
      default: withCtx(() => [
        createVNode(_component_Mermaid, {
          id: "mermaid-326",
          class: "mermaid",
          graph: "sequenceDiagram%0A%20%20participant%20Ext%20as%20External%20app%0A%20%20participant%20NF%20as%20NetFlow%0A%20%20participant%20Eng%20as%20Workflow%20engine%0A%20%20Ext-%3E%3ENF%3A%20POST%20%2Fapi%2Fhooks%2Ftoken%20%2B%20HMAC%20signature%0A%20%20NF-%3E%3ENF%3A%20Check%20publish%2C%20licence%2C%20signature%2C%20contract%0A%20%20NF-%3E%3EEng%3A%20Start%20execution%0A%20%20NF--%3E%3EExt%3A%20executionId%2C%20statusToken%2C%20statusUrl%0A%20%20Eng-%3E%3EEng%3A%20Approvals%20%2F%20Integration%20steps%E2%80%A6%0A%20%20Eng--%3E%3ENF%3A%20Completed%20%2F%20rejected%20%2F%20failed%0A%20%20opt%20Result%20callback%20URL%20set%0A%20%20%20%20NF-%3E%3EExt%3A%20POST%20outcome%20%2B%20HMAC%0A%20%20end%0A%20%20Ext-%3E%3ENF%3A%20GET%20%2Fapi%2Fhooks%2Fstatus%2FstatusToken%20(poll)%0A%20%20NF--%3E%3EExt%3A%20status%20%2B%20outcome%0A"
        })
      ]),
      fallback: withCtx(() => [..._cache[1] || (_cache[1] = [
        createTextVNode(" Loading... ", -1)
      ])]),
      _: 1
    })),
    _cache[5] || (_cache[5] = createStaticVNode("", 21)),
    (openBlock(), createBlock(Suspense, null, {
      default: withCtx(() => [
        createVNode(_component_Mermaid, {
          id: "mermaid-510",
          class: "mermaid",
          graph: "flowchart%20TD%0A%20%20trigger%5B%22Form%20submit%20%2F%20manual%20%2F%20inbound%20webhook%22%5D%20--%3E%20exec%5B%22Execution%20created%20(running)%22%5D%0A%20%20exec%20--%3E%20node%7B%22Next%20node%20type%22%7D%0A%20%20node%20--%3E%7C%22non-blocking%22%7C%20advance%5B%22Run%20and%20advance%22%5D%0A%20%20advance%20--%3E%20node%0A%20%20node%20--%3E%7C%22blocking%3A%20approval%2C%20committee%2C%20submit%2C%20review%22%7C%20task%5B%22Create%20Task%2C%20notify%2C%20pause%22%5D%0A%20%20task%20--%3E%20act%5B%22Assignee%20acts%22%5D%0A%20%20act%20--%3E%20resume%5B%22Engine%20resumes%22%5D%0A%20%20resume%20--%3E%20node%0A%20%20node%20--%3E%7C%22end%22%7C%20finish%5B%22Completed%22%5D%0A%20%20finish%20--%3E%20pdf%5B%22Optional%20signed%20PDF%22%5D%0A%20%20finish%20--%3E%20cb%5B%22Result%20callback%20if%20webhook-started%22%5D%0A"
        })
      ]),
      fallback: withCtx(() => [..._cache[2] || (_cache[2] = [
        createTextVNode(" Loading... ", -1)
      ])]),
      _: 1
    })),
    _cache[6] || (_cache[6] = createStaticVNode("", 5))
  ]);
}
const workflows = /* @__PURE__ */ _export_sfc(_sfc_main, [["render", _sfc_render]]);
export {
  __pageData,
  workflows as default
};
