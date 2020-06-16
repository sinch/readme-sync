[![npm version](https://badge.fury.io/js/%40sinch%2Freadme-sync.svg)](https://badge.fury.io/js/%40sinch%2Freadme-sync)

# Publish local Markdown content files to ReadMe

This is a CLI application that allows to offload the editing workflow of a
documentation site published on [ReadMe](https://readme.com/) (previously known as "ReadMe.io")
to a local repository of Markdown content files.

Main features:

- Fetch an existing documentation site from ReadMe using the API as a catalog of local Markdown content files
- Push a catalog of Markdown content files to ReadMe using the API
- Optionally clean up stale ReadMe pages (pages which do not have a corresponding Markdown content file) on push
- Perform sanity checks on the local Markdown catalog, such as finding broken links
- Convert ReadMe-proprietary widgets (such as images, tables, callouts, etc.) to a more generic Markdown equivalent
  - Optionally, download images hosted on ReadMe to the local repository and modify references
- Host locally specified static files (images and other documentation related files) on GitHub pages and refer to them on the ReadMe pages (see the `hostedFiles` filter described below)
- Add custom dynamic footer to pages. Footers are specified as [Mustache](http://mustache.github.io/) templates.

## Markdown content files

### Directory structure

All content is expected to be stored in your project as Markdown (`.md`) files under the `docs` directory (the actual directory name can
be configured). Each subdirectory within the main directory represents a category slug, and subsequent subdirectories
mimic the page hierarchy in ReadMe.

> Note: Although the tool will handle creating content pages, it cannot currently create content categories on your ReadMe documentation site. These must be created by hand via the ReadMe admin UI.

### File format

The local Markdown content files act as the database of pages and their contents. To support "storing" more than the
actual Markdown content, additional metadata about each page is specified in [YAML front matter](https://jekyllrb.com/docs/front-matter/).

Full example:

    ---
    title: Welcome
    excerpt: This is the entry point of our documentation
    hidden: 'true'
    next:
      pages:
        - other-page-slug1
        - other-page-slug2
      description: Text to be shown in the What's Next box
    ---
    # This is the page header

    And some content underneath.

The following YAML attributes are supported:

| Attribute          | Description                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `title`            | The page title.                                                                                    |
| `excerpt`          | The small summary that appears under the page title in ReadMe.                                     |
| `hidden`           | (Optional) If set to `true`, then the page will be hidden / un-published in the ReadMe navigation. |
| `next`             | (Optional) Allows control on the _What's Next_ entries displayed by ReadMe.                        |
| `next.pages`       | (Optional) List of page slugs (strings) that should be referenced in the _What's Next_ section.    |
| `next.description` | (Optional) Text to be displayed as introduction in the _What's Next_ section.                      |

## Using the `readme-sync` CLI in your project

### Installation

To install the CLI in your project, run:

    $ npm install @sinch/readme-sync --save-dev

You can also install the CLI globally (which would be preferred for usability):

    $ npm install -g @sinch/readme-sync

> **NOTE**
>
> If you install the CLI locally to your project (instead of globally), you'll need to run it with `npx`:
>
>     $ npx readme-sync [command] [options]
>
> When you install it globally (`-g` npm option), you can run it directly:
>
>     $ readme-sync [command] [options]

### API key

You will need the API key for your ReadMe account before using the CLI. It can be obtained via the ReadMe admin UI.

### Configuration

Global configurations can be provided either :

- via `--` global options on the command line
- via environment variables
- via a [`.env` file](https://www.npmjs.com/package/dotenv) to automatically set environment variables (recommended approach)

If both global options and environment variables are provided, the `--` global option will have precedence over the environment variable.

The following configurations are available:

| Global Option   | Environment Variable |
| --------------- | -------------------- |
| `--apikey`      | `APIKEY`             |
| `--docsversion` | `DOCSVERSION`        |

See the general help (`./readme-sync -h`) for details of each configuration option.

### `config.yml` configuration file

In addition to the global configurations listed above, you can provide more general configurations that are not expected to change between command runs in a YAML file.
By default, this file is expected to be named `config.yml` and be located in the current working directory. The name of the file can be configured using the `--config` CLI option.

The following fields can be provided in the YAML configuration file:

| Field        | Description                                                                                                                                                                                                                                                             |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `categories` | List of category slugs that exist on ReadMe documentation site. These slugs are implied from the label of each category. This list is used by the CLI to list all categories when no specific slug is specified.                                                        |
| `filters`    | Content filters to enable. Description of what filters are and which one is available is [below](#content-filters). Each filter can have specific configuration options that should be specified as child attributes under the filter's name in the YAML configuration. |

### Content Filters

Content filters are transformations that can be applied to content pages before they are pushed to ReadMe. To ensure local
content stays unchanged when that content gets fetched back from ReadMe, all filters must be able to rollback their
changes on the way back.

#### `hostedFiles` filter

This filter is to be used when content files are hosted on a publicly-accessible Web server.
All links specified as relative paths in the content pages will be converted to an equivalent public URL based on the filter's `baseUrl` configuration value.
Paths are assumed to be specified as relative to the page in which the files are referenced.

**Configuration attributes**:

| Field     | Description                                         |
| --------- | --------------------------------------------------- |
| `baseUrl` | The base URL where the files are publicly available |

**Example `config.yml` configuration**

```yaml
filters:
  - hostedFiles:
      baseUrl: https://GITHUB_USERNAME.github.io/REPO/
```

#### `footer` filter

Renders a Mustache template as the footer of all content files.

The Mustache template is rendered with a [view]() object that includes the following attributes:

| Attribute                          | Description                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `page`                             | The page object being rendered. See the `Page` class for details of available attributes.                                            |
| Any filter configuration attribute | All of the filter's configuration attributes specified in `config.yml` are also passed to the template so they can be used directly. |

**Configuration attributes**:

| Field      | Description                                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| `template` | Path to the Mustache template that will be rendered as the footer for every page, relative to the project's directory. |

**Example `config.yml` configuration**

```yaml
filters:
  - footer:
      template: templates/footer.mustache
      someAttribute: Hello there!
```

Given the above configuration and the following Mustache template:

```html
<span id="footer">{{someAttribute}}</span>
```

The following footer would be rendered on each content page:

```html
<span id="footer">Hello there!</span>
```

### Get help

You can get help for the CLI or for any command by running it with `-h` argument:

    $ ./readme-sync [command] -h

### Commands

#### `push`

Pushes local Markdown content files to ReadMe via their public API. It is assumed that each `.md` file in the
contents directory matches the slug of the page in ReadMe.

**Usage examples**

Push contents for all categories defined in `config.yml`:

    $ ./readme-sync push

Push contents for a specific category:

    $ ./readme-sync push sms

Simulate (dry run) a push of only locally Git-staged files:

    $ ./readme-sync push sms --staged-only --dry-run

Over ride the hidden parameter, great when you want to make pages visible on a temporary site while keeping them hidden in the main site

    $ ./readme-sync push sms -h false

#### `fetch`

Fetches up-to-date contents from ReadMe via their public API in a local folder.
This command will create or update local `.md` files that represent the current content in ReadMe, organized in directories
that mimic the category/page hierarchy stored in ReadMe.

**Usage examples**

Fetch contents of all categories defined in `config.yml`:

    $ ./readme-sync fetch

Fetch contents for a specific category:

    $ ./readme-sync fetch sms

#### `markdownize`

Converts ReadMe-specific widget blocks to standard Markdown.

**Usage examples**

Replace all ReadMe widgets with their Markdown equivalent, in each and every page:

    $ ./readme-sync markdownize

Only show what changes would be performed without actually persisting them:

    $ ./readme-sync markdownize --dry-run

Only convert Code and Image widgets from a specific content file:

    $ ./readme-sync markdownize --file sms/sms.md --widgets code,image

#### `validate`

Runs a few sanity checks on content files, such as checking for broken links (both internal / cross references and remote URL links). See command help (`-h`) for details on supported validators.

**Usage examples**

Run all validations on all content files:

    $ ./readme-sync validate

Validate only cross references for a single file:

    $ ./readme-sync markdownize --file sms/sms.md --validators xrefs

## Contributing / Local development

If NVM (Node Version Manager) is not installed, [install it](https://github.com/nvm-sh/nvm#installation-and-update).

Then, make sure the right Node version is installed and in use:

    $ nvm install
    $ nvm use

Finally, install project dependencies:
  
 \$ npm install

To run tests, run

    $ npm test

You should now be able to work on the project locally!

### Releasing a new version

GitHub Actions are used to publish the package to NPM for release. The
workflow is appropriately named `Publish to NPM` and is executed
automatically whenever a GitHub _Release_ is created.
