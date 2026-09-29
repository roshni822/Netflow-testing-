import { s as styles_default, b as stateRenderer_v3_unified_default, a as stateDiagram_default, S as StateDB } from "./chunk-IMKFNOWR.By_Saw1V.js";
import { _ as __name } from "../app.tKsvhVRW.js";
import "./chunk-XXDRQBXY.3GnztH_T.js";
import "./chunk-POPQ4Y6H.kJbDET8y.js";
import "./chunk-F27PBJKO.D5tILjBc.js";
import "./framework.CXM-6NNN.js";
import "./theme.BEEB8Cn5.js";
var diagram = {
  parser: stateDiagram_default,
  get db() {
    return new StateDB(2);
  },
  renderer: stateRenderer_v3_unified_default,
  styles: styles_default,
  init: /* @__PURE__ */ __name((cnf) => {
    if (!cnf.state) {
      cnf.state = {};
    }
    cnf.state.arrowMarkerAbsolute = cnf.arrowMarkerAbsolute;
  }, "init")
};
export {
  diagram
};
