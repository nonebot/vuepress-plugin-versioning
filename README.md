# vuepres-plugin-versioning

Versioning plugin for VuePress

Inspired by <https://github.com/appcelerator/docs-devkit/>

## Usage

Install the plugin

```bash
npm i -D git+https://github.com/nonebot/vuepress-plugin-versioning
```

and enable it in your .vuepress/config.js

```js
module.exports = {
  plugins: ["versioning"],
};
```

Config plugin

```js
const path = require("path");
const fs = require("fs-extra");

module.exports = (context) => ({
  plugins: [
    [
      "versioning",
      {
        // Dir to store achieved version docs
        versionedSourceDir: path.resolve(context.sourceDir, "..", "archive"),
        // Dir to store extra pages that not within versioning
        pagesSourceDir: path.resolve(context.sourceDir, "..", "pages"),
        async onNewVersion(
          version /*version str*/,
          versionDestPath /*version dir*/
        ) {
          // Copy extra files on achieve
          return fs.copy(
            context.sourceDir,
            "api.json",
            path.join(versionDestPath, "api.json")
          );
        },
      },
    ],
  ],
});
```

## Routing

Once you have created your first version, the plugin will change the default routing to the latest achieved version. Docs in the vuepress source directory will be considered as part of the version `next` and they are available under the URL `/next/`. All other versions will be available under their respective version number like `/1.0.0/`.

## Access Version Data

The plugin will automatically store the version information in the page metadata. You can access it in components via `this.$page.version`. To get a list of all versions that are currently available you can use `this.$versions`
