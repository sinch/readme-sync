const path = require('path');
const fs = require('fs');
const { URL } = require('url');

const { UrlLink } = require('./catalog');


/**
 * Content Filters allow a different representation of content on Readme.io than in local `.md` files. Filters will
 * be invoked before pushing to Readme and after fetching from it.
 *
 * During those 2 specific phases, filters can alter page content as they see fit and return either the original
 * page or a copy of that page.
 *
 * The transformations applied to content pages should be symmetrical: pushing a page to Readme with a filter enabled
 * followed by fetching that same page from Readme should result in the exact same local content. Hence why each filter
 * implemented should not only implement the filtering itself, but also a way to roll it back.
 */
class Filter {
    constructor(config) {
        this.config = config;
    }

    async apply(page) {
        throw new Error("Not implemented");
    }

    async rollback(page) {
        throw new Error("Not implemented");
    }
}

/**
 * This filter enables the hosting of files (like images and other content files) on a publicly accessible Web server.
 * All relative URLs will be transformed to their corresponding public URL on the way to Readme and then transformed
 * back to their relative representation on the way back.
 *
 * All relative paths in content should be specified as relative to the page's `.md` file location in the project
 * directories and it is assumed that content files will be published at the exact same location on the public Web
 * server.
 */
class HostedFilesFilter extends Filter {

    apply(page) {
        const replacements = [];

        for (const link of page.links.filter(link => link instanceof UrlLink && link.isLocal())) {
            const localFilePath = path.join(page.directory, link.href);
            const hostingUrl = new URL(localFilePath, this.config.baseUrl);

            replacements.push([link, link.copy({href: hostingUrl.toString()})]);
        }
        return Promise.resolve(page.replaceElements(replacements));
    }

    rollback(page) {
        const replacements = [];

        for (const link of page.links.filter(link => link instanceof UrlLink && link.isRemote())) {
            if (link.href.startsWith(this.config.baseUrl)) {
                const localFilePath = decodeURI(link.href.substr(this.config.baseUrl.length));
                const relativePath = path.relative(page.directory, localFilePath);

                replacements.push([link, link.copy({href: relativePath})]);
            }
        }
        return Promise.resolve(page.replaceElements(replacements));
    }
}

/**
 *
 * todo: individual filters should be put in separate source files.
 */
const Mustache = require('mustache');
const { asyncStringReplace } = require("./tools");

/**
 * Represents a section of content that is marked so that it can be located easily and reliably.
 * Stub Markdown "comments" are used to delimit content as described here: https://stackoverflow.com/questions/4823468/comments-in-markdown
 */
class ContentMarker {
    constructor(name) {
        this.name = name;
        this.regex = new RegExp(`\\n\\[${name}\\]: #((.|[\\r\\n])*)\\[\\/${name}\\]: #`, 'gm');
    }

    wrap(content) {
        return `\n[${this.name}]: #\n${content}\n\n[/${this.name}]: #`;
    }

    async replaceAll(content, replacementFn) {
        return await asyncStringReplace(content, this.regex, replacementFn);
    }
}


/**
 * Renders a Mustache template as the footer of all content files.
 *
 * The Mustache template is rendered with an object that includes the following attributes:
 *
 *  - `page`: The page object being rendered.
 *
 * Additionally, all of the filter's configuration attributes are also passed to the template so they can be used
 * directly.
 */
class FooterFilter extends Filter {
    constructor(config) {
        super(config);
        this.marker = new ContentMarker('footer');
    }

    apply(page) {
        const view = {
            page,
            ...this.config,
        };

        return new Promise((resolve, reject) => {
            fs.readFile(this.config.template, (err, data) => {
                if (err) reject(err);

                const rendered = Mustache.render(data.toString(), view);
                resolve(page.edit(page.content + this.marker.wrap(rendered)));
            });
        });
    }

    async rollback(page) {
        const newContent = await this.marker.replaceAll(page.content, () => '');
        return page.edit(newContent);
    }
}


module.exports = {
    hostedFiles: HostedFilesFilter,
    footer: FooterFilter,
};
