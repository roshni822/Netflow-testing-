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
    _cache[4] || (_cache[4] = createStaticVNode("", 18))
  ]);
}
const onboarding = /* @__PURE__ */ _export_sfc(_sfc_main, [["render", _sfc_render]]);
export {
  __pageData,
  onboarding as default
};
