#!/usr/bin/env node

require('dotenv').config();

const program = require('commander');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const stagedGitFiles = require('staged-git-files');
const chalk = require('chalk');
const readlineSync = require('readline-sync');

const { Catalog, Page } = require('../src/catalog');
const { Api } = require('../src/api-client');
const markdownize = require('../src/markdownize');
const availableValidators = require('../src/validators');
const availableFilters = require('../src/filters');
const tools = require('../src/tools'); 

const DEFAULT_CONFIG_FILE = 'config.yml';
const DEFAULT_DOCS_DIR = 'docs';
const CONFIG_APIKEY = 'apikey';
const CONFIG_DOCSVERSION = 'docsversion';

program.description(
    `
Tools to sync content back and forth between a local Git repository and a remote ReadMe-published documentation site.
    
Global options \`apikey\` and \`docsversion\` must always be provided for each command. They can be provided in the following ways:
  - Directly in the command line as --apikey and --docsversion global options (they should appear before the command name)
  - As environment variables (APIKEY or DOCSVERSION). Dotenv is supported (environment variables in .env file). 
`);

program.option(
    `-k, --${CONFIG_APIKEY} <${CONFIG_APIKEY}>`,
    `Your API key for ReadMe (required)`,
        key => process.env.APIKEY = key);
program.option(`-v, --${CONFIG_DOCSVERSION} <${CONFIG_DOCSVERSION}>`,
    `Documentation version to act upon (required)`,
        version => process.env.DOCSVERSION = version);
program.option(`-c, --config [config]`,
    `Path to the YAML configuration file. Defaults to ${DEFAULT_CONFIG_FILE}`,
        config => process.env.CONFIG_FILE = config);

program
    .command('fetch [category_slugs]')
    .description(`
Fetches up-to-date Markdown content files from ReadMe, overwriting local files with the content fetched.
When called with a comma-delimited list of category slugs, only pages from those categories will be fetched.

After crawling remote pages, the contents of the local catalog will be analyzed to find stale pages (pages present
locally but not present on Readme). If any are found, the program will offer to prune them.
`)
    .option('-d, --dir <dir>', 'Destination directory where docs Markdown files will be written', DEFAULT_DOCS_DIR)
    .action(async (slug, cmd) => {
        const options = {
            config: loadConfigYaml(),
            dir: cmd.dir,
            categories: slug,
        };

        const modifiedContentFiles = (await stagedGitFiles())
            .map(details => details.filename)
            .filter(file => file.startsWith(options.dir));

        if (modifiedContentFiles.length > 0) {
            console.log(chalk.yellow(modifiedContentFiles.join('\n')));
            if (!readlineSync.keyInYN('The above files have staged changes that could be overwritten. Are you sure you want to proceed?')) {
                return;
            }
        }

        // build the catalog from local content files
        let catalog = Catalog.build(options.dir);
        catalog = await selectPages(catalog, options);

        const readme = apiClient(catalog, options);

        let fetchedPages = await readme.fetchPages(listCategories(options.categories, options.config), async page => {
            for (const filter of createFilters(options.config)) {
                page = await filter.rollback(page);
            }

            const outputFile = await page.writeTo(cmd.dir);
            console.log(chalk.green(`Wrote contents of doc [${page.ref}] to file [${outputFile}]`));

            return page;
        });

        let fetchedPagePaths = fetchedPages.map(page => page.path);

        const staleLocalPages = catalog.pages.filter(page => !fetchedPagePaths.includes(page.path));

        if (staleLocalPages.length > 0) {
            console.log(chalk.yellow(`WARNING: Found ${staleLocalPages.length} possibly stale local content pages; they were not fetched after crawling Readme:`));
            staleLocalPages.forEach(page => console.log(chalk.yellow(` - ${page.ref}`)));

            if (readlineSync.keyInYN(chalk.yellow(`They might have been deleted or moved. Do you want to prune these pages?`))) {
                catalog.deletePages(options.dir, staleLocalPages);
            }
        }
    });

program
    .command('push [category_slugs]', )
    .description(`
Updates pages published on ReadMe using the local Markdown content files. 
When called with a comma-delimited list of category slugs, only those categories will be pushed.
`)
    .option('-d, --dir <dir>', `Directory where the Markdown content files will be loaded from.`, DEFAULT_DOCS_DIR)
    .option('-f, --file <file>', `Path to a single file to process, relative to the directory specified with -d/--dir option.`)
    .option('--staged-only', `Only push files staged files that have been modified. Important: files must have been added to the index with 'git add'`)
    .option('--prune', `When enabled, remote pages that do not exist locally will be pruned (deleted).`)
    .option('--dry-run', `No remote content will be updated but command output will show what would be done.`)
    .action(async (slug, cmd) => {
        const options = {
            config: loadConfigYaml(),
            dir: cmd.dir,
            file: cmd.file,
            categories: slug,
            stagedOnly: cmd.stagedOnly,
            dryRun: cmd.dryRun,
            prune: cmd.prune,
        };

        const fullCatalog = Catalog.build(options.dir);
        const readme = apiClient(fullCatalog, options);

        const catalog = await selectPages(fullCatalog, options);
        if (catalog.length === 0) {
            console.warn('No files to found to push.');
            return;
        }

        for (let page of catalog.pages) {
            for (const filter of createFilters(options.config)) {
                page = await filter.apply(page);
            }

            readme.pushPage(page);
        }

        if (options.prune) {
            // Compare local catalog with remote catalog (taking care of filtering pages as they were locally)
            let remotePages = await readme.fetchPages(listCategories(options.categories, options.config));
            let remoteCatalog = new Catalog(remotePages);
            remoteCatalog = await selectPages(remoteCatalog, options);

            const toPrune = remoteCatalog.select(Page.notIn(catalog));

            // Then prune all pages present remotely that could not be found locally
            for (const page of toPrune.pages) {
                readme.deletePage(page.slug);
            }
        }
    });

program
    .command('markdownize [category_slugs]', )
    .description(`
Converts proprietary Readme widgets to standard Markdown.
`)
    .option('-d, --dir <dir>', `Directory where the Markdown content files will be loaded from.`, DEFAULT_DOCS_DIR)
    .option('-f, --file <file>', `Path to a single file to process, relative to the directory specified with -d/--dir option.`)
    .option('-w, --widgets <widgets>', `Comma-separated list of Readme widgets to replace to Markdown. Supported widgets: 'code', 'callout', 'image', 'html'`)
    .option('-v, --verbose', `Output more details about the replacements being made.`)
    .option('--no-download', `[For 'image' widgets only] Do not download remote image files to the local repository and replace URLs with relative paths to those files.`)
    .option('--download-from <hostname>', `[For 'image' widgets only] Download images from specified host only.`, 'files.readme.io')
    .option('--dry-run', `Will only output modifications that would be made, without actually saving them.`)
    .action(async (slug, cmd) => {
        const options = {
            config: loadConfigYaml(),
            dir: cmd.dir,
            file: cmd.file,
            categories: slug,
            widgets: cmd.widgets ? cmd.widgets.split(',') : markdownize.widgetTypes,
            dryRun: cmd.dryRun,
            verbose: cmd.dryRun || cmd.verbose,
            download: cmd.download,
            downloadFrom: cmd.downloadFrom,
        };

        let catalog = Catalog.build(options.dir);
        catalog = await selectPages(catalog, options);
        if (catalog.length === 0) {
            console.warn('No files to found to markdownize.');
            return;
        }

        for (const page of catalog.pages) {
            const updated = await markdownize.markdownize(page, options.widgets, options);
            if (!options.dryRun) {
                if (page.content !== updated) {
                    page.content = updated;
                    console.log(chalk.green(`Writing updated Markdown to [${page.path}]`));
                    page.writeTo(options.dir);
                }
            }
        }
    });

program
    .command('validate [category_slugs]', )
    .description(`
Validates Markdown content files.

The following validators are available:

 - 'urls':         Verifies that URLs do resolve to an existing target. An HTTP HEAD request is performed for each URL.
 - 'xrefs':        Verifies that internal cross references point to known content.
 - 'mailtos':      Verifies that mailto: links (links to email addresses) are correctly formed.
 - 'headings':     Verifies that section headings are at minimum 2 levels deep
 - 'images':       Verifies that images (either specified with a relative path or with a remote URL) do exist.
 - 'whatsnext':    Verifies that pages references listed in 'next' front matter point to known content pages.

All validations are performed unless --validations is specified.
`)
    .option('-d, --dir <dir>', `Directory where the Markdown content files will be loaded from.`, DEFAULT_DOCS_DIR)
    .option('-f, --file <file>', `Path to a single file to process, relative to the directory specified with -d/--dir option.`)
    .option('--validators <validators>', `Comma-delimited list of validators to run. See command help for supported validators.`)
    .option('--staged-only', `Only validate Git staged files. Important: files must have been added to the index with 'git add' for this to work.`)
    .option('--no-fail', `By default, the command will exit with an error code if any validation errors are found. With this flag, the exit code will always be 0 (success).`)
    .action(async (slug, cmd) => {
        const options = {
            config: loadConfigYaml(),
            dir: cmd.dir,
            file: cmd.file,
            categories: slug,
            stagedOnly: cmd.stagedOnly,
            validators: cmd.validators,
            fail: cmd.fail,
        };

        let entireCatalog = Catalog.build(options.dir);

        let pages = (await selectPages(entireCatalog, options)).pages;
        if (pages.length === 0) {
            console.warn('No files to found to validate.');
            return;
        }

        let selectedValidators = selectValidators(options);

        // Execute validations and compile stats
        let promises = [];
        let errorCount = 0;
        for (const page of pages) {
            for (const validator of selectedValidators) {
                promises.push(
                    validator.validate(entireCatalog, page, options, (element, err) => {
                        console.log(`${chalk.cyan(element.ref)} [${chalk.yellow(element.desc)}]: ${err}`);
                        errorCount++;
                    }))
                ;
            }
        }

        // Wait until all validations are completed, then output stats and optionally exit with error code
        Promise.all(promises).then(() => {
            if (errorCount > 0) {
                let color = options.fail ? chalk.red : chalk.yellow;
                console.log(color(`${errorCount} validation errors were found in catalog.`));
                if (options.fail) {
                    process.exitCode = 1;
                }
            } else {
                console.log(chalk.green(`No validation errors found.`));
            }
        });
    });

program.parse(process.argv);


function apiClient(catalog, options) {
    return new Api(globalOption(CONFIG_APIKEY), globalOption(CONFIG_DOCSVERSION), catalog, options);
}


async function selectPages(catalog, options) {
    const filters = [];
    if (options.file) {
        console.log(Page.byPath(options.file));
        filters.push(Page.byPath(options.file));
    } else {
        filters.push(Page.inCategories(listCategories(options.categories, options.config)));
    }

    if (options.stagedOnly) {
        const stagedFiles = await stagedGitFiles();
        let stagedFilePaths = stagedFiles.map(stagedFile => stagedFile.filename);
        stagedFilePaths = tools.platformPathsConverter(stagedFilePaths);
        filters.push(page => stagedFilePaths.includes(path.join(options.dir, page.path)));
    }

    return catalog.select(...filters);
}


function selectValidators(options) {
    const validatorNames = Object.keys(availableValidators);
    let selectedValidators = validatorNames;
    if (options.validators) {
        selectedValidators = options.validators.split(',');
    }

    return selectedValidators.map(name => {
        if (validatorNames.includes(name)) return availableValidators[name];
        console.log(chalk.red(`Validator '${name}' is not recognized.`));
        process.exit(1);
    });
}


function globalOption(config, defaultValue) {
    const envVar = config.toUpperCase();
    const value = process.env[envVar];

    if (value === undefined && defaultValue === undefined) {
        console.log(`Global option '${config}' is required. Provide it with --${config} option or ${envVar} environment variable.`);
        process.exit(1);
    }
    return value || defaultValue;
}


function loadConfigYaml() {
    const configFile = globalOption('config_file', DEFAULT_CONFIG_FILE);
    try {
        return yaml.safeLoad(fs.readFileSync(configFile, 'utf8'));
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}


function listCategories(slugs, config) {
    return slugs ? slugs.split(',') : config.categories;
}


function createFilters(config) {
    const filters = [];

    if (config.filters) {
        for (const [filterName, filterConfig] of Object.entries(config.filters)) {
            if (!(filterName in availableFilters)) {
                console.error(chalk.red(`Unknown filter [${filterName}] specified in config file.`));
                process.exit(1);
            }
            const filter = new availableFilters[filterName](filterConfig);
            filters.push(filter);
        }
    }

    return filters;
}
