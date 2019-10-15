[![CircleCI](https://circleci.com/gh/sinch/docs.svg?style=svg&circle-token=acb4c7610022a9c27e9e356ffcc2b6d96dba1b2b)](https://circleci.com/gh/sinch/docs)

# Public documentation sources for Sinch

This repository holds the sources for the documentation hosted on [readme.io](http://sinch.readme.io).

## Content files

All contents are stored in `.md` files under the `docs` directory. Each subdirectory represents a category slug, and
subsequent subdirectories mimic the page hierarchy in Readme.

## `readme.js` CLI

### Preparation

If NVM (Node Version Manager) is not installed, [install it](https://github.com/nvm-sh/nvm#installation-and-update).

Then, make sure the right Node version is installed and in use:

    $ nvm install              
    $ nvm use

Finally, install project dependencies:
    
    $ npm install
    
### API key

You will need the API key for your Readme account to proceed with using the CLI. It can be obtained via the Readme admin 
user interface.

### Configuration

Global configurations can be provided either :
 - via `--` global options on the command line
 - via environment variables
 - via a [`.env` file](https://www.npmjs.com/package/dotenv) to automatically set environment variables (recommended approach)
 
If both global options and environment variables are provided, the `--` global option will have precedence over the environment variable.

The following configurations are available:

| Global Option   | Environment Variable |
| ---             | ---                  |
| `--apikey`      | `APIKEY`             |
| `--docsversion` | `DOCSVERSION`        |

See the general help (`./readme.js -h`) for details of each configuration option.

### `config.yml` configuration file

In addition to the global configurations above, the file `config.yml` contains general configuration for the CLI that are not expected to change between commands. 
The following fields are available:

| Field        | Description                                                                                                                                                                                                            |
| ---          | ---                                                                                                                                                                                                                    |
| `categories` | List of category slugs that exist on Readme documentation site. These slugs have been implied from the label of each category. This list is used by the CLI to list all categories when no specific slug is specified. |
| `filters`    | Content filters to enable. Description of what filters are and which one is available is [below](#content-filters). Each filter can have specific configuration options that should be specified as child attributes under the filter's name in the YAML configuration.                                                                                                                       |

### Content Filters

Content filters are transformations that can be applied to content pages before they are pushed to Readme. To ensure local
content stays unchanged when that content gets fetched back from Readme, all filters must be able to rollback their 
changes.

#### `hostedFiles`

This filter is to be used when content files are hosted on a publicly-accessible Web server. 
All paths specified as relative paths will be converted to an equivalent public URL based on the filter's `baseUrl` configuration value. 
Paths are assumed to be specified as relative to the page in which the files are referenced.

**Configuration attributes**:

| Field     | Description                                         |
| ---       | ---                                                 |
| `baseUrl` | The base URL where the files are publicly available |


**Example `config.yml` configuration**

```yaml
filters:
  - hostedFiles:
      baseUrl: https://GITHUB_USERNAME.github.io/REPO/
```

#### `footer`

Renders a Mustache template as the footer of all content files.

The Mustache template is rendered with a [view]() object that includes the following attributes:

| Attribute | Description                                                                               |
| ---       | ---                                                                                       |
| `page`    | The page object being rendered. See the `Page` class for details of available attributes. |

Additionally, all of the filter's configuration attributes are passed to the template so they can be used directly.

**Configuration attributes**:

| Field      | Description                                                                                                            |
| ---        | ---                                                                                                                    |
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

    $ ./readme.js [command] -h 

### Commands

#### `push`

Pushes local Markdown content files to Readme via their public API. It is assumed that each `.md` file in the 
contents directory matches the slug of the page in Readme. 

**Usage examples**

Push contents for all categories defined in `config.yml`:

    $ ./readme.js push
    
Push contents for a specific category:

    $ ./readme.js push sms
    
Simulate (dry run) a push of only locally Git-staged files:  

    $ ./readme.js push sms --staged-only --dry-run   
    
#### `fetch`

Fetches up-to-date contents from Readme via their public API in a local folder. 
This command will create or update local `.md` files that represent the current content in Readme, organized in directories 
that mimic the category/page hierarchy stored in Readme.  

**Usage examples**

Fetch contents of all categories defined in `config.yml`:

    $ ./readme.js fetch
    
Fetch contents for a specific category:

    $ ./readme.js fetch sms

#### `markdownize`

Converts Readme-specific widget blocks to standard Markdown.

**Usage examples**

Replace all Readme widgets with their Markdown equivalent, in each and every page:
 
    $ ./readme.js markdownize 

Only show what changes would be performed without actually persisting them:
 
    $ ./readme.js markdownize --dry-run
    
Only convert Code and Image widgets from a specific content file:
 
    $ ./readme.js markdownize --file sms/sms.md --widgets code,image
    
#### `validate`

Runs a few sanity checks on content files, such as checking for broken links (both internal / cross references and remote URL links). See command help (`-h`) for details on supported validators. 
 
**Usage examples** 
 
Run all validations on all content files:
 
    $ ./readme.js validate  
    
Validate only cross references for a single file:
 
    $ ./readme.js markdownize --file sms/sms.md --validators xrefs
 