# vite-plugin-proteus

Import Markdown files as structured data objects in Vite projects.

## Installation

```bash
bun add vite-plugin-proteus -D
# or
npm install vite-plugin-proteus -D
```

## Usage

Add the plugin to your `vite.config.ts`:

```ts
import { proteusPlugin } from 'vite-plugin-proteus';

export default {
  plugins: [proteusPlugin()]
}
```

Then import Markdown files in your source code:

```ts
import { data, content, toc } from './post.md';

console.log(data.title);
console.log(content);
```

## Options
Supports all [Proteus ParseOptions](../../README.md#parseoptions).

```ts
proteusPlugin({
  include: [/\.md$/],
  strict: false,
  extractToc: true
})
```

## License
[Apache-2.0](../../LICENSE)
