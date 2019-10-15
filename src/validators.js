const request = require('request-promise-native');
const path = require('path');
const { fileExists } = require('./tools');
const { Page, Heading, XrefLink, UrlLink, MailtoLink, Image } = require('./catalog');


class Validator {
    /**
     * Runs one or multiple validations on the page provided, and returns a Promise. That promise will not resolve to
     * any significant value, they'll just act as a marker of completion.
     * @param catalog the catalog instance we're validating
     * @param page a specific page to apply the validations on.
     * @param options The current options as provided to the CLI.
     * @param errorCallback A function that will be called for each validation error, with signature (Element, String),
     * where the 2nd argument is the error message for the element in question.
     */
    validate(catalog, page, options, errorCallback) {
        throw new Error("Abstract method not implemented");
    }
}


class ElementValidator extends Validator {
    constructor(filterFn) {
        super();
        this.filterFn = filterFn;
    }

    async validate(catalog, page, options, errorCallback) {
        return Promise.all(
            page.elements
                .filter(this.filterFn)
                .map(link => this.resolve(link, catalog, options).catch(err => errorCallback(link, err)))
        );
    }
}

class XrefLinkValidator extends ElementValidator {
    constructor() {
        super(link => link instanceof XrefLink);
    }

    async resolve(link, catalog) {
        return new Promise((resolve, reject) => {
            const {slug, anchor} = link;

            if (!slug && !anchor) {
                reject(`Invalid xref format`);
                return;
            }

            const page = slug ? catalog.find(Page.bySlug(slug)) : link.page;

            let target = page;

            if (target === undefined) {
                reject(`Xref does not resolve to a known internal page.`);
                return;
            }

            if (anchor !== undefined) {
                target = page.findElement(Heading.bySlug(anchor));
            }

            if (target === undefined) {
                let suggestion = `section-${anchor}`;
                if (page.findElement(Heading.bySlug(suggestion))) {
                    reject(`Section '${anchor}' wasn't found but a section with a similar slug was found. Did you mean '#${suggestion}'?`);
                } else {
                    reject(`Xref resolves to a known page but section could not be found.`);
                }
                return;
            }

            resolve(target);
        });
    }
}

class MailtoLinkValidator extends ElementValidator {
    constructor() {
        super(link => link instanceof MailtoLink);
    }

    async resolve(link) {
        return new Promise((resolve, reject) => {
            if (!link.href.startsWith('mailto:')) {
                reject('Email links should start with mailto:');
                return;
            }
            resolve(this.href);
        });
    }
}

class HrefValidator extends ElementValidator {

    async resolve(link, catalog, options) {
        if (link.isLocal()) {
            return this.resolveLocal(...arguments);
        } else if (link.isRemote()) {
            return this.resolveRemote(...arguments);
        }
    }

    async resolveLocal(link, catalog, options) {
        const page = link.page;
        const filePath = link.href.split('?')[0];  // relative paths can include '?' as query strings, only keep path
        const fileLocation = path.resolve(options.dir, page.directory, filePath);

        return fileExists(fileLocation)
            .catch(() => { throw `Local file ${fileLocation} does not exist.` });
    }

    async resolveRemote(link) {
        const href = link.href;

        function checkError(err) {
            if ([400, 404, 401, 500].includes(err.statusCode)) {
                throw `URL seems broken: HTTP Status ${err.statusCode}`;
            }
        }

        async function attemptFetch(httpOp) {
            return httpOp(href, {
                headers: {
                    'Accept': '*/*',
                    'User-Agent': 'curl/7.54.0',  // some servers block requests from scripts, attempt cURL impersonation
                }
            });
        }

        // first attempt a HEAD operation
        return attemptFetch(request.head)
            .catch(err => {
                // if HEAD fails with 404, retry with GET
                if (err.statusCode === 404) {
                    return attemptFetch(request.get);
                }
                checkError(err);
            }).catch(err => {
                checkError(err);
                return href;
            })
            .then(resp => href);
    }
}


class HeadingsValidator extends Validator {

    async validate(catalog, page, options, errorCallback) {
        const headings = page.headings.filter(heading => heading.depth === 1);
        headings.forEach(heading => errorCallback(heading,
            'Heading with level 1 are reserved for page titles. ' +
            'Use headings of level 2 and more in content files.'));
    }
}


module.exports = {
    xrefs: new XrefLinkValidator(),
    urls: new HrefValidator(link => link instanceof UrlLink),
    mailtos: new MailtoLinkValidator(),
    images: new HrefValidator(link => link instanceof Image),
    headings: new HeadingsValidator(),
};

