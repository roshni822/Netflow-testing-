import { s as styles_default, c as classRenderer_v3_unified_default, a as classDiagram_default, C as ClassDB } from "./chunk-TICWLB2K.MGHLoe3W.js";
import { _ as __name } from "../app.tKsvhVRW.js";
import "./chunk-5VM5RSS4.BgCQibIN.js";
import "./chunk-XXDRQBXY.3GnztH_T.js";
import "./chunk-POPQ4Y6H.kJbDET8y.js";
import "./chunk-F27PBJKO.D5tILjBc.js";
import "./framework.CXM-6NNN.js";
import "./theme.BEEB8Cn5.js";
var diagram = {
  parser: classDiagram_default,
  get db() {
    return new ClassDB();
  },
  renderer: classRenderer_v3_unified_default,
  styles: styles_default,
  init: /* @__PURE__ */ __name((cnf) => {
    if (!cnf.class) {
      cnf.class = {};
    }
    cnf.class.arrowMarkerAbsolute = cnf.arrowMarkerAbsolute;
  }, "init")
};
export {
  diagram
};
