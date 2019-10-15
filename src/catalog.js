const fs = require('fs');
const path = require('path');
const glob = require('glob');
const crypto = require('crypto');
const frontMatter = require('gray-matter');
const marked = require('marked');
const slugify = require('slugify');

class Catalog {
    constructor(pages) {
        this.pages = pages;
    }

    get length() {
        return this.pages.length;
    }

    select(...filters) {
        let pages = this.pages;
        for (const filter of filters) {
            pages = pages.filter(filter);
        }
        return new Catalog(pages);
    }

    find(filter) {
        return this.pages.find(filter);
    }

    static build(dir) {
        const contentFiles = glob.sync(path.join(dir, '**/*.md'));
        const pages = contentFiles.map(file => Page.readFrom(file, dir));

        return new Catalog(pages);
    }

    deletePages(dir, filter) {
        // array of pages is provided
        let pages;
        if (filter instanceof Array) {
            pages = filter;
        } else {
            pages = this.pages.filter(filter);
        }

        pages.forEach(toRemove => {
            this.pages = this.pages.filter(page => page.slug !== toRemove.slug);
            toRemove.delete(dir);
        });
    }
}

class Page {
    constructor(category, parent, slug, content, headers) {
        this.category = category;
        this.parent = parent;
        this.slug = slug;
        this.content = content;
        this.headers = headers;

        this.buildIndex();
    }

    static byPath(filepath) {
        return page => page.path === filepath;
    }

    static bySlug(slug) {
        return page => page.slug === slug;
    }

    static inCategories(categories) {
        return page => categories.includes(page.category);
    }

    static notIn(catalog) {
        return page => catalog.find(Page.byPath(page.path)) === undefined;
    }

    get parentDirectories() {
        return this.parent ? [this.category, this.parent] : [this.category];
    }

    get directory() {
        return path.join(...this.parentDirectories);
    }

    get filename() {
        return `${this.slug}.md`;
    }

    get path() {
        return path.join(...this.parentDirectories, this.filename);
    }

    get ref() {
        return [...this.parentDirectories, this.slug].join(':')
    }

    get hash() {
        return crypto
            .createHash('sha1')
            .update(this.hashData)
            .digest('hex');
    }

    get headings() {
        return this.elements.filter(el => el instanceof Heading);
    }

    get links() {
        return this.elements.filter(el => el instanceof Link);
    }

    get images() {
        return this.elements.filter(el => el instanceof Image)
    }

    get title() {
        return this.headers.title;
    }

    get excerpt() {
        return this.headers.excerpt;
    }

    get hidden() {
        return this.headers.hidden === undefined ? false : this.headers.hidden;
    }

    findElement(filter) {
        return this.elements.find(filter);
    }

    indexOf(str) {
        return this.sources.indexOf(str);
    }

    lineNumberAtCharacter(index) {
        return this.sources.substr(0, index).split('\n').length;
    }

    buildIndex() {
        this.elements = [
            ...Heading.findAll(this),
            ...Link.findAll(this),
        ];
    }

    /**
     * Actual data that is used to compute content hash identity
     * Because the page ID changes between Readme versions, we're leaving it out from the hash computation
     */
    get hashData() {
        // readme.io always strips the last newline from content, so do the same here to prevent unnecessary content
        // updates from hash differences.
        let content = this.content;
        if (content.endsWith('\n')) {
            content = content.substr(0, this.content.length - 1);
        }

        return [
            this.title,
            this.excerpt,
            this.hidden,
            content
        ].join('\n');
    }

    get sources() {
        const frontmatterEntries = [
            ['title', this.title],
            ['excerpt', this.excerpt],
        ];
        if (this.hidden) {
            frontmatterEntries.push(
                ['hidden', 'true']
            )
        }

        const frontMatter = frontmatterEntries.map(([key, value]) => `${key}: "${value}"`).join('\n');

        return `---
${frontMatter}
---
${this.content}`;
    }

    async writeTo(baseDir) {
        return new Promise(resolve => {
            const outputFile = path.join(baseDir, this.path);

            fs.mkdirSync(path.parse(outputFile).dir, {recursive: true});
            fs.writeFile(outputFile, this.sources, (err) => {
                if (err) reject(err);
                else resolve(outputFile);
            });
        });
    }

    delete(dir) {
        fs.unlinkSync(path.join(dir, this.path));
    }

    /**
     * Replace a series of elements with new elements and returns a new page that reflects those replacements.
     *
     * @param replacements An array of replacements, each item containing a two-items array, the first item being the
     * element to replace and the second one its replacement.
     */
    replaceElements(replacements) {
        // because replacing elements may change content length (and thus invalidate pre-calculated element positions),
        // we must start with replacing the element that is the farthest position in content first, then roll up.
        let updatedSources = replacements
            .sort(([el1], [el2]) => el2.position - el1.position)   // sort in descending order of element position
            .reduce((sources, [element, replacement]) => element.replace(sources, replacement.markdown),
                this.sources);

        return Page.create({
            ...this,
            sources: updatedSources
        });
    }

    edit(content) {
        this.content = content;
        return this;
    }

    static create({category, parent, slug, sources}) {
        const matter = frontMatter(sources);
        return new Page(category, parent, slug, matter.content, matter.data);
    }

    static readFrom(file, baseDir) {
        const { dir, name } = path.parse(file);
        const baseDirs = baseDir.split(path.sep);
        const dirs = dir.split(path.sep).filter(part => !baseDirs.includes(part));
        const category = dirs[0];
        let parent;
        if (dirs.length > 1) parent = dirs[1];

        const sources = fs.readFileSync(file, 'utf8');
        return Page.create({category, parent, slug: name, sources});
    }
}

class Element {
    constructor({page, text}) {
        this.page = page;
        this.text = text;
    }

    get ref() {
        return `${this.page.path}:${this.lineNumber}`;
    }

    get lineNumber() {
        return this.page.lineNumberAtCharacter(this.position);
    }

    get desc() {
        throw new Error("Not implemented");
    }

    get position() {
        throw new Error("Not implemented");
    }

    get markdown() {
        throw new Error("Not implemented");
    }

    replace(sources, byText) {
        const before = sources.substr(0, this.position);
        const after = sources.substr(this.position + this.text.length);

        return before + byText + after;
    }

    copy(modifications) {
        return Object.assign(new this.constructor(this), modifications);
    }
}

class Heading extends Element {
    constructor(page, token) {
        super({page, text: token.text});
        this.depth = token.depth;
    }

    get slug() {
        const base = this.text
            .replace('/', ' ')
            .replace('\(', '')
            .replace('\)', '-');
        return 'section-' + slugify(base).toLowerCase();
    }

    get desc() {
        return this.text;
    }

    get position() {
        return this.page.indexOf(this.markdown);
    }

    get markdown() {
        return `${'#'.repeat(this.depth)} ${this.text}`;
    }

    static findAll(page) {
        const found = [];
        const tokens = marked.lexer(page.content);

        return tokens
            .filter(token => token.type === 'heading')
            .map(token => new Heading(page, token));
    }

    static bySlug(slug) {
        return el => el instanceof Heading && el.slug === slug;
    }
}

class Link extends Element {
    constructor({page, text, label, href, title, positionIndex}) {
        super({page, text});
        this.label = label;
        this.href = href;
        this.title = title;
        this.positionIndex = positionIndex;
    }

    get desc() {
        return this.href;
    }

    get position() {
        return this.positionIndex;
    }

    isRemote() {
        return /(https?:)?\/\/.*/.test(this.href);
    }

    isLocal() {
        return !this.isRemote();
    }

    static findAll(page) {
        const links = [];
        const findLinks = /!?\[(?<label>.*?)]\( *<?(?<href>.*?)>?( *["'(](?<title>.*?)["')])? *\)/g;

        let match;
        let sources = page.sources;
        while ((match = findLinks.exec(sources)) !== null) {
            const text = match[0];
            const { href } = match.groups;

            var linkClass;
            if (text.startsWith('!')) {
                linkClass = Image;
            } else {
                linkClass = [
                    MailtoLink,
                    XrefLink,
                    UrlLink,
                ].find(type => type.matches(href))
            }

            if (linkClass === undefined) {
                console.warn(`Link [${href}] does not correspond to a supported type of link.`);
                continue;
            }

            links.push(new linkClass({
                page: page,
                text: match[0],
                positionIndex: match.index,
                ...match.groups,
            }));
        }
        return links;
    }
}


class MailtoLink extends Link {
    static matches(href) {
        return /@/.test(href);
    }
}


class XrefLink extends Link {

    static get regexes() {
        return [
            /^doc:(?<slug>[a-zA-Z0-9-]+)(#(?<anchor>.*))?/,   // doc + anchor
            /^#(?<anchor>.*)/,                                // anchor only
        ];
    }

    constructor(page, text, groups, positionIndex) {
        super(page, text, groups, positionIndex);

        const matchingRegex = XrefLink.firstRegexMatching(this.href);
        const parsedHref = this.href.match(matchingRegex).groups;
        this.slug = parsedHref.slug;
        this.anchor = parsedHref.anchor;
    }

    static firstRegexMatching(href) {
        return XrefLink.regexes.find(regex => regex.test(href));
    }

    static matches(href) {
        return XrefLink.firstRegexMatching(href) !== undefined;
    }
}


class UrlLink extends Link {
    static matches() {
        return true;  // UrlLink acts as a catch all
    }

    get markdown() {
        return this.title ?
            `[${this.label}](${this.href} "${this.title}")`
            : `[${this.label}](${this.href})`;
    }
}


class Image extends UrlLink {
    get markdown() {
        return '!' + super.markdown;
    }
}


module.exports.Catalog = Catalog;
module.exports.Page = Page;
module.exports.Heading = Heading;
module.exports.XrefLink = XrefLink;
module.exports.MailtoLink = MailtoLink;
module.exports.UrlLink = UrlLink;
module.exports.Image = Image;