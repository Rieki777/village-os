/**
 * The animation engine, loaded after the first page instead of with it.
 *
 * framer-motion's `motion.div` carries every feature it has (animation,
 * gestures, in-view, drag, layout projection), about 130 KB minified, and the
 * shell (App, Layout, Home, Login) imported it statically, so every visitor
 * paid for it before the page could start. Those four now render the slim
 * `m` components inside `<LazyMotion features={loadMotionFeatures}>`, and this
 * is the only door to the engine: App.tsx imports it dynamically, fetched once
 * the app has mounted. Nothing may import this file statically, or the engine
 * is back on the first page; lazyMotion.test.ts reads the build to hold that.
 *
 * `domAnimation` is the subset the shell uses: animate, exit, whileInView,
 * hover and tap. A lazy page that still renders `motion.*` brings its own full
 * copy in its own chunk, which is how it worked before.
 */
import { domAnimation } from "framer-motion";

export default domAnimation;
