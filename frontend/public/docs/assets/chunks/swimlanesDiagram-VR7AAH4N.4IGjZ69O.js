import { c as createFlowDiagram, s as styles_default } from "./flowDiagram-HODETNUW.B6Dvusru.js";
import { _ as __name } from "../app.tKsvhVRW.js";
import "./chunk-5VM5RSS4.BgCQibIN.js";
import "./chunk-XXDRQBXY.3GnztH_T.js";
import "./chunk-POPQ4Y6H.kJbDET8y.js";
import "./chunk-F27PBJKO.D5tILjBc.js";
import "./channel.BJkKGvMC.js";
import "./framework.CXM-6NNN.js";
import "./theme.BEEB8Cn5.js";
var getStyles = /* @__PURE__ */ __name((options) => `${styles_default(options)}
  .swimlane.cluster rect {
    stroke: ${options.clusterBorder} !important;
  }
  [data-look="neo"].cluster rect {
    filter: none;
  }
`, "getStyles");
var styles_default2 = getStyles;
var diagram = createFlowDiagram({ defaultLayout: "swimlane", styles: styles_default2 });
export {
  diagram
};
