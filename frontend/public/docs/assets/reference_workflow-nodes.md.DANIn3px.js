import { _ as _export_sfc, C as resolveComponent, o as openBlock, c as createElementBlock, a2 as createStaticVNode, b as createBlock, w as withCtx, a as createTextVNode, E as createVNode, a3 as Suspense, j as createBaseVNode } from "./chunks/framework.CXM-6NNN.js";
const __pageData = JSON.parse('{"title":"Workflow nodes","description":"","frontmatter":{},"headers":[],"relativePath":"reference/workflow-nodes.md","filePath":"reference/workflow-nodes.md","lastUpdated":1789563169000}');
const _sfc_main = { name: "reference/workflow-nodes.md" };
function _sfc_render(_ctx, _cache, $props, $setup, $data, $options) {
  const _component_Mermaid = resolveComponent("Mermaid");
  return openBlock(), createElementBlock("div", null, [
    _cache[2] || (_cache[2] = createStaticVNode('<h1 id="workflow-nodes" tabindex="-1">Workflow nodes <a class="header-anchor" href="#workflow-nodes" aria-label="Permalink to &quot;Workflow nodes&quot;">​</a></h1><p>Cheat sheet of the canvas palette, plus how runs get started and call outside systems.</p><h2 id="canvas-nodes" tabindex="-1">Canvas nodes <a class="header-anchor" href="#canvas-nodes" aria-label="Permalink to &quot;Canvas nodes&quot;">​</a></h2><table tabindex="0"><thead><tr><th>Node</th><th>Blocking?</th><th>Purpose</th></tr></thead><tbody><tr><td><strong>Start</strong></td><td>No</td><td>Entry point of the flow</td></tr><tr><td><strong>Approval</strong></td><td>Yes</td><td>A single approver approves / rejects / requests changes</td></tr><tr><td><strong>Multi-Approval</strong></td><td>Yes</td><td>Committee vote with an N-of-M quorum</td></tr><tr><td><strong>Submit</strong></td><td>Yes</td><td>Assignee fills an inline form to advance</td></tr><tr><td><strong>Review</strong></td><td>Yes</td><td>Reviewer forwards or sends back for changes</td></tr><tr><td><strong>Condition</strong></td><td>No</td><td>Branches on the last approval outcome</td></tr><tr><td><strong>Notify</strong></td><td>No</td><td>Sends a notification (in-app today)</td></tr><tr><td><strong>Integration</strong></td><td>No</td><td>Outbound HTTPS call mid-flow (method, headers, auth, body). Failures can retry and land in the workflow <strong>integration dead-letter</strong> list</td></tr><tr><td><strong>Timer</strong></td><td>No</td><td>Waits a duration (advances immediately today)</td></tr><tr><td><strong>End</strong></td><td>No</td><td>Finishes the run; optional signed PDF. Webhook-started runs may also fire a <strong>result callback</strong></td></tr></tbody></table><p><strong>Blocking</strong> nodes create a task and pause the execution until someone acts. <strong>Non-blocking</strong> nodes run and advance automatically.</p>', 5)),
    (openBlock(), createBlock(Suspense, null, {
      default: withCtx(() => [
        createVNode(_component_Mermaid, {
          id: "mermaid-139",
          class: "mermaid",
          graph: "flowchart%20LR%0A%20%20start%5B%22Start%22%5D%20--%3E%20appr%5B%22Approval%20%2F%20Multi%20%2F%20Submit%20%2F%20Review%22%5D%0A%20%20appr%20--%3E%20cond%5B%22Condition%22%5D%0A%20%20cond%20--%3E%20integ%5B%22Integration%22%5D%0A%20%20integ%20--%3E%20endn%5B%22End%22%5D%0A%20%20start%20-.-%3E%20notify%5B%22Notify%22%5D%0A%20%20notify%20-.-%3E%20endn%0A"
        })
      ]),
      fallback: withCtx(() => [..._cache[0] || (_cache[0] = [
        createTextVNode(" Loading... ", -1)
      ])]),
      _: 1
    })),
    _cache[3] || (_cache[3] = createStaticVNode('<h2 id="triggers-and-callbacks-settings-not-nodes" tabindex="-1">Triggers and callbacks (Settings, not nodes) <a class="header-anchor" href="#triggers-and-callbacks-settings-not-nodes" aria-label="Permalink to &quot;Triggers and callbacks (Settings, not nodes)&quot;">​</a></h2><p>Configured on <strong>Settings &amp; triggers</strong>, not dragged onto the canvas:</p><table tabindex="0"><thead><tr><th>Name</th><th>Direction</th><th>What it does</th></tr></thead><tbody><tr><td><strong>Form submit</strong></td><td>In</td><td>Linked published form creates a run</td></tr><tr><td><strong>Manual execute</strong></td><td>In</td><td>Allowed user starts a run from the UI</td></tr><tr><td><strong>Inbound webhook</strong></td><td>In</td><td>External <code>POST /api/hooks/&lt;token&gt;</code> starts a run (HMAC + optional field contract)</td></tr><tr><td><strong>Result callback</strong></td><td>Out</td><td>On finish of a webhook-started run, NetFlow POSTs outcome to your URL</td></tr><tr><td><strong>Integration node</strong></td><td>Out</td><td>Mid-flow HTTP to a partner API</td></tr></tbody></table>', 3)),
    (openBlock(), createBlock(Suspense, null, {
      default: withCtx(() => [
        createVNode(_component_Mermaid, {
          id: "mermaid-218",
          class: "mermaid",
          graph: "flowchart%20TB%0A%20%20subgraph%20inbound%20%5BInto%20NetFlow%5D%0A%20%20%20%20A%5BForm%20submit%5D%0A%20%20%20%20B%5BManual%20Execute%5D%0A%20%20%20%20C%5BInbound%20webhook%20POST%5D%0A%20%20end%0A%20%20subgraph%20engine%20%5BWorkflow%20engine%5D%0A%20%20%20%20N%5BNodes%20on%20canvas%5D%0A%20%20end%0A%20%20subgraph%20outbound%20%5BOut%20of%20NetFlow%5D%0A%20%20%20%20D%5BIntegration%20HTTPS%20call%5D%0A%20%20%20%20E%5BResult%20callback%20POST%5D%0A%20%20end%0A%20%20A%20--%3E%20N%0A%20%20B%20--%3E%20N%0A%20%20C%20--%3E%20N%0A%20%20N%20--%3E%20D%0A%20%20N%20--%3E%20E%0A"
        })
      ]),
      fallback: withCtx(() => [..._cache[1] || (_cache[1] = [
        createTextVNode(" Loading... ", -1)
      ])]),
      _: 1
    })),
    _cache[4] || (_cache[4] = createBaseVNode("div", { class: "tip custom-block" }, [
      createBaseVNode("p", { class: "custom-block-title" }, "Approver tokens"),
      createBaseVNode("p", null, [
        createTextVNode("Approval / submit / review nodes can target "),
        createBaseVNode("code", null, "direct_manager"),
        createTextVNode(", "),
        createBaseVNode("code", null, "hr_partner"),
        createTextVNode(", "),
        createBaseVNode("code", null, "ceo"),
        createTextVNode(", or "),
        createBaseVNode("code", null, "<department>_manager"),
        createTextVNode(". NetFlow resolves those per submitter (org chart + out-of-office delegate).")
      ])
    ], -1))
  ]);
}
const workflowNodes = /* @__PURE__ */ _export_sfc(_sfc_main, [["render", _sfc_render]]);
export {
  __pageData,
  workflowNodes as default
};
