const fs = require("fs-extra");
const path = require("path");
const { logger, globby, sort } = require("@vuepress/shared-utils");

const convertRouterLinkPlugin = require("./lib/link");
const {
  generateVersionedPath,
  snapshotSidebar,
  updateSidebarConfig,
} = require("./lib/util");
const versionManager = require("./lib/version-manager");

module.exports = (options, context) => {
  // 插件名称
  const pluginName = "nonebot/versioning";

  // 存档位置
  const versionedSourceDir =
    options.versionedSourceDir ||
    path.resolve(context.sourceDir, "website", "versioned_docs");
  // 额外页面位置
  const pagesSourceDir =
    options.pagesSourceDir ||
    path.resolve(context.sourceDir, "website", "pages");

  // 存档版本文件位置
  const versionsFilePath = path.join(
    context.sourceDir,
    ".vuepress",
    "versions.json"
  );
  // 加载存档版本
  versionManager.loadVersions(versionsFilePath);
  // 存档版本数组
  const versions = versionManager.versions;

  const defaultPluginOptions = {
    name: pluginName,

    /**
     * 读取镜像设置并且处理版本信息
     * Reads in the snaphotted sidebar configs and rewrites them to be versioned
     */
    ready() {
      // 将所有版本设置存入 themeConfig.versionedSidebar
      const currentVersion = versions[0];
      context.themeConfig.versionedSidebar = {};

      context.themeConfig.sidebar = context.themeConfig.sidebar || {};
      context.themeConfig.locale = context.themeConfig.locale || {};
      context.themeConfig.nextSidebar = {
        sidebar: JSON.parse(JSON.stringify(context.themeConfig.sidebar)),
        locale: JSON.parse(JSON.stringify(context.themeConfig.locale)),
      };

      // 更新当前设置
      const sidebarConfig = {
        sidebar: JSON.parse(JSON.stringify(context.themeConfig.sidebar)),
        locale: JSON.parse(JSON.stringify(context.themeConfig.locale)),
      };
      updateSidebarConfig(sidebarConfig, "next");
      context.themeConfig.versionedSidebar.next = sidebarConfig;
      Object.assign(context.themeConfig.sidebar, sidebarConfig.sidebar || {});
      Object.assign(context.themeConfig.locale, sidebarConfig.locale || {});

      // 更新存档版本设置
      for (const version of versions) {
        const versionSidebarConfigPath = path.join(
          versionedSourceDir,
          version,
          "sidebar.config.json"
        );
        if (!fs.existsSync(versionSidebarConfigPath)) {
          continue;
        }
        const sidebarConfig = JSON.parse(
          fs.readFileSync(versionSidebarConfigPath).toString()
        );

        // 非当前版本更新路径
        if (version !== currentVersion) {
          updateSidebarConfig(sidebarConfig, version);
        }
        context.themeConfig.versionedSidebar[version] = sidebarConfig;
        Object.assign(context.themeConfig.sidebar, sidebarConfig.sidebar || {});
        Object.assign(context.themeConfig.locale, sidebarConfig.locale || {});
      }
    },

    /**
     * 扩展 cli 命令 -- version
     * Extends the cli with new commands to manage versions
     */
    extendCli(cli) {
      cli
        .command("version <targetDir> <version>", "Draft a new version")
        .allowUnknownOptions()
        .action(async (dir, version) => {
          if (versions.includes(version)) {
            logger.error(
              `Version ${version} already exists in version.json. Please use a different version.`
            );
            return;
          }

          logger.wait(`Creating new version ${version} ...`);

          const versionDestPath = path.join(versionedSourceDir, version);
          await fs.copy(context.sourceDir, versionDestPath, {
            filter: (src, dest) => {
              if (src === context.vuepressDir) {
                return false;
              }

              return true;
            },
          });

          await snapshotSidebar(context.siteConfig, versionDestPath);
          if (typeof options.onNewVersion === "function") {
            await options.onNewVersion(version, versionDestPath);
          }

          versions.unshift(version);
          await fs.writeFile(
            versionsFilePath,
            JSON.stringify(versions, null, 2)
          );

          logger.success(`Snapshotted your current docs as version ${version}`);
          logger.tip(`You can find them under ${versionDestPath}`);
        });
    },

    /**
     * 添加存档版本以及额外页面路由
     * Adds additional pages from versioned docs as well as unversioned extra pages.
     */
    async additionalPages() {
      const patterns = ["**/*.md", "**/*.vue", "!.vuepress", "!node_modules"];

      const addPages = (pageFiles, basePath) => {
        const pages = [];
        pageFiles.map((relative) => {
          const filePath = path.resolve(basePath, relative);
          pages.push({
            filePath,
            relative,
          });
        });
        return pages;
      };

      let versionedPages = [];
      try {
        await fs.access(versionedSourceDir);
        const versionedPageFiles = sort(
          await globby(patterns, { cwd: versionedSourceDir })
        );
        versionedPages = addPages(versionedPageFiles, versionedSourceDir);
      } catch (err) {}

      let pages = [];
      try {
        await fs.access(pagesSourceDir);
        const pageFiles = sort(await globby(patterns, { cwd: pagesSourceDir }));
        pages = addPages(pageFiles, pagesSourceDir);
      } catch (err) {}

      return [...versionedPages, ...pages];
    },

    /**
     * Marks unversioned pages from the pageSourceDir
     *
     * @param {Object} page VuePress page object
     */
    extendPageData(page) {
      if (!page._filePath) {
        return;
      }

      if (page._filePath.startsWith(pagesSourceDir)) {
        page.unversioned = true;
      }
    },
  };

  if (versions.length === 0) {
    return defaultPluginOptions;
  }

  return Object.assign(defaultPluginOptions, {
    /**
     * Extends and updates a page with additional information for versioning support.
     */
    extendPageData(page) {
      const currentVersion = versions[0];
      if (!page._filePath) {
        return;
      }

      if (page._filePath.startsWith(versionedSourceDir)) {
        const version = page._filePath.substring(
          versionedSourceDir.length + 1,
          page._filePath.indexOf("/", versionedSourceDir.length + 1)
        );
        page.version = version;
        page.originalRegularPath = page.regularPath;
        if (version === currentVersion) {
          page.path = page.regularPath = page.path.replace(
            new RegExp(`^/${version}`),
            ""
          );
        }
      } else if (page._filePath.startsWith(pagesSourceDir)) {
        page.unversioned = true;
      } else if (page._filePath.startsWith(context.sourceDir)) {
        page.version = "next";
        page.originalRegularPath = page.regularPath;
        page.path = page.regularPath = generateVersionedPath(
          page.path,
          page.version,
          page._localePath
        );
      }
    },

    /**
     * Enhances the app with a globally accessible list of available versions.
     *
     * @fixme ideally this should go into siteData but that is not extendable
     * right now so store versions as a computed property on Vue
     */
    enhanceAppFiles: [
      {
        name: "versions-site-data",
        content: `export default ({ Vue }) => {
  Vue.mixin({
    computed: {
      $versions: () => ${JSON.stringify(versions)}
    }
  })
}`,
      },
    ],

    /**
     * Replaces the default convert-router-link plugin from VuePress with a
     * modified one that knows how to properly handle relative links for the
     * rewritten paths of versioned pages.
     *
     * @param {*} config
     */
    chainMarkdown(config) {
      config.plugins.delete("convert-router-link");
      const { externalLinks } = context.siteConfig.markdown || {};
      config
        .plugin("convert-router-link-versioned")
        .use(convertRouterLinkPlugin, [
          {
            externalAttrs: Object.assign(
              {
                target: "_blank",
                rel: "noopener noreferrer",
              },
              externalLinks
            ),
            sourceDir: context.sourceDir,
            versionedSourceDir,
            pagesSourceDir,
            locales: Object.keys(context.siteConfig.locales || {}).filter(
              (l) => l !== "/"
            ),
          },
        ])
        .end();
    },
  });
};
