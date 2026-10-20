// Animation features (layout, drag, gestures) are loaded after the first render to keep the
// initial bundle small; until then components render statically without animating.
import { domMax } from 'framer-motion'
export default domMax
