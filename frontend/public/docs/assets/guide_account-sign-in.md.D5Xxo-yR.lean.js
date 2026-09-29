import { _ as _export_sfc, C as resolveComponent, o as openBlock, c as createElementBlock, a2 as createStaticVNode, b as createBlock, w as withCtx, a as createTextVNode, E as createVNode, a3 as Suspense } from "./chunks/framework.CXM-6NNN.js";
const _imports_0 = "/docs/screenshots/guide/login-workspace.png";
const _imports_1 = "/docs/screenshots/guide/login.png";
const _imports_2 = "/docs/screenshots/guide/forgot-password.png";
const _imports_3 = "/docs/screenshots/guide/reset-password.png";
const _imports_4 = "/docs/screenshots/guide/profile.png";
const _imports_5 = "/docs/screenshots/guide/change-password.png";
const __pageData = JSON.parse('{"title":"Account & sign-in","description":"","frontmatter":{},"headers":[],"relativePath":"guide/account-sign-in.md","filePath":"guide/account-sign-in.md","lastUpdated":1789563169000}');
const _sfc_main = { name: "guide/account-sign-in.md" };
function _sfc_render(_ctx, _cache, $props, $setup, $data, $options) {
  const _component_Mermaid = resolveComponent("Mermaid");
  return openBlock(), createElementBlock("div", null, [
    _cache[3] || (_cache[3] = createStaticVNode("", 9)),
    (openBlock(), createBlock(Suspense, null, {
      default: withCtx(() => [
        createVNode(_component_Mermaid, {
          id: "mermaid-68",
          class: "mermaid",
          graph: "flowchart%20TD%0A%20%20startNode%5B%22Enter%20email%20%2B%20password%22%5D%20--%3E%20check%7B%22Password%20valid%3F%22%7D%0A%20%20check%20--%3E%7Cno%7C%20lock%7B%225%2B%20failed%20attempts%3F%22%7D%0A%20%20lock%20--%3E%7Cyes%7C%20locked%5B%22Account%20locked%20for%2015%20minutes%22%5D%0A%20%20lock%20--%3E%7Cno%7C%20retry%5B%22Show%20error%2C%20try%20again%22%5D%0A%20%20check%20--%3E%7Cyes%7C%20mfa%7B%22MFA%20state%22%7D%0A%20%20mfa%20--%3E%7C%22Enabled%22%7C%20verify%5B%22Enter%206-digit%20code%22%5D%0A%20%20mfa%20--%3E%7C%22Admin%2C%20not%20yet%20set%20up%22%7C%20setup%5B%22Scan%20QR%2C%20enrol%2C%20save%20backup%20codes%22%5D%0A%20%20mfa%20--%3E%7C%22Not%20required%22%7C%20session%5B%22Session%20token%20issued%22%5D%0A%20%20verify%20--%3E%20session%0A%20%20setup%20--%3E%20session%0A%20%20session%20--%3E%20dash%5B%22Dashboard%22%5D%0A"
        })
      ]),
      fallback: withCtx(() => [..._cache[0] || (_cache[0] = [
        createTextVNode(" Loading... ", -1)
      ])]),
      _: 1
    })),
    _cache[4] || (_cache[4] = createStaticVNode("", 14)),
    (openBlock(), createBlock(Suspense, null, {
      default: withCtx(() => [
        createVNode(_component_Mermaid, {
          id: "mermaid-167",
          class: "mermaid",
          graph: "flowchart%20LR%0A%20%20clickBtn%5B%22Click%20Sign%20in%20with%20Microsoft%22%5D%20--%3E%20redirect%5B%22Redirect%20to%20Microsoft%20login%22%5D%0A%20%20redirect%20--%3E%20consent%5B%22Authenticate%20%26%20consent%22%5D%0A%20%20consent%20--%3E%20callback%5B%22Return%20to%20NetFlow%20callback%22%5D%0A%20%20callback%20--%3E%20lookup%7B%22Existing%20active%20user%3F%22%7D%0A%20%20lookup%20--%3E%7Cyes%7C%20token%5B%22NetFlow%20session%20issued%22%5D%0A%20%20lookup%20--%3E%7Cno%7C%20errorNode%5B%22Sign-in%20refused%22%5D%0A%20%20token%20--%3E%20dash%5B%22Dashboard%22%5D%0A"
        })
      ]),
      fallback: withCtx(() => [..._cache[1] || (_cache[1] = [
        createTextVNode(" Loading... ", -1)
      ])]),
      _: 1
    })),
    _cache[5] || (_cache[5] = createStaticVNode("", 20)),
    (openBlock(), createBlock(Suspense, null, {
      default: withCtx(() => [
        createVNode(_component_Mermaid, {
          id: "mermaid-320",
          class: "mermaid",
          graph: "flowchart%20TD%0A%20%20login%5B%22Login%20page%22%5D%20--%3E%20pwd%7B%22Password%20OK%3F%22%7D%0A%20%20pwd%20--%3E%7Cno%7C%20fail%5B%22Error%22%5D%0A%20%20pwd%20--%3E%7Cyes%7C%20mfa%7B%22MFA%20required%3F%22%7D%0A%20%20mfa%20--%3E%7Csetup%7C%20qr%5B%22Scan%20QR%20%2B%20backup%20codes%22%5D%0A%20%20mfa%20--%3E%7Cverify%7C%20code%5B%22Enter%206-digit%20code%22%5D%0A%20%20mfa%20--%3E%7Cno%7C%20force%7B%22Forced%20password%20change%3F%22%7D%0A%20%20qr%20--%3E%20force%0A%20%20code%20--%3E%20force%0A%20%20force%20--%3E%7Cyes%7C%20newpwd%5B%22Set%20new%20password%22%5D%0A%20%20force%20--%3E%7Cno%7C%20app%5B%22Dashboard%22%5D%0A%20%20newpwd%20--%3E%20app%0A"
        })
      ]),
      fallback: withCtx(() => [..._cache[2] || (_cache[2] = [
        createTextVNode(" Loading... ", -1)
      ])]),
      _: 1
    }))
  ]);
}
const accountSignIn = /* @__PURE__ */ _export_sfc(_sfc_main, [["render", _sfc_render]]);
export {
  __pageData,
  accountSignIn as default
};
