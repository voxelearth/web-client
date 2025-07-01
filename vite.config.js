import { defineConfig }  from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import pathBrowserify    from 'path-browserify'

export default defineConfig({
  build: { target: 'es2020' },

  plugins: [ nodePolyfills() ],

  resolve: { alias: { path: pathBrowserify } },

  define: {                //  ←   ONLY literals here
    global: 'globalThis',
    '__dirname': '"./"', //  optional – can omit
  },

  optimizeDeps: {
    esbuildOptions: { target: 'es2020' }
  }
})
