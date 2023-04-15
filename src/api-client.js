const chalk = require("chalk");
const request = require("request-promise-native");

const { flatten } = require("./tools");
const { Page } = require("./catalog");

const API_ROOT = "https://dash.readme.io/api/v1";

class Api {
  constructor(apiKey, version, catalog, options) {
    this.apiKey = apiKey;
    this.version = version;
    this.catalog = catalog;
    this.options = options;
  }

  get httpOptions() {
    return {
      auth: { user: this.apiKey },
      headers: {
        "x-readme-version": this.version,
      },
      json: true,
    };
  }

  async loadPage(slug) {
    return request.get(`${API_ROOT}/docs/${slug}`, this.httpOptions);
  }

  /**
   * Deletes a remote page by its slug.
   * @param slug Slug of the page to delete.
   * @returns {Promise<void>}
   */
  async deletePage(slug) {
    if (this.options.dryRun) {
      console.log(
        chalk.dim(`DRY RUN: Would delete page [${slug}] from readme.io`)
      );
      return Promise.resolve();
    } else {
      await request.delete(`${API_ROOT}/docs/${slug}`, this.httpOptions);
      console.log(chalk.green(`Deleted page [${slug}] from readme.io`));
    }
  }

  /**
   * Fetches all pages of the provided categories, calling the `callback` function for each page loaded.
   * @param categories List of categories slugs to load pages from.
   * @param callback A function accepting a single Page parameter.
   */
  async fetchPages(categories, callback) {
    let pages = [];
    for (const category of categories) {
      const pagesInCategory = await request.get(
        `${API_ROOT}/categories/${category}/docs`,
        this.httpOptions
      );
      for (const json of pagesInCategory) {
        pages.push(this.fetchPage(json, category, undefined, callback));
      }
    }
    // once the Promise resolves, the result will actually be a nested array representing the page hierarchy
    // we flatten it so that the final result is actually an Array of Page objects
    return Promise.all(pages).then((pageTree) => flatten(pageTree));
  }

  async fetchPage(pageJson, category, parent, callback) {
    const slug = pageJson.slug;
    const docDetails = await this.loadPage(slug);

    let page = Api.jsonToPage(docDetails, category, parent);

    if (callback) {
      page = await callback(page);
    }

    let pages = [Promise.resolve(page)];
    const children = pageJson.children;
    if (children) {
      for (const child of children) {
        pages = pages.concat(this.fetchPage(child, category, page, callback));
      }
    }
    return Promise.all(pages);
  }

  async pushPage(localPage) {
    if (this.options.hidden) {
      localPage.hidden = this.options.hidden;
    }
    try {
      const pageJson = await this.loadPage(localPage.slug);

      const remotePage = Api.jsonToPage(pageJson);

      if (!this.options.force && remotePage.hash === localPage.hash) {
        console.log(
          chalk.cyan(
            `Contents of page [${localPage.slug}] was not pushed because contents are the same.`
          )
        );
        return;
      }

      this.updatePage(localPage, pageJson, this.options);
    } catch (e) {
      if (e.statusCode === 404) {
        this.createPage(localPage, this.options);
      }
    }
  }

  async updatePage(localPage, pageJson) {
    if (this.options.dryRun) {
      console.log(
        chalk.dim(
          `DRY RUN: Would update contents of [${localPage.ref}] to readme.io`
        )
      );
    } else {
        await request.put(`${API_ROOT}/docs/${localPage.slug}`, {
          ...this.httpOptions,
          json: Object.assign(pageJson, {
            ...this.pageToJson(localPage),
            lastUpdatedHash: localPage.hash,
          }),
        })
        .catch((error) => {
          console.log(error.message);
          process.exit(1);
        });

        console.log(
          chalk.green(
            `Updated 2 contents of existing page [${localPage.ref}] on readme.io`
          )
        );
    }
  }

  async createPage(localPage) {
    const category = await this.loadCategory(localPage.category);
    let parentPage;
    if (localPage.parent) {
      console.log(
        chalk.dim(
          `Making sure parent page with slug [${localPage.parent}] exists on readme.io...`
        )
      );
      await this.ensurePageExists(localPage.parent);
      parentPage = await this.loadPage(localPage.parent);
    }

    let postJson = {
      ...this.pageToJson(localPage),
      category: category._id,
      parentDoc: parentPage ? parentPage._id : null,
      slug: localPage.slug,
      lastUpdatedHash: localPage.hash,
    };

    if (this.options.dryRun) {
      console.log(
        chalk.dim(`DRY RUN: Would create page [${localPage.ref}] on readme.io`)
      );
    } else {
        await request.post(`${API_ROOT}/docs`, {
          ...this.httpOptions,
          json: postJson,
        })
        .catch((error) => {
          console.log(error.message);
          process.exit(1);
        });

        console.log(chalk.green(`Created page [${localPage.ref}] on readme.io`));
    }
  }

  async ensurePageExists(slug) {
    const localPage = this.catalog.find(Page.bySlug(slug));
    if (!localPage) {
      throw new Error(`No page with slug ${slug} exists in the local catalog.`);
    }
    await this.pushPage(localPage);
  }

  async loadCategory(slug) {
    return await request.get(
      `${API_ROOT}/categories/${slug}`,
      this.httpOptions
    );
  }

  /**
   * Converts JSON received from the Readme API to a `Page` object instance.
   * @param json The JSON object loaded from the API.
   * @param category An optional category to assign to the page (string)
   * @param parent An optional parent `Page` object.
   * @returns {Page}
   */
  static jsonToPage(json, category, parent) {
    const headers = {
      title: json.title,
      excerpt: json.excerpt,
      hidden: json.hidden,
      next: undefined,
    };

    if (json.next.pages.length > 0) {
      headers.next = {
        pages: json.next.pages.map((page) => page.slug),
        description: json.next.description,
      };
    }

    return new Page(
      category,
      parent ? parent.slug : null,
      json.slug,
      json.body,
      headers
    );
  }

  /**
   * Converts a `Page` object instance to JSON that ReadMe accepts as inputs for page modifications.
   * @param page The local page to represent for the ReadMe API.
   */
  pageToJson(page) {
    const json = {
      title: page.title,
      excerpt: page.excerpt,
      hidden: page.hidden,
      body: page.content,
      next: {
        pages: [],
        description: "",
      },
    };

    if (page.headers.next) {
      json.next = Object.assign(json.next, page.headers.next);
      if (json.next.pages) {
        // resolve each referenced page in local catalog and derive data
        json.next.pages = json.next.pages
          .map((slug) => this.catalog.find(Page.bySlug(slug)))
          .filter((page) => page !== undefined)
          .map((resolvedPage) => {
            return {
              slug: resolvedPage.slug,
              name: resolvedPage.title,
              icon: "file-text-o",
              type: "doc",
            };
          });
      }
    }

    return json;
  }
}

module.exports.Api = Api;
